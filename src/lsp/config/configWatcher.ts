/**
 * [LSP 配置热更新模块]
 *
 * 职责:
 *   - 监听配置文件变化
 *   - 自动重新加载配置
 *   - 通知管理器更新
 *   - 防抖避免频繁触发
 *   - 错误恢复和重试
 *
 * 模块功能:
 *   - ConfigWatcher: 配置文件监听器类
 *   - start: 启动监听
 *   - stop: 停止监听
 *   - handleConfigChange: 处理配置变化
 *   - reloadConfig: 重新加载配置
 *
 * 使用场景:
 *   - 用户修改配置文件后自动生效
 *   - 配置文件同步更新
 *   - 无需重启应用
 *   - 开发环境快速迭代
 *
 * 边界:
 *   1. 仅监听 .claude/lsp.json 文件
 *   2. 配置错误时不应用新配置，记录错误
 *   3. 防抖延迟 500ms 避免频繁触发
 *   4. 停止后清理所有监听器
 *
 * 流程:
 *   1. 启动文件监听器
 *   2. 文件变化时触发防抖计时器
 *   3. 防抖延迟后读取新配置
 *   4. 验证新配置
 *   5. 通知管理器更新
 *   6. 处理错误和恢复
 */
import { createLogger } from "@/core/logging/logger";
import { type ResolvedLspConfig, loadLspConfig, resolveLspConfig } from "./lspConfig";
import { validateLspConfig } from "./configValidator";
import { createInternalError } from "@/core/errors/appError";

const log = createLogger("lsp:configWatcher");

/** 配置监听器选项 */
export interface ConfigWatcherOptions {
  /** 项目根目录 */
  projectRoot: string;
  /** 配置变化回调 */
  onConfigChange: (newConfig: ResolvedLspConfig) => void;
  /** 配置错误回调 */
  onConfigError?: (error: Error) => void;
  /** 防抖延迟(毫秒，默认 500) */
  debounceDelay?: number;
  /** 是否启用日志(默认 true) */
  enableLogging?: boolean;
}

/** 配置监听器状态 */
type WatcherState = "stopped" | "running" | "error";

/** 配置监听器 */
export class ConfigWatcher {
  private watcher: ReturnType<typeof import("node:fs").watch> | null = null;
  private options: Required<ConfigWatcherOptions>;
  private state: WatcherState = "stopped";
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private currentConfig: ResolvedLspConfig | null = null;
  private retryCount = 0;
  private maxRetries = 3;

  constructor(options: ConfigWatcherOptions) {
    this.options = {
      debounceDelay: options.debounceDelay ?? 500,
      enableLogging: options.enableLogging ?? true,
      onConfigChange: options.onConfigChange,
      onConfigError: options.onConfigError || (() => {}),
      projectRoot: options.projectRoot,
    };
  }

  /**
   * 获取当前状态
   */
  getState(): WatcherState {
    return this.state;
  }

  /**
   * 启动配置监听
   */
  async start(): Promise<void> {
    if (this.state === "running") {
      if (this.options.enableLogging) {
        log.debug("配置监听器已在运行中");
      }
      return;
    }

    try {
      // 读取初始配置
      this.currentConfig = resolveLspConfig(this.options.projectRoot);
      this.retryCount = 0;

      // 获取配置文件路径（P2-1: 监听 lsp.json 和 config.json）
      const lspPath = `${this.options.projectRoot}/.claude/lsp.json`;

      // 启动文件监听
      const fs = await import("node:fs");
      try {
        this.watcher = fs.watch(lspPath, (eventType) => {
          if (eventType === "change") {
            this.handleConfigChange();
          }
        });
      } catch (watchError) {
        // lsp.json 不存在时，回退到 config.json
        try {
          const configPath = `${this.options.projectRoot}/.claude/config.json`;
          this.watcher = fs.watch(configPath, (eventType) => {
            if (eventType === "change") {
              this.handleConfigChange();
            }
          });
        } catch {
          throw watchError;
        }
      }

      this.state = "running";

      if (this.options.enableLogging) {
        log.info(`配置监听器已启动: ${lspPath}`);
      }
    } catch (error) {
      this.state = "error";
      this.options.onConfigError(error as Error);

      if (this.options.enableLogging) {
        log.error(`配置监听器启动失败:`, { error: error instanceof Error ? error.message : String(error) });
      }

      throw error;
    }
  }

  /**
   * 停止配置监听
   */
  async stop(): Promise<void> {
    if (this.state === "stopped") {
      if (this.options.enableLogging) {
        log.debug("配置监听器已停止");
      }
      return;
    }

    try {
      // 清理防抖计时器
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }

      // 关闭文件监听器
      if (this.watcher) {
        this.watcher.close();
        this.watcher = null;
      }

      this.state = "stopped";

      if (this.options.enableLogging) {
        log.info("配置监听器已停止");
      }
    } catch (error) {
      this.state = "error";

      if (this.options.enableLogging) {
        log.error(`配置监听器停止失败:`, { error: error instanceof Error ? error.message : String(error) });
      }

      throw error;
    }
  }

  /**
   * 处理配置文件变化
   */
  private handleConfigChange(): void {
    if (this.state !== "running") {
      return;
    }

    // 清理之前的防抖计时器
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // 设置新的防抖计时器
    this.debounceTimer = setTimeout(() => {
      this.reloadConfig();
    }, this.options.debounceDelay);

    if (this.options.enableLogging) {
      log.debug("检测到配置变化，将在防抖延迟后重新加载");
    }
  }

  /**
   * 重新加载配置
   */
  private async reloadConfig(): Promise<void> {
    try {
      // 读取原始配置
      const rawConfig = loadLspConfig(this.options.projectRoot);

      // 验证新配置
      const validation = validateLspConfig(rawConfig);

      if (!validation.valid) {
        const error = new Error(`配置验证失败: ${validation.errors.map((e) => e.message).join(", ")}`);

        this.options.onConfigError(error);

        if (this.options.enableLogging) {
          log.error("配置验证失败", { errors: validation.errors });
        }

        return;
      }

      // 解析完整配置
      const resolvedConfig = resolveLspConfig(this.options.projectRoot);

      // 检查是否有实际变化(比较 Set 时转换为数组)
      const currentArray = [...(this.currentConfig?.disabled ?? [])];
      const newArray = [...resolvedConfig.disabled];
      const currentServers = JSON.stringify(this.currentConfig?.servers ?? {});
      const newServers = JSON.stringify(resolvedConfig.servers);

      if (currentArray.toSorted().join(",") === newArray.toSorted().join(",") && currentServers === newServers) {
        if (this.options.enableLogging) {
          log.debug("配置无实际变化，跳过更新");
        }
        return;
      }

      // 应用新配置
      this.currentConfig = resolvedConfig;
      this.options.onConfigChange(resolvedConfig);
      this.retryCount = 0;

      if (this.options.enableLogging) {
        log.info("配置已更新并生效");
      }
    } catch (error) {
      this.retryCount++;

      if (this.options.enableLogging) {
        log.error(`配置重新加载失败 (尝试 ${this.retryCount}/${this.maxRetries}):`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // 重试逻辑
      if (this.retryCount < this.maxRetries) {
        setTimeout(() => {
          this.reloadConfig();
        }, 1000 * this.retryCount); // 指数退避
      } else {
        this.state = "error";
        this.options.onConfigError(error as Error);

        if (this.options.enableLogging) {
          log.error("配置重新加载失败，达到最大重试次数", {
            error: error instanceof Error ? error.message : String(error),
            retryCount: this.retryCount,
          });
        }
      }
    }
  }

  /**
   * 手动触发配置重新加载
   */
  async manualReload(): Promise<void> {
    if (this.state !== "running") {
      throw createInternalError("INTERNAL_ERROR", "配置监听器未运行，无法手动重新加载");
    }

    await this.reloadConfig();
  }

  /**
   * 获取当前配置
   */
  getCurrentConfig(): ResolvedLspConfig | null {
    return this.currentConfig;
  }

  /**
   * 检查是否正在运行
   */
  isRunning(): boolean {
    return this.state === "running";
  }

  /**
   * 检查是否有错误
   */
  hasError(): boolean {
    return this.state === "error";
  }
}

/**
 * 创建配置监听器
 */
export function createConfigWatcher(options: ConfigWatcherOptions): ConfigWatcher {
  return new ConfigWatcher(options);
}

/**
 * 监听配置变化的便捷函数
 */
export async function watchConfig(
  projectRoot: string,
  onConfigChange: (newConfig: ResolvedLspConfig) => void,
  onConfigError?: (error: Error) => void,
): Promise<ConfigWatcher> {
  const watcher = new ConfigWatcher({
    onConfigChange,
    onConfigError,
    projectRoot,
  });

  await watcher.start();
  return watcher;
}
