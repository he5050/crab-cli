/**
 * FirstRunState — 首次引导状态持久化 [P2-21]
 *
 * 职责:
 *   - 记录用户是否已查看过首次引导
 *   - 以 JSON 格式持久化到 ~/.crab/firstRun.json
 *   - 提供幂等的写入接口
 *
 * 模块功能:
 *   - readFirstRunState(baseDir?) — 读取状态；文件不存在或损坏时返回 dismissed=false
 *   - markDismissed(baseDir?) — 写入 dismissed=true + ISO 时间戳
 *
 * 使用场景:
 *   - 应用启动时判断是否需要渲染 FirstRunOverlay
 *   - 用户按 Enter/Esc 关闭引导后持久化"已查看"标记
 *
 * 边界:
 *   1. 纯 IO:no Solid signals / no global state，父组件持有响应式
 *   2. baseDir 为可选参数；缺省时使用 ~/.crab
 *   3. 父目录不存在时自动创建(recursive)
 *   4. JSON 损坏时降级为 dismissed=false(不抛错)，避免阻塞启动
 *   5. markDismissed 幂等:连续调用产生等价最终态
 *
 * 流程:
 *   1. readFirstRunState:尝试读取并解析 JSON → 成功返回 state / 失败返回 { dismissed: false }
 *   2. markDismissed:mkdir(recursive) → writeFile(JSON.stringify({ dismissed: true, dismissedAt: ISO }))
 */
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";

/** FirstRun.json 的稳定 schema */
export interface FirstRunState {
  /** 用户是否已关闭引导 */
  dismissed: boolean;
  /** 关闭时间(ISO 8601 字符串，dismissed=true 时必填) */
  dismissedAt?: string;
}

const FILE_NAME = "firstRun.json";

/** 解析 baseDir:缺省时使用 ~/.crab */
function resolveBaseDir(baseDir?: string): string {
  return baseDir ?? path.join(os.homedir(), ".crab");
}

/** 拼接 firstRun.json 完整路径 */
function filePathFor(baseDir?: string): string {
  return path.join(resolveBaseDir(baseDir), FILE_NAME);
}

/** 用户态首启判定:只有用户 home 下尚未创建 `.crab` 目录时展示首次引导。 */
export function shouldShowFirstRun(homeDir: string = os.homedir()): boolean {
  return !fsSync.existsSync(path.join(homeDir, ".crab"));
}

/**
 * 读取 firstRun 状态。
 *
 * @param baseDir 可选；测试场景可传入临时目录；缺省 = ~/.crab
 * @returns FirstRunState；文件不存在或损坏时返回 `{ dismissed: false }`
 */
export async function readFirstRunState(baseDir?: string): Promise<FirstRunState> {
  const file = filePathFor(baseDir);
  try {
    const content = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(content) as Partial<FirstRunState>;
    return {
      dismissed: parsed.dismissed === true,
      dismissedAt: typeof parsed.dismissedAt === "string" ? parsed.dismissedAt : undefined,
    };
  } catch {
    return { dismissed: false };
  }
}

/**
 * 写入 dismissed=true + 当前 ISO 时间戳。幂等。
 *
 * @param baseDir 可选；测试场景可传入临时目录；缺省 = ~/.crab
 */
export async function markDismissed(baseDir?: string): Promise<void> {
  const dir = resolveBaseDir(baseDir);
  await fs.mkdir(dir, { recursive: true });
  const state: FirstRunState = {
    dismissed: true,
    dismissedAt: new Date().toISOString(),
  };
  await fs.writeFile(filePathFor(baseDir), JSON.stringify(state, null, 2), "utf8");
}

/**
 * 同步读取 firstRun 状态。仅用于组件初始化(避免首帧闪烁)。
 *
 * @param baseDir 可选；测试场景可传入临时目录；缺省 = ~/.crab
 * @returns FirstRunState；文件不存在或损坏时返回 `{ dismissed: false }`
 */
export function readFirstRunStateSync(baseDir?: string): FirstRunState {
  const file = filePathFor(baseDir);
  try {
    const content = fsSync.readFileSync(file, "utf8");
    const parsed = JSON.parse(content) as Partial<FirstRunState>;
    return {
      dismissed: parsed.dismissed === true,
      dismissedAt: typeof parsed.dismissedAt === "string" ? parsed.dismissedAt : undefined,
    };
  } catch {
    return { dismissed: false };
  }
}
