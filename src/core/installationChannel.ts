/**
 * 安装渠道检测 — 检测 crab-cli 的安装方式。
 *
 * 职责:
 *   - 检测当前 crab-cli 的安装渠道(npm/bun/brew/curl/source)
 *   - 缓存检测结果避免重复计算
 *
 * 模块功能:
 *   - detectInstallationChannel: 检测安装渠道
 *   - getInstallationChannel: 获取缓存的安装渠道
 *   - InstallationChannel: 安装渠道类型
 *
 * 使用场景:
 *   - 底部状态栏显示安装渠道
 *   - crab --version 输出安装渠道
 *   - 更新检查时根据渠道选择更新策略
 *
 * 边界:
 *   1. 仅检测，不修改任何状态
 *   2. 检测失败时回退到 "source"
 *   3. 结果在进程生命周期内缓存
 */
import { execFileSync } from "node:child_process";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("core:installationChannel");

/** 安装渠道类型 */
export type InstallationChannel = "npm" | "bun" | "brew" | "curl" | "source";

/** 渠道中文标签 */
export const INSTALLATION_CHANNEL_LABELS: Record<InstallationChannel, string> = {
  brew: "brew",
  bun: "bun",
  curl: "curl",
  npm: "npm",
  source: "source",
};

/** 缓存的检测结果 */
let cachedChannel: InstallationChannel | null = null;

/**
 * 检测安装渠道。
 *
 * 检测策略(按优先级):
 *   1. 检查 process.execPath 是否包含 npm 全局路径 → "npm"
 *   2. 检查 process.execPath 是否包含 bun 全局路径 → "bun"
 *   3. 检查 Homebrew 路径(/opt/homebrew 或 /usr/local/Homebrew) → "brew"
 *   4. 检查 /usr/local/bin 或 /opt/homebrew/bin → "curl"
 *   5. 其他 → "source"
 */
export function detectInstallationChannel(): InstallationChannel {
  try {
    const execPath = process.execPath;

    // npm 全局安装: execPath 通常包含 node_modules/.bin 或 npm 路径
    if (execPath.includes("node_modules") || execPath.includes("/npm/") || execPath.includes("\\npm\\")) {
      return "npm";
    }

    // bun 全局安装: execPath 包含 .bun
    if (execPath.includes(".bun") || execPath.includes("/bun/")) {
      return "bun";
    }

    // Homebrew 安装: 路径包含 Homebrew
    if (execPath.includes("/Homebrew/") || execPath.includes("/homebrew/")) {
      return "brew";
    }

    // 检查是否通过 curl 脚本安装到 /usr/local/bin 或 /opt/homebrew/bin
    if (execPath.includes("/usr/local/bin/") || execPath.includes("/opt/homebrew/bin/")) {
      // 进一步检查是否是 brew 安装
      if (isBrewPackage()) {
        return "brew";
      }
      return "curl";
    }

    // 检查是否通过 brew 安装(通过 brew list 命令)
    if (isBrewPackage()) {
      return "brew";
    }

    return "source";
  } catch (error) {
    log.debug(`安装渠道检测失败，回退到 source: ${error instanceof Error ? error.message : String(error)}`);
    return "source";
  }
}

/**
 * 检查 crab-cli 是否通过 Homebrew 安装。
 * 通过 `brew list crab-cli` 命令检测。
 */
function isBrewPackage(): boolean {
  try {
    execFileSync("brew", ["list", "crab-cli"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取安装渠道(带缓存)。
 * 首次调用时检测，后续返回缓存结果。
 */
export function getInstallationChannel(): InstallationChannel {
  if (cachedChannel === null) {
    cachedChannel = detectInstallationChannel();
    log.debug(`安装渠道检测结果: ${cachedChannel}`);
  }
  return cachedChannel;
}

/**
 * 获取安装渠道的中文标签。
 */
export function getInstallationChannelLabel(): string {
  return INSTALLATION_CHANNEL_LABELS[getInstallationChannel()];
}

/**
 * 重置缓存(主要用于测试)。
 */
export function resetInstallationChannelCache(): void {
  cachedChannel = null;
}
