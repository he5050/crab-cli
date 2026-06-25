/**
 * SSH 远程命令执行。
 *
 * 提供 SSH 连接执行、配置解析和上下文模式执行。
 */
import { createLogger } from "@/core/logging/logger";
import { execSSH, shouldUseSSH } from "./sshExec";
import { checkSSHDenylist, sanitizeSSHCommand } from "@/server/ssh";
import { parseSSHUrl } from "./sshUrl";
import type { SSHExecContext } from "@/server/ssh";
import { createInternalError } from "@/core/errors/appError";

const log = createLogger("tool:bash");

/**
 * 对将要嵌入单引号 shell 字符串的参数进行安全转义。
 * 同时拒绝路径遍历(..)，防止通过 SSH 远程路径逃逸。
 */
function sanitizeShellArg(arg: string): string {
  if (arg.includes("..")) {
    throw createInternalError("INTERNAL_ERROR", `路径遍历被拒绝: 参数包含 ".."`);
  }
  return arg.replace(/'/g, String.raw`'\''`);
}

/**
 * 外部可配置的依赖项(setupBashToolDeps 在 index.ts 中初始化)。
 * 直接引用 index.ts 中的 bashToolDeps 会导致循环依赖，因此我们接受
 * 一个 factory。
 */
let _loadConfig: () => Promise<unknown> = async () => {
  const { loadConfig } = await import("@/config");
  return loadConfig();
};

/** 设置 SSH 模块的配置加载器(由 index.ts 调用) */
export function __setSshDepsForTesting(loadConfig: () => Promise<unknown>): void {
  _loadConfig = loadConfig;
}

interface ResolvedSshConfig {
  password?: string;
  privateKey?: string;
  passphrase?: string;
  hostVerifier?: (key: Buffer) => boolean;
  knownHostKeys?: string[];
}

async function resolveSshConfig(host: string, port: number, user: string): Promise<ResolvedSshConfig | null> {
  try {
    const config = (await _loadConfig()) as Record<string, unknown>;
    const sshConfig = config.sshConfig as Record<string, unknown> | undefined;
    if (!sshConfig) {
      return null;
    }

    const cfgHost = typeof sshConfig.host === "string" ? sshConfig.host : undefined;
    const cfgPort = typeof sshConfig.port === "number" ? sshConfig.port : 22;
    const cfgUser =
      typeof sshConfig.username === "string"
        ? sshConfig.username
        : typeof sshConfig.user === "string"
          ? sshConfig.user
          : undefined;

    if (cfgHost !== host || cfgPort !== port || cfgUser !== user) {
      return null;
    }

    return {
      passphrase: typeof sshConfig.passphrase === "string" ? sshConfig.passphrase : undefined,
      password: typeof sshConfig.password === "string" ? sshConfig.password : undefined,
      privateKey: typeof sshConfig.privateKey === "string" ? sshConfig.privateKey : undefined,
    };
  } catch {
    return null;
  }
}

/** 通过 ssh2 模块在远程主机上执行命令，包含路径消毒和 deny-list 检查 */
export async function executeSSH(command: string, sshPath: string, timeout: number): Promise<Record<string, unknown>> {
  const startTime = Date.now();

  const parsed = parseSSHUrl(sshPath);
  if (!parsed) {
    return {
      command: `$ ${command}`,
      durationMs: Date.now() - startTime,
      error: `无效的 SSH 路径格式: ${sshPath}。期望格式: ssh://user@host[:port]/path`,
      exitCode: -1,
      output: "",
      workingDirectory: sshPath,
    };
  }

  log.info(`SSH 执行: ${parsed.username}@${parsed.host}:${parsed.port}`, { command });

  try {
    // 延迟加载 ssh2 模块(可选依赖，可能未安装)
    // @ts-expect-error — ssh2 是可选依赖，类型声明可能不存在
    const ssh2 = await import("ssh2");
    const Client = ssh2.Client ?? (ssh2 as any).default?.Client;

    if (!Client) {
      return {
        command: `$ ${command}`,
        durationMs: Date.now() - startTime,
        error: "ssh2 模块加载失败。请确认已安装: bun add ssh2",
        exitCode: -1,
        output: "",
        workingDirectory: sshPath,
      };
    }

    const sshConfig = await resolveSshConfig(parsed.host, parsed.port, parsed.username);
    const result = await new Promise<Record<string, unknown>>((resolve) => {
      const conn = new Client();

      const timer = setTimeout(() => {
        conn.end();
        resolve({
          command: `$ ${command}`,
          durationMs: Date.now() - startTime,
          error: `SSH 命令超时 (${timeout}ms)`,
          exitCode: -1,
          output: "",
          workingDirectory: sshPath,
        });
      }, timeout);

      conn.on("ready", () => {
        // 路径消毒:拒绝路径遍历 + 单引号转义
        let safePath: string;
        try {
          safePath = sanitizeShellArg(parsed.path);
        } catch (error) {
          clearTimeout(timer);
          conn.end();
          resolve({
            command: `$ ${command}`,
            durationMs: Date.now() - startTime,
            error: `SSH 路径被拒绝: ${error instanceof Error ? error.message : String(error)}`,
            exitCode: -1,
            output: "",
            workingDirectory: sshPath,
          });
          return;
        }

        // 命令消毒:拒绝 shell 元字符注入
        let safeCommand: string;
        try {
          safeCommand = sanitizeSSHCommand(command);
        } catch (error) {
          clearTimeout(timer);
          conn.end();
          resolve({
            command: `$ ${command}`,
            durationMs: Date.now() - startTime,
            error: `SSH 命令被拒绝: ${error instanceof Error ? error.message : String(error)}`,
            exitCode: -1,
            output: "",
            workingDirectory: sshPath,
          });
          return;
        }

        // Deny-list 检查
        const denylistError = checkSSHDenylist(safeCommand);
        if (denylistError) {
          clearTimeout(timer);
          conn.end();
          resolve({
            blocked: true,
            command: `$ ${command}`,
            durationMs: Date.now() - startTime,
            error: denylistError,
            exitCode: -1,
            output: "",
            workingDirectory: sshPath,
          });
          return;
        }

        const remoteCmd = parsed.path ? `cd '${safePath}' && ${safeCommand}` : safeCommand;
        conn.exec(remoteCmd, (err: Error | undefined, stream: any) => {
          if (err) {
            clearTimeout(timer);
            conn.end();
            resolve({
              command: `$ ${command}`,
              durationMs: Date.now() - startTime,
              error: `SSH 执行失败: ${err.message}`,
              exitCode: -1,
              output: "",
              workingDirectory: sshPath,
            });
            return;
          }

          let stdout = "";
          let stderr = "";

          stream.on("data", (data: Buffer) => {
            stdout += data.toString();
          });
          stream.stderr.on("data", (data: Buffer) => {
            stderr += data.toString();
          });
          stream.on("close", (code: number) => {
            clearTimeout(timer);
            conn.end();

            let output = stdout;
            if (stderr) {
              if (output) {
                output += "\n";
              }
              output += stderr;
            }

            // 截断统一由 executor truncateByTokenLimit 处理

            resolve({
              command: `$ ${command}`,
              durationMs: Date.now() - startTime,
              exitCode: code ?? 0,
              output,
              ssh: { host: parsed.host, user: parsed.username },
              workingDirectory: sshPath,
            });
          });
        });
      });

      conn.on("error", (err: Error) => {
        clearTimeout(timer);
        resolve({
          command: `$ ${command}`,
          durationMs: Date.now() - startTime,
          error: `SSH 连接失败: ${err.message}`,
          exitCode: -1,
          output: "",
          workingDirectory: sshPath,
        });
      });

      // 连接配置
      const connectConfig: Record<string, unknown> = {
        host: parsed.host,
        port: parsed.port,
        readyTimeout: Math.min(timeout, 15_000),
        username: parsed.username,
        hostVerifier: (key: Buffer): boolean => {
          if (sshConfig?.hostVerifier) {
            return sshConfig.hostVerifier(key);
          }
          if (sshConfig?.knownHostKeys && sshConfig.knownHostKeys.length > 0) {
            const crypto = require("node:crypto");
            const fingerprint = `SHA256:${crypto.createHash("sha256").update(key).digest("base64")}`;
            return sshConfig.knownHostKeys.includes(fingerprint);
          }
          // 无已知密钥时拒绝连接，防止中间人攻击
          return false;
        },
      };

      if (sshConfig?.password) {
        connectConfig.password = sshConfig.password;
      } else if (sshConfig?.privateKey) {
        connectConfig.privateKey = sshConfig.privateKey;
        if (sshConfig.passphrase) {
          connectConfig.passphrase = sshConfig.passphrase;
        }
      } else if (process.env.SSH_AUTH_SOCK) {
        connectConfig.agent = process.env.SSH_AUTH_SOCK;
      }

      conn.connect(connectConfig);
    });

    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("Cannot find") || msg.includes("MODULE_NOT_FOUND")) {
      return {
        command: `$ ${command}`,
        durationMs: Date.now() - startTime,
        error: "SSH 模块未安装。请运行: bun add ssh2",
        exitCode: -1,
        output: "",
        workingDirectory: sshPath,
      };
    }
    return {
      command: `$ ${command}`,
      durationMs: Date.now() - startTime,
      error: `SSH 执行错误: ${msg}`,
      exitCode: -1,
      output: "",
      workingDirectory: sshPath,
    };
  }
}

// ── SSH 上下文执行 ──────────────────────────────────────────────

/** 使用已建立的 SSH 上下文在远程主机上执行命令 */
export async function executeSSHWithContext(
  command: string,
  sshContext: SSHExecContext,
  timeout: number,
): Promise<Record<string, unknown>> {
  const startTime = Date.now();

  try {
    log.info(`SSH 执行 (上下文模式): ${command}`, { cwd: sshContext.cwd });

    const result = await execSSH(command, sshContext, { timeout });

    const durationMs = Date.now() - startTime;
    let output = result.stdout;
    if (result.stderr) {
      if (output) {
        output += "\n";
      }
      output += result.stderr;
    }

    // 截断统一由 executor truncateByTokenLimit 处理

    const response: Record<string, unknown> = {
      command: `$ ${command}`,
      durationMs,
      exitCode: result.exitCode,
      output,
      ssh: true,
      workingDirectory: sshContext.cwd || "",
    };

    if (result.exitCode !== 0) {
      response.error = `命令退出码: ${result.exitCode}`;
    }

    log.info(`SSH 执行完成: exit=${result.exitCode}, duration=${durationMs}ms`);
    return response;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error(`SSH 执行失败: ${command}`, { error: msg });
    return {
      command: `$ ${command}`,
      durationMs: Date.now() - startTime,
      error: msg,
      exitCode: -1,
      output: "",
      ssh: true,
      workingDirectory: sshContext.cwd || "",
    };
  }
}
