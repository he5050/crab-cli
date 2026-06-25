/**
 * SSH 远程命令执行工具 — 在远程 SSH 服务器上执行命令
 *
 * 职责:
 *   - 在远程 SSH 服务器上执行 shell 命令
 *   - 管理 SSH 连接的生命周期
 *   - 提供 SSH 执行上下文判断
 *
 * 模块功能:
 *   - shouldUseSSH: 判断是否应使用 SSH 执行(基于上下文)
 *   - execSSH: 在远程服务器执行命令并返回结果
 *
 * 使用场景:
 *   - 远程服务器上的文件操作
 *   - 分布式开发环境中的命令执行
 *   - 容器或虚拟机内部的命令执行
 *
 * 边界:
 * 1. 需要有效的 SSH 连接配置(workspaceId 或 connection)
 * 2. 命令执行受远程服务器权限限制
 * 3. 每次执行后自动断开连接
 * 4. 不支持交互式命令(需要 TTY 的命令)
 *
 * 流程:
 * 1. 检查上下文判断是否需要 SSH
 * 2. 创建 SSHClient 并连接
 * 3. 执行命令并传递工作目录和环境变量
 * 4. 返回执行结果
 * 5. 断开连接
 */

import { SSHClient } from "@/server/ssh";
import type { SSHConnectionConfig, SSHExecContext } from "@/server/ssh/types";
import { createInternalError } from "@/core/errors/appError";

/** 根据上下文判断是否应使用 SSH 远程执行 */
export function shouldUseSSH(context?: SSHExecContext): boolean {
  if (!context) {
    return false;
  }
  return Boolean(context.workspaceId || context.connection);
}

/** @param command 要执行的命令 @param context SSH 执行上下文 @returns 命令执行结果（stdout/stderr/exitCode） */
export async function execSSH(
  command: string,
  context: SSHExecContext,
  options: { timeout?: number; env?: Record<string, string> } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  let client: SSHClient | null = null;

  try {
    let config: SSHConnectionConfig;

    if (context.connection) {
      config = context.connection;
    } else {
      throw createInternalError("INTERNAL_ERROR", "未提供 SSH 连接配置");
    }

    client = new SSHClient(config);
    await client.connect();

    const { cwd } = context;

    const result = await client.exec(command, {
      cwd,
      env: options.env,
      timeout: options.timeout,
    });

    return result;
  } finally {
    if (client) {
      await client.disconnect();
    }
  }
}
