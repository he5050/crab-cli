/**
 * SSH 客户端 — 封装 SSH 连接和远程命令执行
 *
 * 职责:
 *   - 封装 SSH 连接操作
 *   - 提供远程命令执行接口
 *   - 管理连接生命周期
 *   - 提供文件操作接口
 *
 * 模块功能:
 *   - SSHClient:SSH 客户端类
 *   - connect:建立连接
 *   - exec:执行远程命令
 *   - readFile:读取远程文件
 *   - writeFile:写入远程文件
 *   - readdir:列出远程目录
 *   - disconnect:断开连接
 *   - createSSHClient:便捷创建并连接函数
 *
 * 使用场景:
 *   - 远程服务器管理
 *   - 远程部署脚本执行
 *   - 远程文件操作
 *   - 目录浏览和文件传输
 *
 * 边界:
 * 1. 依赖 SSH 连接池获取连接
 * 2. 需要预先配置连接信息
 * 3. 命令执行超时默认 60 秒
 *
 * 流程:
 * 1. 创建 SSHClient 实例并配置连接参数
 * 2. connect() 从连接池获取或创建连接
 * 3. exec() 在指定工作目录执行命令
 * 4. disconnect() 归还连接到连接池
 */

import { SSHConnectionError, sshConnectionPool } from "./pool";
import type { SSHConnection, SSHConnectionConfig, SSHExecOptions, SSHExecResult } from "../types";
import { makeSSHCommandSafe, shellQuote } from "../safety";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("ssh:client");

/**
 * SSH 客户端类
 */
export class SSHClient {
  private connection: SSHConnection | null = null;
  private config: SSHConnectionConfig;

  constructor(config: SSHConnectionConfig) {
    this.config = config;
  }

  /**
   * 连接到远程服务器
   */
  async connect(): Promise<void> {
    try {
      this.connection = await sshConnectionPool.getConnection(this.config);
      log.info(`SSH 客户端已连接: ${this.config.host}`);
    } catch (error) {
      throw this.wrapError(error);
    }
  }

  /**
   * 执行远程命令
   *
   * 安全:command 字段在远端 shell 解析，因此应用 sanitize + denylist
   * 防止 CWE-78 OS 命令注入。options.cwd 始终 shellQuote 因为它
   * 是配置项(不可信来源是用户/工作空间 YAML)。如果调用方
   * 显式需要执行含 shell 元字符的复杂命令，传入
   * options.dangerousAllow=true(仅限受信任来源，如内部工具)。
   */
  async exec(command: string, options: SSHExecOptions = {}): Promise<SSHExecResult> {
    if (!this.connection?.isConnected) {
      throw new SSHConnectionError("SSH 未连接");
    }

    if (!options.dangerousAllow) {
      try {
        command = makeSSHCommandSafe(command);
      } catch (error) {
        throw new SSHConnectionError(`SSH 命令被拒绝: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      log.warn(
        `SSH 命令跳过安全检查(dangerousAllow=true): ${command} (host=${this.config.host}, user=${this.config.username})`,
      );
    }

    const fullCommand = options.cwd ? `cd ${shellQuote(options.cwd)} && ${command}` : command;

    return new Promise((resolve, reject) => {
      const timeout = options.timeout || 60_000;
      const timeoutId = setTimeout(() => {
        reject(new SSHConnectionError(`命令执行超时 (${timeout}ms): ${command}`));
      }, timeout);

      let stdout = "";
      let stderr = "";

      this.connection!.client.exec(fullCommand, { env: options.env }, (err: Error | undefined, stream: any) => {
        if (err) {
          clearTimeout(timeoutId);
          reject(this.wrapError(err));
          return;
        }

        stream.on("close", (exitCode: number) => {
          clearTimeout(timeoutId);
          resolve({ exitCode, stderr, stdout });
        });

        stream.on("data", (data: Buffer) => {
          stdout += data.toString();
        });

        stream.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });

        stream.on("error", (err: Error) => {
          clearTimeout(timeoutId);
          reject(this.wrapError(err));
        });
      });
    });
  }

  /**
   * 读取远程文件
   */
  async readFile(remotePath: string): Promise<Buffer> {
    if (!this.connection?.isConnected) {
      throw new SSHConnectionError("SSH 未连接");
    }

    return new Promise((resolve, reject) => {
      this.connection!.client.sftp((err: Error | undefined, sftp: any) => {
        if (err) {
          reject(this.wrapError(err));
          return;
        }

        sftp.readFile(remotePath, (err: Error | undefined, data: Buffer) => {
          if (err) {
            reject(this.wrapError(err));
            return;
          }
          resolve(data);
        });
      });
    });
  }

  /**
   * 写入远程文件
   */
  async writeFile(remotePath: string, data: string | Buffer): Promise<void> {
    if (!this.connection?.isConnected) {
      throw new SSHConnectionError("SSH 未连接");
    }

    return new Promise((resolve, reject) => {
      this.connection!.client.sftp((err: Error | undefined, sftp: any) => {
        if (err) {
          reject(this.wrapError(err));
          return;
        }

        sftp.writeFile(remotePath, data, (err: Error | undefined) => {
          if (err) {
            reject(this.wrapError(err));
            return;
          }
          resolve();
        });
      });
    });
  }

  /**
   * 列出远程目录
   */
  async readdir(remotePath: string): Promise<{ filename: string; attrs: any }[]> {
    if (!this.connection?.isConnected) {
      throw new SSHConnectionError("SSH 未连接");
    }

    return new Promise((resolve, reject) => {
      this.connection!.client.sftp((err: Error | undefined, sftp: any) => {
        if (err) {
          reject(this.wrapError(err));
          return;
        }

        sftp.readdir(remotePath, (err: Error | undefined, list: any[]) => {
          if (err) {
            reject(this.wrapError(err));
            return;
          }
          resolve(list);
        });
      });
    });
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    if (this.connection) {
      await sshConnectionPool.closeConnection(this.connection.id);
      this.connection = null;
      log.info(`SSH 客户端已断开: ${this.config.host}`);
    }
  }

  /**
   * 包装错误为友好提示
   */
  private wrapError(error: unknown): Error {
    if (error instanceof SSHConnectionError) {
      return error;
    }

    const msg = error instanceof Error ? error.message : String(error);

    // 常见错误映射
    if (msg.includes("ECONNREFUSED")) {
      return new SSHConnectionError(`无法连接到 ${this.config.host}:${this.config.port || 22}，请检查主机地址和端口`);
    }
    if (msg.includes("ECONNRESET")) {
      return new SSHConnectionError("连接被重置，请检查网络或服务器状态");
    }
    if (msg.includes("Authentication")) {
      return new SSHConnectionError("认证失败，请检查用户名、密码或私钥");
    }
    if (msg.includes("timeout") || msg.includes("Timeout")) {
      return new SSHConnectionError("连接超时，请检查网络或增加超时时间");
    }

    return new SSHConnectionError(`SSH 错误: ${msg}`);
  }

  /**
   * 检查是否已连接
   */
  get isConnected(): boolean {
    return this.connection?.isConnected ?? false;
  }
}

/**
 * 创建 SSH 客户端并连接
 */
export async function createSSHClient(config: SSHConnectionConfig): Promise<SSHClient> {
  const client = new SSHClient(config);
  await client.connect();
  return client;
}
