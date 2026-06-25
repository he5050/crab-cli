/**
 * Shell Manager 模块
 *
 * 职责:
 *   - 管理本地 Shell 进程执行
 *   - 支持 SSH 远程 Shell 执行
 *   - 提供远程工作空间文件搜索能力
 *   - 维护进程池进行生命周期管理
 *
 * 模块功能:
 *   - ShellManager: Shell 管理器类
 *   - exec(): 执行本地 Shell 命令
 *   - sshExec(): 通过 SSH 执行远程命令
 *   - sshSearch(): 远程工作空间文件搜索
 *   - killAll(): 终止所有活跃进程
 *   - ShellOptions: 本地执行选项类型
 *   - SshOptions: SSH 连接选项类型
 *   - ShellResult: 执行结果类型
 *   - shellManager: 全局管理器实例
 *
 * 使用场景:
 *   - 需要执行本地系统命令
 *   - 远程服务器命令执行
 *   - 跨机器文件搜索和代码检索
 *   - 分布式开发环境支持
 *
 * 边界:
 *   1. 仅管理进程生命周期，不涉及 TUI 渲染
 *   2. SSH 执行依赖系统 ssh 命令
 *   3. 远程搜索通过 SSH 管道实现，受网络延迟影响
 *   4. 进程池仅用于跟踪，不限制并发数
 *   5. 超时控制由调用方通过 options 传入
 *
 * 流程:
 *   1. 本地执行:使用 Bun.spawn 启动 bash 进程
 *   2. SSH 执行:构建 ssh 命令并执行
 *   3. 远程搜索:构建 find/grep 命令通过 SSH 执行
 *   4. 收集 stdout/stderr 并返回结果
 *   5. 进程退出后从进程池移除
 */
import { createLogger } from "@/core/logging/logger";
import type { Subprocess } from "bun";
import { shellQuote } from "@/server/ssh/safety";

const log = createLogger("shell-manager");

export interface ShellOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
}

export interface SshOptions {
  host: string;
  port?: number;
  user?: string;
  identityFile?: string;
  cwd?: string;
}

export interface ShellResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Shell 管理器 — 提供本地和 SSH 远程 Shell 执行能力。
 */
export class ShellManager {
  private processes = new Map<string, Subprocess>();

  /**
   * 执行本地 Shell 命令。
   */
  async exec(command: string, options: ShellOptions = {}): Promise<ShellResult> {
    log.debug(`执行: ${command}`);
    try {
      const proc = Bun.spawn(["bash", "-c", command], {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        stderr: "pipe",
        stdout: "pipe",
      });

      const id = crypto.randomUUID();
      this.processes.set(id, proc);

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      this.processes.delete(id);

      return { exitCode, stderr, stdout };
    } catch (error) {
      log.error(`执行失败: ${error instanceof Error ? error.message : String(error)}`);
      return {
        exitCode: 1,
        stderr: error instanceof Error ? error.message : String(error),
        stdout: "",
      };
    }
  }

  /**
   * 通过 SSH 执行远程命令。
   */
  async sshExec(command: string, ssh: SshOptions): Promise<ShellResult> {
    const port = ssh.port ?? 22;
    const user = ssh.user ? `${ssh.user}@` : "";
    const identityArgs = ssh.identityFile ? ["-i", ssh.identityFile] : [];
    const remoteCmd = ssh.cwd ? `cd ${ssh.cwd} && ${command}` : command;

    const sshCommand = [
      "ssh",
      ...identityArgs,
      "-p",
      String(port),
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "ConnectTimeout=10",
      `${user}${ssh.host}`,
      remoteCmd,
    ];

    log.debug(`SSH 执行: ${sshCommand.join(" ")}`);

    try {
      const proc = Bun.spawn(sshCommand, {
        stderr: "pipe",
        stdout: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      return { exitCode, stderr, stdout };
    } catch (error) {
      log.error(`SSH 执行失败: ${error instanceof Error ? error.message : String(error)}`);
      return {
        exitCode: 1,
        stderr: error instanceof Error ? error.message : String(error),
        stdout: "",
      };
    }
  }

  /**
   * 远程工作空间文件搜索(通过 SSH 管道 grep/find)。
   */
  async sshSearch(
    query: string,
    ssh: SshOptions,
    options: { maxResults?: number; type?: "filename" | "content" } = {},
  ): Promise<{ file: string; line?: number; content?: string }[]> {
    const maxResults = options.maxResults ?? 50;
    const type = options.type ?? "filename";

    /**
     * 转义 find -name 模式中的特殊字符(* ? [ ] \)。
     */
    function escapeFindGlob(s: string): string {
      return s.replace(/[*?[\]\\]/g, String.raw`\$&`);
    }

    let command: string;
    if (type === "filename") {
      command = `find . -type f -name ${shellQuote(`*${escapeFindGlob(query)}*`)} | head -${maxResults}`;
    } else {
      command = `grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.py' -m ${maxResults} ${shellQuote(query)} . | head -${maxResults}`;
    }

    const result = await this.sshExec(command, ssh);
    if (result.exitCode !== 0) {
      return [];
    }

    return result.stdout
      .trim()
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        if (type === "content") {
          const parts = line.split(":");
          return {
            content: parts.slice(2).join(":"),
            file: parts[0] ?? "",
            line: parts[1] ? parseInt(parts[1]) : undefined,
          };
        }
        return { file: line.trim() };
      });
  }

  /**
   * 终止所有活跃进程。
   */
  killAll(): void {
    for (const [id, proc] of this.processes) {
      try {
        proc.kill();
      } catch (error) {
        log.debug(`终止进程 ${id} 失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.processes.clear();
  }
}

/** 全局 Shell 管理器实例 */
export const shellManager = new ShellManager();
