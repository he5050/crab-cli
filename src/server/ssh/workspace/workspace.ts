/**
 * 远程工作空间 — 管理 SSH 远程工作空间的配置和验证
 *
 * 职责:
 *   - 管理工作空间配置(连接、路径等)
 *   - 提供路径解析功能
 *   - 验证工作空间可用性
 *
 * 模块功能:
 *   - RemoteWorkspace:远程工作空间类
 *   - RemoteWorkspaceConfig:工作空间配置接口
 *   - resolvePath:解析相对路径为绝对路径
 *   - validate:验证工作空间配置有效性
 *   - toConfig:导出配置对象
 *   - createRemoteWorkspace:创建工作空间便捷函数
 *
 * 使用场景:
 *   - 定义和管理远程工作空间配置
 *   - 远程文件操作的路径解析
 *   - 工作空间创建前的有效性验证
 *
 * 边界:
 * 1. 仅处理工作空间配置，不涉及连接池管理
 * 2. 路径解析统一使用正斜杠
 * 3. validate 操作会创建临时连接验证后断开
 *
 * 流程:
 * 1. 构造函数接收 RemoteWorkspaceConfig 配置
 * 2. resolvePath() 将相对路径拼接为基于工作空间目录的绝对路径
 * 3. validate() 创建临时 SSH 连接，验证远程目录是否存在
 * 4. toConfig() 将实例导出为纯配置对象用于持久化
 */
import type { SSHConnectionConfig } from "../types";
import { createLogger } from "@/core/logging/logger";
import { shellQuote } from "@/server/ssh/safety";

const log = createLogger("ssh:remote-workspace");

/**
 * 远程工作空间配置
 */
export interface RemoteWorkspaceConfig {
  id: string;
  name: string;
  connection: SSHConnectionConfig;
  remotePath: string;
  localCachePath?: string;
}

/**
 * 远程工作空间类
 *
 * 封装远程工作空间的操作，包括路径解析和连接验证
 */
export class RemoteWorkspace {
  id: string;
  name: string;
  connection: SSHConnectionConfig;
  remotePath: string;
  localCachePath?: string;

  constructor(config: RemoteWorkspaceConfig) {
    this.id = config.id;
    this.name = config.name;
    this.connection = config.connection;
    this.remotePath = config.remotePath;
    this.localCachePath = config.localCachePath;
  }

  /**
   * 解析远程路径
   * 将相对路径转换为基于工作空间远程路径的绝对路径
   */
  resolvePath(subPath: string): string {
    const base = this.remotePath.endsWith("/") ? this.remotePath : `${this.remotePath}/`;
    const relative = subPath.startsWith("/") ? subPath.slice(1) : subPath;
    return `${base}${relative}`;
  }

  /**
   * 验证工作空间配置
   * 检查 SSH 连接和远程路径是否存在
   */
  async validate(): Promise<{ valid: boolean; error?: string }> {
    let client: {
      connect(): Promise<void>;
      exec(
        command: string,
        options?: { dangerousAllow?: boolean; cwd?: string; timeout?: number; env?: Record<string, string> },
      ): Promise<{ exitCode: number; stdout: string }>;
      disconnect(): Promise<void> | void;
    } | null = null;
    try {
      const { SSHClient } = await import("../client");
      client = new SSHClient(this.connection);
      await client.connect();

      const result = await client.exec(`test -d ${shellQuote(this.remotePath)}`, { dangerousAllow: true });

      if (result.exitCode !== 0) {
        return { error: `远程路径不存在: ${this.remotePath}`, valid: false };
      }

      log.info(`工作空间验证成功: ${this.name} (${this.id})`);
      return { valid: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error(`工作空间验证失败: ${this.name}`, { error: msg });
      return { error: msg, valid: false };
    } finally {
      if (client) {
        try {
          await client.disconnect();
        } catch (error) {
          // 验证清理阶段的断开失败不影响结果
          log.debug(`工作空间验证后断开失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }

  /**
   * 转换为纯配置对象
   */
  toConfig(): RemoteWorkspaceConfig {
    return {
      connection: this.connection,
      id: this.id,
      localCachePath: this.localCachePath,
      name: this.name,
      remotePath: this.remotePath,
    };
  }
}

/**
 * 创建远程工作空间实例
 */
export function createRemoteWorkspace(config: RemoteWorkspaceConfig): RemoteWorkspace {
  return new RemoteWorkspace(config);
}
