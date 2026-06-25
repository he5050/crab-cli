/**
 * 原子配置更新 — 支持配置版本化和原子性更新。
 *
 * 职责:
 *   - 配置版本管理
 *   - 原子性配置更新(临时文件 + 重命名)
 *   - 配置变更冲突检测
 *   - 配置回滚支持
 *
 * 模块功能:
 *   - atomicUpdateGlobalConfig: 原子更新全局配置
 *   - getCurrentConfigVersion: 获取当前配置版本
 *   - ConfigVersionWatcher: 配置版本监听器
 *   - watchConfigVersion: 监听配置版本变化
 *   - unwatchConfigVersion: 停止监听配置版本
 *   - cleanupOldBackups: 清理旧配置备份
 *   - generateVersion: 生成版本号
 *   - ConfigVersion: 配置版本接口
 *   - AtomicUpdateOptions: 原子更新选项接口
 *
 * 使用场景:
 *   - 配置原子更新
 *   - 配置版本管理
 *   - 配置变更冲突检测
 *   - 配置热重载
 *
 * 边界:
 *   1. 使用临时文件 + 重命名实现原子性
 *   2. 版本号基于时间戳和随机数
 *   3. 保留最多 10 个版本历史
 *   4. 备份文件保留 7 天
 *
 * 流程:
 *   1. 生成新版本号
 *   2. 写入临时文件
 *   3. 重命名为目标文件(原子操作)
 *   4. 更新版本历史
 *   5. 触发版本变化通知
 */

import { createLogger } from "@/core/logging/logger";
import { readJsonFile, writeJsonFile } from "@/core/utilities/fileUtils";
import { getGlobalConfigPath, getGlobalTmpDir, getProjectConfigPath } from "../paths/paths";
import type { AppConfigSchema as AppConfigType } from "@/schema/config";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { getConfigErrorMessage, logConfigDebugFailure, logConfigWarnFailure } from "./errors";

const log = createLogger("config:atomic");

/** 配置版本信息 */
export interface ConfigVersion {
  /** 版本号(时间戳+随机数) */
  version: string;
  /** 更新时间 */
  updatedAt: number;
  /** 更新来源 */
  source: string;
  /** 变更摘要 */
  summary: string;
}

/** 原子更新选项 */
export interface AtomicUpdateOptions {
  /** 更新来源标识 */
  source?: string;
  /** 变更摘要 */
  summary?: string;
  /** 冲突检测(基于版本) */
  expectedVersion?: string;
  /** 使用传入配置整体替换当前文件内容，而不是与当前文件合并 */
  replace?: boolean;
}

/** 配置元数据 */
interface ConfigMetadata {
  version: string;
  updatedAt: number;
  source: string;
}

/** 版本历史记录 */
const MAX_VERSION_HISTORY = 10;
const versionHistory: ConfigVersion[] = [];

/**
 * 生成版本号
 */
function generateVersion(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${timestamp}-${random}`;
}

/**
 * 读取配置元数据
 */
async function readConfigMetadata(configPath: string): Promise<ConfigMetadata | null> {
  try {
    const content = await readJsonFile(configPath);
    if (content && typeof content === "object" && "_metadata" in content) {
      return content._metadata as ConfigMetadata;
    }
  } catch (error) {
    logConfigDebugFailure("读取配置元数据失败", error, {
      configPath,
      operation: "config.metadata.read",
    });
  }
  return null;
}

/**
 * 原子性更新全局配置
 * @param partial 部分配置
 * @param options 更新选项
 * @returns 更新结果
 */
export async function atomicUpdateGlobalConfig(
  partial: Partial<AppConfigType>,
  options: AtomicUpdateOptions = {},
): Promise<{ success: boolean; version?: string; error?: string }> {
  const configPath = getGlobalConfigPath();
  return atomicUpdateConfig(configPath, partial, options);
}

/**
 * 原子性更新项目配置
 */
export async function atomicUpdateProjectConfig(
  partial: Partial<AppConfigType>,
  options: AtomicUpdateOptions = {},
): Promise<{ success: boolean; version?: string; error?: string }> {
  const configPath = getProjectConfigPath(process.cwd());
  if (!configPath) {
    return { error: "未找到项目配置路径", success: false };
  }
  return atomicUpdateConfig(configPath, partial, options);
}

/**
 * 原子性更新配置(核心实现)
 * 使用临时文件 + 原子重命名确保一致性
 */
async function atomicUpdateConfig(
  configPath: string,
  partial: Partial<AppConfigType>,
  options: AtomicUpdateOptions,
): Promise<{ success: boolean; version?: string; error?: string }> {
  const { source = "unknown", summary = "", expectedVersion, replace = false } = options;

  try {
    // 1. 读取当前配置
    const currentConfig = (await readJsonFile(configPath)) || {};

    // 2. 版本冲突检测
    if (expectedVersion) {
      const metadata = await readConfigMetadata(configPath);
      if (metadata && metadata.version !== expectedVersion) {
        return {
          error: `配置版本冲突: 期望 ${expectedVersion}, 实际 ${metadata.version}`,
          success: false,
        };
      }
    }

    // 3. 生成新版本号(原子写入通过 tmpfile + renameSync 保证一致性，无需备份)
    const newVersion = generateVersion();

    // 5. 合并配置
    const baseConfig = replace ? {} : currentConfig;
    const newConfig = {
      ...baseConfig,
      ...partial,
      _metadata: {
        source,
        updatedAt: Date.now(),
        version: newVersion,
      } as ConfigMetadata,
    };

    // 6. 写入临时文件
    const tmpBaseDir = join(getGlobalTmpDir(), "config");
    mkdirSync(tmpBaseDir, { recursive: true });
    const tempDir = mkdtempSync(join(tmpBaseDir, "crab-config-"));
    const tempPath = join(tempDir, "config.json");

    try {
      await writeJsonFile(tempPath, newConfig);

      // 7. 原子重命名
      mkdirSync(dirname(configPath), { recursive: true });
      renameSync(tempPath, configPath);

      // 8. 限制配置文件权限(含 API Key 等敏感信息)
      try {
        chmodSync(configPath, 0o600);
      } catch (error) {
        logConfigDebugFailure("设置配置文件权限失败", error, {
          configPath,
          operation: "config.atomic.chmod",
        });
      }

      // 8. 清理临时目录
      try {
        rmSync(tempDir, { force: true, recursive: true });
      } catch (error) {
        logConfigDebugFailure("清理配置临时目录失败", error, {
          operation: "config.atomic.cleanupTempDir",
          tempDir,
        });
      }
    } catch (error) {
      // 清理临时文件
      try {
        if (existsSync(tempPath)) unlinkSync(tempPath);
        if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        logConfigWarnFailure("配置原子更新失败后清理临时文件失败", cleanupError, {
          operation: "config.atomic.cleanupAfterFailure",
          tempPath,
          tempDir,
        });
      }
      throw error;
    }

    // 9. 记录版本历史
    recordVersion({
      source,
      summary,
      updatedAt: Date.now(),
      version: newVersion,
    });

    log.info(`配置原子更新成功: ${configPath}, version=${newVersion}`);
    return { success: true, version: newVersion };
  } catch (err) {
    const error = getConfigErrorMessage(err);
    log.error(`配置原子更新失败: ${error}`);
    return { error, success: false };
  }
}

/**
 * 记录版本历史
 */
function recordVersion(version: ConfigVersion): void {
  versionHistory.unshift(version);
  if (versionHistory.length > MAX_VERSION_HISTORY) {
    versionHistory.pop();
  }
}

/**
 * 获取版本历史
 */
export function getVersionHistory(): ConfigVersion[] {
  return [...versionHistory];
}

/**
 * 获取当前配置版本
 */
export async function getCurrentConfigVersion(configPath?: string): Promise<string | null> {
  const path = configPath || getGlobalConfigPath();
  const metadata = await readConfigMetadata(path);
  return metadata?.version || null;
}

/**
 * 清理旧备份文件(遗留清理:删除旧的 config.json.backup.* 文件)。
 * 新版本不再创建备份，此函数仅用于清理升级前残留的备份。
 * @param maxAge 最大保留时间(毫秒)，默认 7 天
 */
export function cleanupOldBackups(maxAge = 7 * 24 * 60 * 60 * 1000): void {
  const configDir = dirname(getGlobalConfigPath());

  try {
    const files = readdirSync(configDir);
    const now = Date.now();

    for (const file of files) {
      if (file.startsWith("config.json.backup.")) {
        const filePath = join(configDir, file);
        const stats = statSync(filePath);
        const age = now - stats.mtime.getTime();

        if (age > maxAge) {
          try {
            unlinkSync(filePath);
            log.debug(`清理旧备份: ${file}`);
          } catch (error) {
            log.warn(`清理备份失败: ${file}, ${error}`);
          }
        }
      }
    }
  } catch (error) {
    log.warn(`清理旧备份失败: ${error}`);
  }
}

/**
 * 配置变更监听器(支持版本检测)
 */
export class ConfigVersionWatcher {
  private currentVersion: string | null = null;
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private configPath: string;
  private lastMtime: number = 0;
  private onChange: (newVersion: string, oldVersion: string | null) => void;

  constructor(
    configPath: string,
    onChange: (newVersion: string, oldVersion: string | null) => void,
    private checkMs = 1000,
  ) {
    this.configPath = configPath;
    this.onChange = onChange;
  }

  /**
   * 开始监听。
   * 优化:先检查文件 mtime，未变化时跳过内容读取，减少 I/O 开销。
   */
  async start(): Promise<void> {
    this.currentVersion = await getCurrentConfigVersion(this.configPath);

    // 记录初始 mtime
    try {
      this.lastMtime = statSync(this.configPath).mtimeMs;
    } catch {
      // 文件不存在时 lastMtime 保持 0
    }

    this.checkInterval = setInterval(async () => {
      try {
        const stat = statSync(this.configPath);
        if (stat.mtimeMs === this.lastMtime) {
          return; // mtime 未变化，跳过内容读取
        }
        this.lastMtime = stat.mtimeMs;
      } catch {
        // 文件不存在或不可读，尝试读取版本（可能是删除后重建）
      }

      const newVersion = await getCurrentConfigVersion(this.configPath);
      if (newVersion && newVersion !== this.currentVersion) {
        const oldVersion = this.currentVersion;
        this.currentVersion = newVersion;
        this.onChange(newVersion, oldVersion);
      }
    }, this.checkMs);

    log.debug(`配置版本监听已启动: ${this.configPath}`);
  }

  /**
   * 停止监听
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    log.debug("配置版本监听已停止");
  }
}
