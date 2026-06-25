/**
 * 终端执行工具 — 本地命令执行 + SSH 远程执行。
 *
 * 职责:
 *   - 执行本地终端命令
 *   - 支持 SSH 远程执行
 *   - 提供超时控制
 *   - 支持交互式命令
 *   - 支持后台执行
 *
 * 模块功能:
 *   - bashTool: 终端执行工具定义
 *   - 本地命令执行
 *   - SSH 远程执行
 *   - 后台进程管理
 *
 * 使用场景:
 *   - 运行构建/测试/lint
 *   - Git 操作
 *   - 包管理
 *   - 系统工具调用
 *
 * 边界:
 *   1. 权限:bash
 *   2. 自毁命令保护(检测杀死 crab-cli 自身进程的命令)
 *   3. 强制 UTF-8 locale 环境变量
 *   4. SSH 连接池复用
 *   5. 长输出自动压缩摘要
 *   6. Windows 自动检测 pwsh/powershell/cmd
 *   7. 支持 stdin 交互式输入
 *   8. 支持后台执行模式
 *
 * 流程:
 *   1. 接收命令参数
 *   2. 检测是否需要 SSH
 *   3. 检查自毁命令
 *   4. 设置环境变量
 *   5. 执行命令
 *   6. 处理输出(超长时摘要)
 *   7. 返回结果
 */
import { z } from "zod";
import { defineTool } from "@/tool/types";
import { createLogger } from "@/core/logging/logger";
import { loadConfig } from "@/config";
import { executeSSH, executeSSHWithContext } from "./sshExecution";
import { shouldUseSSH } from "./sshExec";
import { executeLocal, handleBackgroundAction } from "./bashLocalExecution";
import { createInternalError } from "@/core/errors/appError";

const log = createLogger("tool:bash");

const bashToolDeps = {
  loadConfig,
};

/** 测试用依赖注入，覆盖 bash 工具的内部依赖 */
export function __setBashToolDepsForTesting(overrides: Partial<typeof bashToolDeps>): void {
  Object.assign(bashToolDeps, overrides);
}

/** 重置 bash 工具的测试依赖为默认值 */
export function __resetBashToolDepsForTesting(): void {
  bashToolDeps.loadConfig = loadConfig;
}

// ── Shell 参数消毒 ──────────────────────────────────────────
/**
 * 对 SSH 远程命令进行消毒。
 * 过滤 shell 元字符，防止通过 command 参数注入额外命令。
 *
 * 注意:SSH 远程执行通过 conn.exec(remoteCmd) 执行的字符串
 * 会经过远程 shell 解析，因此 && 后的 command 中的 shell 元字符
 * 会导致命令注入(如 ; rm -rf /)。
 *
 * 安全检查已抽取到 @ssh/safety 模块，本文件通过 import 复用。
 */

/** 默认超时 30 秒 */
const DEFAULT_TIMEOUT = 30_000;

const sshConnectionConfigSchema = z.object({
  host: z.string(),
  passphrase: z.string().optional(),
  password: z.string().optional(),
  port: z.number().optional(),
  privateKey: z.string().optional(),
  readyTimeout: z.number().optional(),
  username: z.string(),
});

const sshExecContextSchema = z.object({
  connection: sshConnectionConfigSchema.optional(),
  cwd: z.string().optional(),
  workspaceId: z.string().optional(),
});

/** 终端执行工具，支持本地命令和 SSH 远程执行 */
export const bashTool = defineTool({
  description:
    "执行终端命令。支持本地和 SSH 远程执行。" +
    "SSH 模式:当 workingDirectory 以 ssh:// 开头时自动启用。" +
    "Windows:自动检测 pwsh/powershell/cmd。" +
    "交互式:传入 stdin 参数可向进程输入数据。" +
    "后台:设置 background=true 可让命令在后台运行。" +
    "用途:(1) 运行构建/测试/lint (2) Git 操作 (3) 包管理 (4) 系统工具。" +
    "对于文件修改，优先使用 filesystem-edit/filesystem-write 工具。",
  execute: async ({
    command,
    workingDirectory,
    timeout,
    stdin,
    background,
    backgroundId,
    backgroundAction,
    sshContext,
  }) => {
    const effectiveTimeout = timeout ?? DEFAULT_TIMEOUT;
    const cwd = workingDirectory ?? process.cwd();

    // SSH 远程执行模式
    // 防御性检查:shouldUseSSH 可能被其他测试的 mock.module 污染
    // (如 28Ssh/30Ssh/bashSsh.test.ts 跨文件泄漏)，仅当 sshContext
    // 真正存在时进入 SSH 分支。
    if (sshContext && shouldUseSSH(sshContext)) {
      return executeSSHWithContext(command, sshContext, effectiveTimeout);
    }

    // G14: 后台进程管理
    if (backgroundId && backgroundAction) {
      return handleBackgroundAction(backgroundId, backgroundAction);
    }

    // G2: 安全检查 — 危险命令 + 自毁命令
    const { isDangerousCommand, isSelfDestructiveCommand } = await import("@/tool/bash/security");
    if (isDangerousCommand(command)) {
      log.warn(`阻止危险命令: ${command}`);
      return {
        blocked: true,
        command: `$ ${command}`,
        durationMs: 0,
        error: "命令被阻止:检测到危险命令模式(如 rm -rf /, mkfs, dd 等)。如果确实需要执行，请使用系统终端。",
        exitCode: -1,
        output: "",
        workingDirectory: cwd,
      };
    }
    const selfCheck = isSelfDestructiveCommand(command);
    if (selfCheck.isSelfDestructive) {
      log.warn(`阻止自毁命令: ${command}`);
      return {
        blocked: true,
        command: `$ ${command}`,
        durationMs: 0,
        error: `命令被阻止:${selfCheck.reason ?? "检测到可能杀死当前进程的操作"}。${selfCheck.suggestion ?? "如果确实需要执行，请使用系统终端。"}`,
        exitCode: -1,
        output: "",
        workingDirectory: cwd,
      };
    }

    // 敏感命令检测(40+ 预设规则 + 自定义规则)
    try {
      const { isSensitiveCommand } = await import("@/permission/security/sensitiveCommand");
      const sensitive = isSensitiveCommand(command);
      if (sensitive.isSensitive && sensitive.matchedCommand) {
        const cmd = sensitive.matchedCommand;
        // 危险操作直接阻止，其他操作确认
        // 使用 normalizeId 统一清洗两侧比较，避免正则 /[^a-z0-9-]/gi 导致 "git push*--force" → "gitpushforce" 匹配失效
        const normalizeId = (s: string) =>
          s
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "");
        const dangerousIds = new Set([
          "rm",
          "rmdir",
          "unlink",
          "dd",
          "mkfs",
          "fdisk",
          "gitpushforce",
          "gitpushf",
          "gitresethard",
          "gitcleanf",
          "droptable",
          "dropdatabase",
          "truncate",
          "removeitemrecurse",
          "formatvolume",
          "npmpublish",
        ]);
        const isBlock =
          dangerousIds.has(normalizeId(cmd.id)) ||
          cmd.pattern.includes("*--force") ||
          cmd.pattern.includes("DROP") ||
          cmd.pattern.includes("TRUNCATE");

        if (isBlock) {
          log.warn(`阻止敏感命令: ${command} (${cmd.description})`);
          return {
            blocked: true,
            command: `$ ${command}`,
            durationMs: 0,
            error: `命令被阻止:检测到敏感操作 "${cmd.description}"。如果确实需要执行，请修改配置或使用系统终端。`,
            exitCode: -1,
            output: "",
            workingDirectory: cwd,
          };
        }
        // Confirm 类型的敏感命令标记(权限层会额外提示)
        log.info(`敏感命令需确认: ${command} (${cmd.description})`);
      }
    } catch {
      // 配置不可用时跳过敏感命令检测
    }

    // SSH 远程模式检测
    if (cwd.startsWith("ssh://")) {
      return executeSSH(command, cwd, effectiveTimeout);
    }

    // 本地执行
    return executeLocal(command, cwd, effectiveTimeout, stdin, background);
  },
  name: "terminal-execute",
  parameters: z.object({
    /** G14: 是否后台执行 */
    background: z.boolean().optional().describe("是否在后台执行命令(不等待完成)"),
    /** G14: 后台操作类型 */
    backgroundAction: z.enum(["status", "output", "kill"]).optional().describe("对后台进程的操作:status/output/kill"),
    /** G14: 后台进程 ID(用于查询状态) */
    backgroundId: z.string().optional().describe("后台进程 ID(由后台执行返回)"),
    /** 要执行的命令 */
    command: z.string().describe("要执行的终端命令"),
    /** SSH 执行上下文 */
    sshContext: sshExecContextSchema.optional().describe("SSH 执行上下文，用于远程执行命令"),
    /** G13: 标准输入数据(交互式命令用) */
    stdin: z.string().optional().describe("向进程标准输入写入的数据"),
    /** 超时时间(毫秒) */
    timeout: z.number().optional().describe("超时时间(毫秒)，默认 30000"),
    /** 工作目录 */
    workingDirectory: z.string().optional().describe("命令执行的工作目录"),
  }),
  permission: "bash",
  builtin: true,
});

// ── SSH 远程命令执行 ──────────────────────────────────────────

// SSH 执行函数已移至 sshExecution.ts
