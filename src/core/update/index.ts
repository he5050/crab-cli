/**
 * Update Check — 版本更新检查。
 *
 * 职责:
 *   - 定期检查 npm registry 是否有新版本
 *   - 通知用户有新版本可用
 *   - 提供版本比较功能
 *
 * 模块功能:
 *   - checkForUpdate: 执行一次更新检查
 *   - startUpdateCheck: 启动定期检查
 *   - stopUpdateCheck: 停止定期检查
 *   - getUpdateNotice: 获取当前更新通知
 *   - onUpdateNotice: 监听更新通知变化
 *   - setUpdateNotice: 设置更新通知
 *
 * 使用场景:
 *   - 应用启动时检查更新
 *   - 定期提醒用户更新
 *   - 版本比较和兼容性检查
 *
 * 边界:
 *   1. 仅检查和通知，不自动更新
 *   2. 从 npm registry 获取最新版本
 *   3. 默认每小时检查一次
 *
 * 流程:
 *   1. 启动定期检查器
 *   2. 从 npm registry 获取最新版本
 *   3. 比较当前版本和最新版本
 *   4. 有新版本时触发通知
 *   5. UI 层显示更新提示
 */
import { EventEmitter } from "node:events";
import { NAME, VERSION } from "@/config/version";
import { createLogger } from "@/core/logging/logger";
import { registerCleanup } from "@/bus";

const log = createLogger("core:update-check");

export interface UpdateNotice {
  currentVersion: string;
  latestVersion: string;
  checkedAt: number;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(20);

let currentNotice: UpdateNotice | null = null;
let checkTimer: ReturnType<typeof setTimeout> | null = null;

/** 比较语义化版本号 */
function compareVersion(a: string, b: string): number {
  const pa = a.split(".").map((s) => parseInt(s, 10));
  const pb = b.split(".").map((s) => parseInt(s, 10));
  const len = Math.max(pa.length, pb.length);

  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) {
      return na - nb;
    }
  }
  return 0;
}

/**
 * 从 npm registry 获取最新版本号。
 */
async function fetchLatestVersion(): Promise<string | null> {
  try {
    const pkgName = NAME;
    const url = `https://registry.npmjs.org/${pkgName}/latest`;
    const resp = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) {
      return null;
    }
    const data = (await resp.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    log.debug("获取最新版本失败(可能离线)");
    return null;
  }
}

/**
 * 执行一次更新检查。
 */
export async function checkForUpdate(): Promise<UpdateNotice | null> {
  const latest = await fetchLatestVersion();
  if (!latest) {
    setUpdateNotice(null);
    return null;
  }

  log.info(`当前: ${VERSION}, 最新: ${latest}`);

  if (compareVersion(latest, VERSION) > 0) {
    const notice: UpdateNotice = {
      checkedAt: Date.now(),
      currentVersion: VERSION,
      latestVersion: latest,
    };
    setUpdateNotice(notice);
    return notice;
  }

  setUpdateNotice(null);
  return null;
}

/** 设置当前更新通知(内部 + 外部触发) */
export function setUpdateNotice(notice: Omit<UpdateNotice, "checkedAt"> | null): void {
  currentNotice =
    notice && compareVersion(notice.latestVersion, notice.currentVersion) > 0
      ? { ...notice, checkedAt: Date.now() }
      : null;
  emitter.emit("update-notice", currentNotice);
}

/** 获取当前通知 */
export function getUpdateNotice(): UpdateNotice | null {
  return currentNotice;
}

/** 监听更新通知变化 */
export function onUpdateNotice(handler: (notice: UpdateNotice | null) => void): () => void {
  emitter.on("update-notice", handler);
  return () => {
    emitter.off("update-notice", handler);
  };
}

/** 启动定期检查(默认 1 小时) */
export function startUpdateCheck(intervalMs = 3_600_000): void {
  // 首次检查延迟 30 秒(避免启动时网络请求阻塞)
  setTimeout(() => {
    checkForUpdate().catch(() => {
      /* 更新检查失败不影响主流程 */
    });
  }, 30_000);

  // 定期检查
  checkTimer = setInterval(() => {
    checkForUpdate().catch(() => {
      /* 更新检查失败不影响主流程 */
    });
  }, intervalMs);
  registerCleanup(() => {
    stopUpdateCheck();
  });
}

/** 停止定期检查 */
export function stopUpdateCheck(): void {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
}

// ─── 自动更新执行 ─────────────────────────────────────────

export interface UpdateResult {
  success: boolean;
  fromVersion: string;
  toVersion?: string;
  message: string;
  error?: string;
}

/**
 * 执行自动更新。
 * 优先尝试 npm/bun 全局安装更新，失败时回退到提示手动更新。
 */
export async function performUpdate(): Promise<UpdateResult> {
  log.info("开始执行自动更新...");

  // 先检查是否有新版本
  const notice = await checkForUpdate();
  if (!notice) {
    return {
      fromVersion: VERSION,
      message: "已是最新版本，无需更新",
      success: true,
    };
  }

  const targetVersion = notice.latestVersion;

  // 尝试通过 npm 全局安装更新
  try {
    const { exec } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execAsync = promisify(exec);

    // 检测包管理器:优先 bun，回退 npm
    const useBun = process.execPath.includes("bun") || (await checkCommandAvailable("bun"));

    const cmd = useBun ? `bun install -g ${NAME}@latest` : `npm install -g ${NAME}@latest`;

    log.info(`执行更新命令: ${cmd}`);
    const { stdout, stderr } = await execAsync(cmd, { timeout: 120_000 });

    if (stderr && !stderr.includes("npm warn")) {
      log.warn(`更新命令 stderr: ${stderr}`);
    }

    log.info(`更新命令输出: ${stdout}`);

    return {
      fromVersion: VERSION,
      message: `已从 v${VERSION} 更新到 v${targetVersion}，请重启 crab 使新版本生效`,
      success: true,
      toVersion: targetVersion,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error(`自动更新失败: ${errMsg}`);

    return {
      error: errMsg,
      fromVersion: VERSION,
      message: `自动更新失败，请手动执行: npm install -g ${NAME}@latest 或 bun install -g ${NAME}@latest`,
      success: false,
      toVersion: targetVersion,
    };
  }
}

/** 检查命令是否可用 */
async function checkCommandAvailable(cmd: string): Promise<boolean> {
  try {
    const { exec } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execAsync = promisify(exec);
    await execAsync(`${cmd} --version`, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
