import { createLogger } from "@/core/logging/logger";
import { prefixedId } from "@/core/id";

const log = createLogger("tool:bash");

/** 最大输出长度 */
export const MAX_OUTPUT_LENGTH = 50_000;

/** AI 摘要触发的输出长度阈值 */
const AI_SUMMARY_THRESHOLD = 20_000;

/** 后台进程注册表 */
const backgroundProcesses = new Map<string, { proc: any; startTime: number; cwd: string }>();

/** 检测当前平台的默认 shell */
function detectShell(): string[] {
  if (process.platform === "win32") {
    if (process.env.PWSH_PATH || process.env.ComSpec?.includes("pwsh")) {
      return ["pwsh", "-Command"];
    }
    if (process.env.ComSpec?.includes("powershell")) {
      return ["powershell", "-Command"];
    }
    return ["cmd", "/C"];
  }

  if (process.env.SHELL?.endsWith("bash") || isBashAvailable()) {
    return ["bash", "-c"];
  }
  const shell = process.env.SHELL ?? "/bin/sh";
  return [shell, "-c"];
}

/** 检测 bash 是否可用 */
let bashAvailable: boolean | null = null;
function isBashAvailable(): boolean {
  if (bashAvailable !== null) {
    return bashAvailable;
  }
  try {
    const proc = Bun.spawnSync(["bash", "--version"], { stderr: "ignore", stdout: "ignore" });
    bashAvailable = proc.exitCode === 0;
  } catch {
    bashAvailable = false;
  }
  return bashAvailable;
}

// ── 本地命令执行 ──────────────────────────────────────────────

/** 在本地 shell 中执行命令，支持后台运行和 stdin 输入 */
export async function executeLocal(
  command: string,
  cwd: string,
  timeout: number,
  stdinData?: string,
  background?: boolean,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const startTime = Date.now();
  const shellArgs = detectShell();
  log.info(`执行: $ ${command}`, { background, cwd, shell: shellArgs[0], timeout });

  try {
    const proc = Bun.spawn([...shellArgs, command], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      stdin: stdinData ? "pipe" : "ignore",
      ...(signal ? { signal } : {}),
      env: {
        ...process.env,
        LANG: "en_US.UTF-8",
        LC_ALL: "en_US.UTF-8",
      },
    });

    if (stdinData && proc.stdin) {
      proc.stdin.write(new TextEncoder().encode(stdinData));
      proc.stdin.end();
    }

    if (background) {
      const bgId = prefixedId("bg", "_", 4);
      backgroundProcesses.set(bgId, { cwd, proc, startTime });
      log.info(`后台命令已启动: ${bgId} ($ ${command})`);
      return {
        backgroundId: bgId,
        command: `$ ${command}`,
        durationMs: Date.now() - startTime,
        exitCode: 0,
        output: `后台命令已启动 (ID: ${bgId})\n使用 backgroundAction="status" + backgroundId="${bgId}" 查看状态`,
        workingDirectory: cwd,
      };
    }

    const exitCode = await new Promise<number>((resolve) => {
      const timer = setTimeout(() => {
        try {
          proc.kill();
        } catch {
          /* Already exited */
        }
        resolve(-1);
      }, timeout);

      proc.exited
        .then((code) => {
          clearTimeout(timer);
          resolve(code);
        })
        .catch(() => {
          clearTimeout(timer);
          resolve(-1);
        });
    });

    const durationMs = Date.now() - startTime;

    let stdout = "";
    let stderr = "";
    try {
      stdout = await Promise.race([
        new Response(proc.stdout).text(),
        new Promise<string>((r) => setTimeout(() => r(""), 2000)),
      ]);
    } catch {
      /* Pipe closed */
    }
    try {
      stderr = await Promise.race([
        new Response(proc.stderr).text(),
        new Promise<string>((r) => setTimeout(() => r(""), 2000)),
      ]);
    } catch {
      /* Pipe closed */
    }

    let output = "";
    if (stdout) {
      output += stdout;
    }
    if (stderr) {
      if (output) {
        output += "\n";
      }
      output += stderr;
    }

    let needsSummary = false;
    if (output.length > AI_SUMMARY_THRESHOLD) {
      needsSummary = true;
    }

    // 截断统一由 executor truncateByTokenLimit 处理，此处不再重复截断

    const result: Record<string, unknown> = {
      command: `$ ${command}`,
      durationMs,
      exitCode,
      output,
      workingDirectory: cwd,
      ...(needsSummary && { needsSummary: true, outputLength: output.length }),
    };

    if (exitCode !== 0) {
      result.error = `命令退出码: ${exitCode}`;
    }

    log.info(`完成: exit=${exitCode}, duration=${durationMs}ms${needsSummary ? " (需摘要)" : ""}`);
    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error(`执行失败: ${command}`, { error: msg });
    return {
      command: `$ ${command}`,
      durationMs: Date.now() - startTime,
      error: msg,
      exitCode: -1,
      output: "",
      workingDirectory: cwd,
    };
  }
}

// ── 后台命令管理 ───────────────────────────────────────────────

/** 处理后台命令操作（status/output/kill） */
export function handleBackgroundAction(bgId: string, action: string): Record<string, unknown> {
  const entry = backgroundProcesses.get(bgId);
  if (!entry) {
    return { backgroundId: bgId, error: `后台进程不存在: ${bgId}`, exitCode: -1, output: "" };
  }

  switch (action) {
    case "status": {
      const running = entry.proc.exitCode === null;
      const durationMs = Date.now() - entry.startTime;
      return {
        backgroundId: bgId,
        durationMs,
        exitCode: running ? null : entry.proc.exitCode,
        output: running
          ? `进程运行中 (${Math.round(durationMs / 1000)}秒)`
          : `进程已完成 (exit=${entry.proc.exitCode})`,
        running,
      };
    }
    case "output": {
      let output = "";
      try {
        output = "(输出需在前台执行时获取)";
      } catch {
        /* Ignore */
      }
      return { backgroundId: bgId, output };
    }
    case "kill": {
      try {
        entry.proc.kill();
        backgroundProcesses.delete(bgId);
        log.info(`后台进程已终止: ${bgId}`);
        return { backgroundId: bgId, exitCode: -1, output: `进程 ${bgId} 已终止` };
      } catch {
        return { backgroundId: bgId, error: `终止进程失败: ${bgId}`, exitCode: -1, output: "" };
      }
    }
    default: {
      return { backgroundId: bgId, error: `未知后台操作: ${action}`, exitCode: -1, output: "" };
    }
  }
}
