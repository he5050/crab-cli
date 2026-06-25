/**
 * 进程管理器 — Bun.spawn 封装。
 *
 * 职责:
 *   - 提供统一的子进程执行接口
 *   - 支持超时控制
 *   - 支持输出捕获
 *   - 提供命令存在性检查
 *
 * 模块功能:
 *   - exec: 执行命令并等待完成
 *   - commandExists: 检查命令是否存在
 *   - ProcessResult: 进程结果接口
 *   - ProcessOptions: 进程选项接口
 *
 * 使用场景:
 *   - 执行外部命令
 *   - Git 操作
 *   - 系统命令调用
 *   - 需要超时控制的子进程
 *
 * 边界:
 *   1. 仅负责进程执行，不负责具体命令逻辑
 *   2. 默认超时 30 秒
 *   3. 使用 Bun.spawn 实现
 *
 * 流程:
 *   1. 解析命令和参数
 *   2. 配置工作目录和环境变量
 *   3. 启动子进程
 *   4. 设置超时定时器
 *   5. 等待进程退出
 *   6. 捕获输出并返回结果
 */
import { createLogger } from "@/core/logging/logger";

const log = createLogger("process");

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ProcessOptions {
  /** 工作目录 */
  cwd?: string;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 超时时间(毫秒)，默认 30000 */
  timeout?: number;
  /** 输入数据 */
  input?: string;
}

/**
 * 执行命令并等待完成。
 *
 * @param command - 命令和参数数组
 * @param options - 执行选项
 * @returns 进程结果(exitCode + stdout + stderr)
 *
 * @example
 * const result = await exec(["git", "status"]);
 * console.log(result.stdout);
 */
export async function exec(command: string[], options: ProcessOptions = {}): Promise<ProcessResult> {
  const timeout = options.timeout ?? 30_000;
  const [cmd, ...args] = command;

  log.debug(`执行命令: ${command.join(" ")}`);

  try {
    const proc = Bun.spawn([cmd!, ...args], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stderr: "pipe",
      stdin: options.input ? "pipe" : undefined,
      stdout: "pipe",
    });

    // 写入输入
    if (options.input && proc.stdin) {
      proc.stdin.write(options.input);
      proc.stdin.end();
    }

    // 超时控制
    // 超时控制：先 SIGTERM，若 1 秒内未退出则 SIGKILL（防止 stdout 管道满导致死锁）
    const timer = setTimeout(() => {
      proc.kill();
      setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* already dead */
        }
      }, 1000);
    }, timeout);
    const exitCode = await proc.exited;
    clearTimeout(timer);

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    log.debug(`命令完成: exit=${exitCode}`);

    return { exitCode, stderr, stdout };
  } catch (error) {
    log.error(`命令执行失败: ${command.join(" ")}`, { error: String(error) });
    return {
      exitCode: -1,
      stderr: error instanceof Error ? error.message : String(error),
      stdout: "",
    };
  }
}

/**
 * 检查命令是否存在。
 */
export async function commandExists(command: string): Promise<boolean> {
  const result = await exec(["which", command], { timeout: 5000 });
  return result.exitCode === 0;
}
