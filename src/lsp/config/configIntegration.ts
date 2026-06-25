/**
 * [LSP 配置系统集成模块]
 *
 * 职责:
 *   - 集成配置监听器和 LSP 管理器
 *   - 实现配置热更新
 *   - 自动重启受影响的客户端
 *   - 监控配置变化并响应
 *
 * 模块功能:
 *   - setupConfigHotReload: 设置配置热更新
 *   - ConfigIntegration: 配置集成类
 *   - 自动化配置响应流程
 *
 * 使用场景:
 *   - 项目配置变化时自动更新 LSP 客户端
 *   - 无需重启应用即可生效
 *   - 智能管理客户端生命周期
 *
 * 边界:
 *   1. 仅在配置有实际变化时重启客户端
 *   2. 保持活跃连接不受影响
 *   3. 错误恢复和回滚机制
 *   4. 配置验证失败时保留原配置
 *
 * 流程:
 *   1. 监听配置文件变化
 *   2. 验证新配置
 *   3. 比较配置差异
 *   4. 重启受影响的客户端
 *   5. 应用新配置
 */
import { createLogger } from "@/core/logging/logger";
import { pathToFileURL } from "node:url";
import type { LspManager } from "../manager/manager";
import { ConfigWatcher, type ConfigWatcherOptions } from "./configWatcher";
import { type ResolvedLspConfig, resolveLspConfig } from "./lspConfig";

const log = createLogger("lsp:configIntegration");

/** 配置集成选项 */
export interface ConfigIntegrationOptions {
  /** 项目根目录 */
  projectRoot: string;
  /** 是否启用配置热更新(默认 true) */
  enableHotReload?: boolean;
  /** 是否启用日志(默认 true) */
  enableLogging?: boolean;
}

/**
 * 配置系统集成类
 *
 * 协调配置监听器和 LSP 管理器，实现配置热更新。
 */
export class ConfigIntegration {
  private manager: LspManager;
  private watcher?: ConfigWatcher;
  private options: Required<ConfigIntegrationOptions>;
  private currentConfig: ResolvedLspConfig | null = null;

  constructor(manager: LspManager, options: ConfigIntegrationOptions) {
    this.manager = manager;
    this.options = {
      enableHotReload: options.enableHotReload ?? true,
      enableLogging: options.enableLogging ?? true,
      projectRoot: options.projectRoot,
    };
  }

  /**
   * 启动配置集成
   */
  async start(): Promise<void> {
    if (!this.options.enableHotReload) {
      if (this.options.enableLogging) {
        log.info("配置热更新已禁用");
      }
      return;
    }

    try {
      // 读取初始配置
      this.currentConfig = resolveLspConfig(this.options.projectRoot);

      // 创建配置监听器
      const watcherOptions: ConfigWatcherOptions = {
        enableLogging: this.options.enableLogging,
        onConfigChange: async (newConfig) => {
          await this.handleConfigChange(newConfig);
        },
        onConfigError: (error) => {
          if (this.options.enableLogging) {
            log.error("配置错误", { error: error.message });
          }
        },
        projectRoot: this.options.projectRoot,
      };

      this.watcher = new ConfigWatcher(watcherOptions);
      await this.watcher.start();

      if (this.options.enableLogging) {
        log.info("配置热更新已启动");
      }
    } catch (error) {
      if (this.options.enableLogging) {
        log.error("配置集成启动失败", { error: error instanceof Error ? error.message : String(error) });
      }
      throw error;
    }
  }

  /**
   * 停止配置集成
   */
  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.stop();
      this.watcher = undefined;
    }

    if (this.options.enableLogging) {
      log.info("配置集成已停止");
    }
  }

  /**
   * 处理配置变化
   */
  private async handleConfigChange(newConfig: ResolvedLspConfig): Promise<void> {
    try {
      if (this.options.enableLogging) {
        log.info("检测到配置变化，正在更新 LSP 客户端");
      }

      // 比较配置差异
      const oldConfig = this.currentConfig || { disabled: new Set(), servers: {} };
      const diff = this.getConfigDiff(oldConfig, newConfig);

      // 关闭受影响的客户端
      for (const languageId of diff.affectedLanguages) {
        await this.manager.stop(languageId);
      }

      // 应用新配置
      this.currentConfig = newConfig;

      // 重启受影响的客户端(如果有语言被禁用，不重启)
      const rootUri = this.toRootUri();
      for (const languageId of diff.affectedLanguages) {
        if (!this.isLanguageDisabled(newConfig, languageId)) {
          // 重新创建客户端
          await this.manager.startForLanguage(languageId, rootUri);
        }
      }

      if (this.options.enableLogging) {
        log.info("LSP 配置已更新", {
          affectedLanguages: diff.affectedLanguages,
        });
      }
    } catch (error) {
      if (this.options.enableLogging) {
        log.error("处理配置变化失败", { error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  /**
   * 获取配置差异
   */
  private getConfigDiff(
    oldConfig: ResolvedLspConfig,
    newConfig: ResolvedLspConfig,
  ): {
    affectedLanguages: string[];
  } {
    const affectedLanguages = new Set<string>();

    // 检查禁用状态变化
    for (const serverId of Object.keys(newConfig.servers)) {
      const wasDisabled = oldConfig.disabled.has(serverId);
      const isDisabled = newConfig.disabled.has(serverId);

      if (wasDisabled !== isDisabled) {
        // 禁用状态改变，受影响
        const server = newConfig.servers[serverId];
        if (server) {
          for (const lang of server.languages) {
            affectedLanguages.add(lang);
          }
        }
      }
    }

    // 检查服务器配置变化
    for (const serverId of Object.keys(newConfig.servers)) {
      const oldServer = oldConfig.servers[serverId];
      const newServer = newConfig.servers[serverId];

      if (!oldServer || JSON.stringify(oldServer) !== JSON.stringify(newServer)) {
        // 服务器配置改变，受影响
        if (newServer) {
          for (const lang of newServer.languages) {
            affectedLanguages.add(lang);
          }
        }
      }
    }

    return { affectedLanguages: [...affectedLanguages] };
  }

  /**
   * 手动重新加载配置
   */
  async manualReload(): Promise<void> {
    if (this.watcher) {
      await this.watcher.manualReload();
    } else {
      if (this.options.enableLogging) {
        log.warn("配置监听器未启动，无法手动重新加载");
      }
    }
  }

  /**
   * 获取当前配置
   */
  getCurrentConfig(): ResolvedLspConfig | null {
    return this.currentConfig;
  }

  private toRootUri(): string {
    return this.options.projectRoot.startsWith("file://")
      ? this.options.projectRoot
      : pathToFileURL(this.options.projectRoot).toString();
  }

  private isLanguageDisabled(config: ResolvedLspConfig, languageId: string): boolean {
    for (const serverId of config.disabled) {
      const server = config.servers[serverId];
      if (server?.languages.includes(languageId)) {
        return true;
      }
    }
    return false;
  }
}

/**
 * 设置配置热更新
 *
 * 便捷函数:为 LSP 管理器启用配置热更新功能。
 */
export async function setupConfigHotReload(
  manager: LspManager,
  options: ConfigIntegrationOptions,
): Promise<ConfigIntegration> {
  const integration = new ConfigIntegration(manager, options);
  await integration.start();
  return integration;
}
