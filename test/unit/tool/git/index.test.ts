/**
 * Git 工具模块单元测试
 *
 * 覆盖范围:
 *   - gitTool.execute 各操作: status / log / diff / branch / add / commit / stash / stash-pop / checkout / pull / fetch
 *   - gitMerge / gitRebase / gitPush / gitTag 独立工具
 *   - commit / checkout 缺少参数时的错误处理
 *   - formatGitResult 截断逻辑 (超过 10000 字符)
 *   - gitExec 失败时的错误传播
 *
 * Mock 策略:
 *   - 通过替换 Bun.spawn 全局方法避免真实调用 git
 *   - 通过 spy process.cwd 控制工作目录
 */

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";

import { gitTool, gitMerge, gitPush, gitRebase, gitTag } from "@/tool/git/index";

// ---- helpers ----

/** 构造一个模拟的 Bun.spawn 子进程对象 */
function fakeProc(stdout: string, stderr: string, exitCode: number) {
  return {
    exited: Promise.resolve(exitCode),
    stderr: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(stderr));
        controller.close();
      },
    }),
    stdout: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(stdout));
        controller.close();
      },
    }),
  };
}

const originalSpawn = Bun.spawn;
const originalCwd = process.cwd;

describe("@tool/git", () => {
  // 备份并保存原始 Bun.spawn 与 process.cwd
  let spawnCalls: Array<{ cmd: string[]; opts: Record<string, unknown> }> = [];

  beforeEach(() => {
    spawnCalls = [];
    // mock process.cwd 以返回固定测试路径
    spyOn(process, "cwd").mockReturnValue("/fake/repo");
    // mock Bun.spawn 记录调用并返回控制输出
    Bun.spawn = mock((cmd: string[], opts?: Record<string, unknown>) => {
      spawnCalls.push({ cmd, opts: opts ?? {} });
      return fakeProc("mock stdout", "mock stderr", 0);
    }) as typeof Bun.spawn;
  });

  afterEach(() => {
    Bun.spawn = originalSpawn;
    (process.cwd as unknown as ReturnType<typeof spyOn>).mockRestore?.();
  });

  // ---- gitTool: status ----
  it("status 操作调用 git status --short --branch", async () => {
    const result = await gitTool.execute({ operation: "status" });

    expect(result.success).toBe(true);
    expect(spawnCalls[0].cmd).toEqual(["git", "status", "--short", "--branch"]);
  });

  // ---- gitTool: log ----
  it("log 操作默认使用 -10 并支持自定义数量", async () => {
    // 默认 count
    const r1 = await gitTool.execute({ operation: "log" });
    expect(r1.success).toBe(true);
    expect(spawnCalls[0].cmd).toEqual(["git", "log", "--oneline", "-10"]);

    spawnCalls.length = 0;

    // 自定义 count
    const r2 = await gitTool.execute({ operation: "log", args: "5" });
    expect(r2.success).toBe(true);
    expect(spawnCalls[0].cmd).toEqual(["git", "log", "--oneline", "-5"]);
  });

  // ---- gitTool: diff ----
  it("diff 操作传递附加参数", async () => {
    const result = await gitTool.execute({ operation: "diff", args: "HEAD~1 HEAD" });

    expect(result.success).toBe(true);
    expect(spawnCalls[0].cmd).toEqual(["git", "diff", "HEAD~1", "HEAD"]);
  });

  // ---- gitTool: branch ----
  it("branch 操作调用 git branch -a --sort=-committerdate", async () => {
    const result = await gitTool.execute({ operation: "branch" });

    expect(result.success).toBe(true);
    expect(spawnCalls[0].cmd).toEqual(["git", "branch", "-a", "--sort=-committerdate"]);
  });

  // ---- gitTool: add ----
  it("add 操作默认添加 '.' ，支持指定路径", async () => {
    // 默认
    const r1 = await gitTool.execute({ operation: "add" });
    expect(r1.success).toBe(true);
    expect(spawnCalls[0].cmd).toEqual(["git", "add", "."]);

    spawnCalls.length = 0;

    // 指定路径
    const r2 = await gitTool.execute({ operation: "add", args: "src/foo.ts" });
    expect(r2.success).toBe(true);
    expect(spawnCalls[0].cmd).toEqual(["git", "add", "src/foo.ts"]);
  });

  // ---- gitTool: commit (缺少参数) ----
  it("commit 缺少 args 时返回错误", async () => {
    const result = await gitTool.execute({ operation: "commit" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("commit 需要提交消息参数");
    expect(spawnCalls.length).toBe(0);
  });

  // ---- gitTool: commit (正常) ----
  it("commit 带参数时调用 git commit -m", async () => {
    const result = await gitTool.execute({ operation: "commit", args: "fix: 修复 bug" });

    expect(result.success).toBe(true);
    expect(spawnCalls[0].cmd).toEqual(["git", "commit", "-m", "fix: 修复 bug"]);
  });

  // ---- gitTool: stash / stash-pop ----
  it("stash 操作默认 push，stash-pop 弹出最近暂存", async () => {
    const r1 = await gitTool.execute({ operation: "stash" });
    expect(r1.success).toBe(true);
    expect(spawnCalls[0].cmd).toEqual(["git", "stash", "push"]);

    spawnCalls.length = 0;

    const r2 = await gitTool.execute({ operation: "stash-pop" });
    expect(r2.success).toBe(true);
    expect(spawnCalls[0].cmd).toEqual(["git", "stash", "pop"]);
  });

  // ---- gitTool: checkout (缺少参数) ----
  it("checkout 缺少 args 时返回错误", async () => {
    const result = await gitTool.execute({ operation: "checkout" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("checkout 需要分支名参数");
  });

  // ---- gitTool: checkout (正常) ----
  it("checkout 带参数时切换分支", async () => {
    const result = await gitTool.execute({ operation: "checkout", args: "feature/new" });

    expect(result.success).toBe(true);
    expect(spawnCalls[0].cmd).toEqual(["git", "checkout", "feature/new"]);
  });

  // ---- gitTool: pull / fetch ----
  it("pull 和 fetch 支持附加参数", async () => {
    // pull
    const r1 = await gitTool.execute({ operation: "pull", args: "origin main" });
    expect(r1.success).toBe(true);
    expect(spawnCalls[0].cmd).toEqual(["git", "pull", "origin", "main"]);

    spawnCalls.length = 0;

    // fetch
    const r2 = await gitTool.execute({ operation: "fetch", args: "--all --prune" });
    expect(r2.success).toBe(true);
    expect(spawnCalls[0].cmd).toEqual(["git", "fetch", "--all", "--prune"]);
  });

  // ---- path 参数传递 ----
  it("path 参数传递给 Bun.spawn 的 cwd 选项", async () => {
    await gitTool.execute({ operation: "status", path: "/custom/path" });

    expect(spawnCalls[0].opts.cwd).toBe("/custom/path");
  });

  // ---- gitExec 失败 (exitCode !== 0) 仍返回 success: true (execute 内部不因此失败) ----
  it("git 命令退出码非零时 execute 仍返回 success: true (结果由 message 体现)", async () => {
    Bun.spawn = mock((_cmd: string[], _opts?: Record<string, unknown>) =>
      fakeProc("", "error: not a git repo", 128),
    ) as typeof Bun.spawn;

    const result = await gitTool.execute({ operation: "status" });

    // execute 函数在 exitCode !== 0 时仍返回 success: true，message 中包含 stderr
    expect(result.success).toBe(true);
    expect(result.message).toContain("error: not a git repo");
  });

  // ---- gitMerge ----
  it("gitMerge 默认合并指定分支", async () => {
    const result = await gitMerge.execute({ branch: "feature/x" });

    expect(result.success).toBe(true);
    expect(spawnCalls[0].cmd).toEqual(["git", "merge", "feature/x"]);
  });

  it("gitMerge 支持 --no-ff 和 --squash", async () => {
    await gitMerge.execute({ branch: "feature/x", noFf: true, squash: true });

    expect(spawnCalls[0].cmd).toEqual(["git", "merge", "--no-ff", "--squash", "feature/x"]);
  });

  it("gitMerge 合并失败时返回 success: false", async () => {
    Bun.spawn = mock((_cmd: string[], _opts?: Record<string, unknown>) =>
      fakeProc("", "CONFLICT (content): Merge conflict in foo.ts", 1),
    ) as typeof Bun.spawn;

    const result = await gitMerge.execute({ branch: "feature/x" });

    expect(result.success).toBe(false);
    expect(result.message).toContain("CONFLICT");
  });

  // ---- gitRebase ----
  it("gitRebase 默认 rebase 到目标分支", async () => {
    const result = await gitRebase.execute({ branch: "main" });

    expect(result.success).toBe(true);
    expect(spawnCalls[0].cmd).toEqual(["git", "rebase", "main"]);
  });

  it("gitRebase 支持 --autosquash", async () => {
    await gitRebase.execute({ branch: "main", autosquash: true });

    expect(spawnCalls[0].cmd).toEqual(["git", "rebase", "--autosquash", "main"]);
  });

  // ---- gitPush ----
  it("gitPush 默认推送到 origin", async () => {
    const result = await gitPush.execute({});

    expect(result.success).toBe(true);
    expect(spawnCalls[0].cmd).toEqual(["git", "push", "origin"]);
  });

  it("gitPush 支持 remote、branch、setUpstream、tags 参数", async () => {
    await gitPush.execute({
      branch: "feature/x",
      remote: "upstream",
      setUpstream: true,
      tags: true,
    });

    expect(spawnCalls[0].cmd).toEqual(["git", "push", "--set-upstream", "upstream", "feature/x", "--tags"]);
  });

  // ---- gitTag: 列出标签 ----
  it("gitTag 不传 name 时列出标签 (tag -l -n)", async () => {
    const result = await gitTag.execute({});

    expect(result.success).toBe(true);
    expect(spawnCalls[0].cmd).toEqual(["git", "tag", "-l", "-n"]);
  });

  // ---- gitTag: 创建 lightweight tag ----
  it("gitTag 传 name 创建 lightweight tag", async () => {
    await gitTag.execute({ name: "v1.0.0" });

    expect(spawnCalls[0].cmd).toEqual(["git", "tag", "v1.0.0"]);
  });

  // ---- gitTag: 创建 annotated tag ----
  it("gitTag 传 name + message 创建 annotated tag", async () => {
    await gitTag.execute({ name: "v1.0.0", message: "Release v1.0.0" });

    expect(spawnCalls[0].cmd).toEqual(["git", "tag", "-a", "v1.0.0", "-m", "Release v1.0.0"]);
  });

  // ---- gitTag: 强制覆盖 ----
  it("gitTag 传 force 时使用 -f 参数", async () => {
    await gitTag.execute({ name: "v1.0.0", force: true });

    expect(spawnCalls[0].cmd).toEqual(["git", "tag", "-f", "v1.0.0"]);
  });

  // ---- formatGitResult 截断 (通过超过 10000 字符的 stdout 触发) ----
  it("输出超过 10000 字符时自动截断并追加提示", async () => {
    // 20000 字符远超 10000 截断阈值，截断后应明显变短
    const longOutput = "A".repeat(20_000);

    Bun.spawn = mock((_cmd: string[], _opts?: Record<string, unknown>) =>
      fakeProc(longOutput, "", 0),
    ) as typeof Bun.spawn;

    const result = await gitTool.execute({ operation: "status" });

    expect(result.success).toBe(true);
    expect(result.message).toContain("...(截断)");
    // 截断后: 前 10000 字符 + "\n...(截断)" ≈ 10008，远小于原始 20000
    expect(result.message!.length).toBeLessThan(longOutput.length);
  });
});
