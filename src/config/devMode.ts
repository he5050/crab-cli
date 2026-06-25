/**
 * 开发者模式模块 — 持久化 userId 便于测试。
 *
 * 职责:
 *   - 检测开发者模式
 *   - 持久化 userId 到本地文件
 *   - 提供稳定的测试环境
 *
 * 模块功能:
 *   - isDevMode:检查是否处于开发者模式
 *   - getDevUserId:获取开发者模式的 userId
 *   - getDevSettings:获取开发者设置
 *   - updateDevSettings:更新开发者设置
 *   - clearDevConfig:清除开发者配置
 *   - initDevMode:初始化开发者模式
 *
 * 使用场景:
 *   - 开发环境用户识别
 *   - 调试和测试
 *   - 开发配置管理
 *
 * 边界:
 *   1. 仅在开发模式下生效
 *   2. 配置存储在本地文件系统
 *   3. 不影响生产环境
 *
 * 流程:
 *   1. 检测环境变量判断是否开发模式
 *   2. 读取或生成持久化 userId
 *   3. 加载开发者设置
 *   4. 初始化开发环境
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createLogger } from "@/core/logging/logger";
import { isDevMode } from "@/config/isDevMode";

export { isDevMode };

const log = createLogger("core:dev-mode");

const DEV_CONFIG_FILE = "dev-config.json";

/** 开发者配置 */
interface DevConfig {
  /** 持久化的 userId */
  userId: string;
  /** 启用时间 */
  enabledAt: string;
  /** 其他开发设置 */
  settings?: {
    /** 是否启用详细日志 */
    verboseLogging?: boolean;
    /** 是否跳过某些确认 */
    skipConfirmations?: boolean;
  };
}

function getCrabDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) {
    return join(xdg, "crab");
  }
  return join(homedir(), ".crab");
}

/**
 * 获取开发者配置文件路径
 */
function getDevConfigPath(): string {
  const crabDir = getCrabDir();
  return join(crabDir, DEV_CONFIG_FILE);
}

/**
 * 读取开发者配置
 */
function readDevConfig(): DevConfig | null {
  try {
    const configPath = getDevConfigPath();
    if (!existsSync(configPath)) {
      return null;
    }
    const data = readFileSync(configPath, "utf8");
    return JSON.parse(data) as DevConfig;
  } catch (error) {
    log.warn("读取开发者配置失败", { error: String(error) });
    return null;
  }
}

/**
 * 保存开发者配置
 */
function saveDevConfig(config: DevConfig): void {
  try {
    const configPath = getDevConfigPath();
    const dir = configPath.substring(0, configPath.lastIndexOf("/"));
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    log.debug("开发者配置已保存");
  } catch (error) {
    log.warn("保存开发者配置失败", { error: String(error) });
  }
}

/**
 * 生成唯一 userId
 */
function generateUserId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `dev_${timestamp}_${random}`;
}

/**
 * 获取开发者模式的 userId
 *
 * 在开发者模式下，userId 会被持久化，便于测试和调试
 */
export function getDevUserId(): string {
  // 先尝试读取已有配置
  const config = readDevConfig();
  if (config?.userId) {
    log.debug("使用持久化的 userId", { userId: config.userId });
    return config.userId;
  }

  // 生成新的 userId 并保存
  const userId = generateUserId();
  saveDevConfig({
    enabledAt: new Date().toISOString(),
    settings: {
      skipConfirmations: false,
      verboseLogging: true,
    },
    userId,
  });

  log.info("开发者模式:生成新的持久化 userId", { userId });
  return userId;
}

/**
 * 获取开发者设置
 */
export function getDevSettings(): DevConfig["settings"] {
  const config = readDevConfig();
  return config?.settings ?? {};
}

/**
 * 更新开发者设置
 */
export function updateDevSettings(settings: Partial<DevConfig["settings"]>): void {
  const config = readDevConfig();
  if (config) {
    config.settings = { ...config.settings, ...settings };
    saveDevConfig(config);
  }
}

/**
 * 清除开发者配置
 */
export function clearDevConfig(): void {
  try {
    const configPath = getDevConfigPath();
    if (existsSync(configPath)) {
      unlinkSync(configPath);
      log.info("开发者配置已清除");
    }
  } catch (error) {
    log.warn("清除开发者配置失败", { error: String(error) });
  }
}

/**
 * 初始化开发者模式
 *
 * 在应用启动时调用，设置开发者模式的环境
 */
export function initDevMode(): void {
  if (!isDevMode()) {
    return;
  }

  log.info("开发者模式已初始化");

  // 设置环境变量
  const userId = getDevUserId();
  process.env.CRAB_USER_ID = userId;

  // 启用详细日志
  const settings = getDevSettings() ?? {};
  if (settings.verboseLogging) {
    process.env.CRAB_VERBOSE = "1";
  }

  log.info("开发者模式配置", {
    settings,
    userId,
  });
}
