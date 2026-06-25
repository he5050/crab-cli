/**
 * 异步 Git 分支读取 — P1-6 完整异步化
 *
 * 替代 `Bun.spawnSync` 同步调用，避免阻塞 UI 渲染。
 * 特性:
 *   1. 完全异步:Bun.spawn + Promise.all
 *   2. 超时保护:默认 2 秒超时，自动 kill 进程
 *   3. 可注入进程运行器:测试可注入 Mock
 *   4. 错误隔离:超时/错误返回空字符串而非抛错
 *
 * 使用场景:
 *   - StatusBar 每 5 秒刷新当前 Git 分支
 *   - 不需要 abortSignal(每次调用是独立查询)
 */

import { createLogger } from "@/core/logging/logger";

const log = createLogger("statusbar:git");

/** 进程运行器接口(可注入用于测试) */
export interface GitProcRunner {
  spawn(
    args: string[],
    options: { cwd: string; stdout: "pipe"; stderr: "pipe" },
  ): {
    exited: Promise<number>;
    stdout: ReadableStream<Uint8Array>;
    kill(): void;
  };
}

/** 默认运行器使用 Bun.spawn */
const defaultBunRunner: GitProcRunner = {
  spawn(args, options) {
    const proc = Bun.spawn(args, options);
    return {
      exited: proc.exited,
      kill: () => proc.kill(),
      stdout: proc.stdout,
    };
  },
};

export interface ReadGitBranchOptions {
  /** 当前工作目录(默认 process.cwd()) */
  cwd?: string;
  /** 超时毫秒(默认 2000) */
  timeoutMs?: number;
  /** 进程运行器(注入 Mock 用于测试) */
  runner?: GitProcRunner;
}

/**
 * 异步读取当前 Git 分支。
 *
 * @returns 分支名(无 git/超时/错误返回空字符串)
 */
export async function readGitBranch(options: ReadGitBranchOptions = {}): Promise<string> {
  const { cwd = process.cwd(), timeoutMs = 2000, runner = defaultBunRunner } = options;

  let proc: ReturnType<GitProcRunner["spawn"]> | null = null;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  try {
    proc = runner.spawn(["git", "branch", "--show-current"], {
      cwd,
      stderr: "pipe",
      stdout: "pipe",
    });

    let killed = false;
    // 超时保护
    timeoutHandle = setTimeout(() => {
      try {
        proc?.kill();
        killed = true;
        log.debug(`git branch 超时 (${timeoutMs}ms)，已 kill`);
      } catch {
        // Noop
      }
    }, timeoutMs);

    // 使用 Promise.race 让超时立即返回空字符串
    const racePromise = Promise.all([proc.exited, new Response(proc.stdout).text()]).then(([exitCode, stdout]) => ({
      exitCode,
      stdout,
      timedOut: false,
    }));

    const timeoutPromise = new Promise<{ timedOut: true; exitCode: number; stdout: string }>((resolve) => {
      // 检查 killed 标志
      const checkKilled = () => {
        if (killed) {
          resolve({ exitCode: -1, stdout: "", timedOut: true });
        } else {
          setTimeout(checkKilled, 10);
        }
      };
      setTimeout(checkKilled, timeoutMs);
    });

    const result = await Promise.race([racePromise, timeoutPromise]);

    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }

    if (result.timedOut) {
      return "";
    }
    if (result.exitCode !== 0) {
      return "";
    }
    return result.stdout.trim();
  } catch (error) {
    log.debug("readGitBranch 失败", { error: (error as Error).message });
    return "";
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}
