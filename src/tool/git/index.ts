/**
 * Git 操作工具 — 内置 Git 集成。
 *
 * 职责:
 *   - 执行常用 Git 命令
 *   - 查询仓库状态
 *   - 分支管理
 *   - 提交和暂存操作
 *
 * 模块功能:
 *   - gitTool: Git 工具定义
 *   - status: 查看仓库状态
 *   - log: 查看提交历史
 *   - diff: 查看差异
 *   - branch: 分支管理
 *   - add/commit/stash: 基本操作
 *
 * 使用场景:
 *   - AI 需要了解代码仓库状态
 *   - 执行 Git 操作
 *   - 查看提交历史
 *   - 管理分支
 *
 * 边界:
 *   1. 支持常见 Git 操作
 *   2. 自动检测当前仓库
 *   3. 使用 Bun.spawn 执行命令
 *   4. 返回标准输出和错误
 *   5. 支持附加参数
 *
 * 流程:
 *   1. 接收 Git 操作参数
 *   2. 确定工作目录
 *   3. 执行对应 Git 命令
 *   4. 返回执行结果
 */
import { z } from "zod";
import { createLogger } from "@/core/logging/logger";
import { defineTool } from "@/tool/types";

const log = createLogger("tool:git");

const GitParams = z.object({
  args: z.string().optional().describe("附加参数"),
  operation: z
    .enum(["status", "log", "diff", "branch", "add", "commit", "stash", "stash-pop", "checkout", "pull", "fetch"])
    .describe("Git 操作类型"),
  path: z.string().optional().describe("仓库路径(默认 cwd)"),
});

type GitParamsType = z.infer<typeof GitParams>;

const GitMergeParams = z.object({
  branch: z.string().min(1).describe("要合并进当前分支的分支名"),
  noFf: z.boolean().optional().describe("是否使用 --no-ff"),
  path: z.string().optional().describe("仓库路径(默认 cwd)"),
  squash: z.boolean().optional().describe("是否使用 --squash"),
});

const GitRebaseParams = z.object({
  autosquash: z.boolean().optional().describe("是否使用 --autosquash"),
  branch: z.string().min(1).describe("要 rebase 到的目标分支"),
  path: z.string().optional().describe("仓库路径(默认 cwd)"),
});

const GitPushParams = z.object({
  branch: z.string().optional().describe("要推送的分支(默认使用当前 Git 行为)"),
  path: z.string().optional().describe("仓库路径(默认 cwd)"),
  remote: z.string().optional().describe("远端名(默认 origin)"),
  setUpstream: z.boolean().optional().describe("是否设置 upstream"),
  tags: z.boolean().optional().describe("是否同时推送 tags"),
});

const GitTagParams = z.object({
  force: z.boolean().optional().describe("是否覆盖同名标签"),
  message: z.string().optional().describe("标签消息；传入时创建 annotated tag"),
  name: z.string().optional().describe("标签名；不传则列出标签"),
  path: z.string().optional().describe("仓库路径(默认 cwd)"),
});

type GitMergeParamsType = z.infer<typeof GitMergeParams>;
type GitRebaseParamsType = z.infer<typeof GitRebaseParams>;
type GitPushParamsType = z.infer<typeof GitPushParams>;
type GitTagParamsType = z.infer<typeof GitTagParams>;

async function gitExec(cwd: string, ...args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stderr: "pipe",
    stdout: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { exitCode, stderr: stderr.trim(), stdout: stdout.trim() };
}

function formatGitResult(result: { stdout: string; stderr: string; exitCode: number }, fallback = "(无输出)"): string {
  const output = result.stdout || result.stderr || fallback;
  return output.length > 10_000 ? `${output.slice(0, 10_000)}\n...(截断)` : output;
}

async function executeGitMerge(
  params: GitMergeParamsType,
): Promise<{ success: boolean; message?: string; error?: string }> {
  const cwd = params.path ?? process.cwd();
  const args = ["merge"];
  if (params.noFf) {
    args.push("--no-ff");
  }
  if (params.squash) {
    args.push("--squash");
  }
  args.push(params.branch);

  const result = await gitExec(cwd, ...args);
  if (result.exitCode !== 0 && result.stderr) {
    log.warn(`Git merge 退出码 ${result.exitCode}: ${result.stderr}`);
  }
  return { message: formatGitResult(result), success: result.exitCode === 0 };
}

async function executeGitRebase(
  params: GitRebaseParamsType,
): Promise<{ success: boolean; message?: string; error?: string }> {
  const cwd = params.path ?? process.cwd();
  const args = ["rebase"];
  if (params.autosquash) {
    args.push("--autosquash");
  }
  args.push(params.branch);

  const result = await gitExec(cwd, ...args);
  if (result.exitCode !== 0 && result.stderr) {
    log.warn(`Git rebase 退出码 ${result.exitCode}: ${result.stderr}`);
  }
  return { message: formatGitResult(result), success: result.exitCode === 0 };
}

async function executeGitPush(
  params: GitPushParamsType,
): Promise<{ success: boolean; message?: string; error?: string }> {
  const cwd = params.path ?? process.cwd();
  const remote = params.remote ?? "origin";
  const args = ["push"];
  if (params.setUpstream) {
    args.push("--set-upstream");
  }
  args.push(remote);
  if (params.branch) {
    args.push(params.branch);
  }
  if (params.tags) {
    args.push("--tags");
  }

  const result = await gitExec(cwd, ...args);
  if (result.exitCode !== 0 && result.stderr) {
    log.warn(`Git push 退出码 ${result.exitCode}: ${result.stderr}`);
  }
  return {
    message: formatGitResult(result, `Pushed ${params.branch ?? "current branch"} to ${remote}`),
    success: result.exitCode === 0,
  };
}

async function executeGitTag(
  params: GitTagParamsType,
): Promise<{ success: boolean; message?: string; error?: string }> {
  const cwd = params.path ?? process.cwd();
  const args = ["tag"];
  if (!params.name) {
    args.push("-l", "-n");
  } else {
    if (params.force) {
      args.push("-f");
    }
    if (params.message) {
      args.push("-a", params.name, "-m", params.message);
    } else {
      args.push(params.name);
    }
  }

  const result = await gitExec(cwd, ...args);
  if (result.exitCode !== 0 && result.stderr) {
    log.warn(`Git tag 退出码 ${result.exitCode}: ${result.stderr}`);
  }
  const fallback = params.name ? `Created tag ${params.name}` : "(无标签)";
  return { message: formatGitResult(result, fallback), success: result.exitCode === 0 };
}

async function execute(params: GitParamsType): Promise<{ success: boolean; message?: string; error?: string }> {
  const cwd = params.path ?? process.cwd();

  try {
    let result: { stdout: string; stderr: string; exitCode: number };

    switch (params.operation) {
      case "status": {
        result = await gitExec(cwd, "status", "--short", "--branch");
        break;
      }
      case "log": {
        const count = params.args ?? "10";
        result = await gitExec(cwd, "log", `--oneline`, `-${count}`);
        break;
      }
      case "diff": {
        result = await gitExec(cwd, "diff", ...(params.args?.split(" ") ?? []));
        break;
      }
      case "branch": {
        result = await gitExec(cwd, "branch", "-a", "--sort=-committerdate");
        break;
      }
      case "add": {
        result = await gitExec(cwd, "add", params.args ?? ".");
        break;
      }
      case "commit": {
        if (!params.args) {
          return { error: "错误: commit 需要提交消息参数", success: false };
        }
        result = await gitExec(cwd, "commit", "-m", params.args);
        break;
      }
      case "stash": {
        result = await gitExec(cwd, "stash", ...(params.args ? [params.args] : ["push"]));
        break;
      }
      case "stash-pop": {
        result = await gitExec(cwd, "stash", "pop");
        break;
      }
      case "checkout": {
        if (!params.args) {
          return { error: "错误: checkout 需要分支名参数", success: false };
        }
        result = await gitExec(cwd, "checkout", params.args);
        break;
      }
      case "pull": {
        result = await gitExec(cwd, "pull", ...(params.args?.split(" ") ?? []));
        break;
      }
      case "fetch": {
        result = await gitExec(cwd, "fetch", ...(params.args?.split(" ") ?? []));
        break;
      }
      default: {
        return { error: `不支持的操作: ${params.operation}`, success: false };
      }
    }

    if (result.exitCode !== 0 && result.stderr) {
      log.warn(`Git ${params.operation} 退出码 ${result.exitCode}: ${result.stderr}`);
    }

    return { message: formatGitResult(result), success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error(`Git ${params.operation} 失败: ${msg}`);
    return { error: `Git 操作失败: ${msg}`, success: false };
  }
}

/** Git 操作工具：status/log/diff/branch/add/commit/stash/checkout/pull/fetch */
export const gitTool = defineTool({
  description:
    "Git 操作工具:status/log/diff/branch/add/commit/stash/checkout/pull/fetch (merge/rebase/push/tag 请使用各自的独立工具 git_merge/git_rebase/git_push/git_tag)",
  execute,
  name: "git",
  parameters: GitParams,
  permission: "git",
  builtin: true,
});

/** Git merge 工具：合并分支 */
export const gitMerge = defineTool({
  description: "Git merge:将指定分支合并到当前分支，支持 --no-ff 和 --squash",
  execute: executeGitMerge,
  name: "git_merge",
  parameters: GitMergeParams,
  permission: "git.merge",
  builtin: true,
});

/** Git rebase 工具：变基操作 */
export const gitRebase = defineTool({
  description: "Git rebase:将当前分支 rebase 到指定目标分支",
  execute: executeGitRebase,
  name: "git_rebase",
  parameters: GitRebaseParams,
  permission: "git.rebase",
  builtin: true,
});

/** Git push 工具：推送分支 */
export const gitPush = defineTool({
  description: "Git push:推送当前分支或指定分支，可设置 upstream 并推送 tags",
  execute: executeGitPush,
  name: "git_push",
  parameters: GitPushParams,
  permission: "git.push",
  builtin: true,
});

/** Git tag 工具：列出或创建标签 */
export const gitTag = defineTool({
  description: "Git tag:列出标签或创建 lightweight/annotated tag",
  execute: executeGitTag,
  name: "git_tag",
  parameters: GitTagParams,
  permission: "git.tag",
  builtin: true,
});

export default gitTool;
