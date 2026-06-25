/**
 * [测试目标] 团队 worktree 操作。
 *
 * 测试目标:
 *   - 验证 teamWorktree 模块在 git 命令失败与成功时的回退与清理行为
 *
 * 测试用例:
 *   - removeWorktree 在 git remove 失败时回退 rmSync:使用 spy 让 git 命令返回非 0 退出码，断言最终目录被删除
 *   - cleanupTeamWorktrees 只清理 mate-* 目录:在 worktrees 下创建 mate-a / mate-b / other 三类目录，断言只清理前缀匹配的目录
 *   - autoCommitWorktreeChanges 在 git add 失败时返回 false:构造 git rev-parse 成功但 add 失败的场景，断言结果为 false
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  abortMerge,
  autoCommitWorktreeChanges,
  cleanupTeamWorktrees,
  completeMerge,
  getTeammateDiffSummary,
  isGitRepo,
  isGitWorktreeRoot,
  mergeTeammateBranch,
  removeWorktree,
} from "@/agent/team";

describe("teamWorktree 操作", () => {
  afterEach(() => {
    spyOn(Bun, "spawnSync").mockRestore?.();
  });

  test("removeWorktree 在 git remove 失败时回退 rmSync", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-remove-"));
    spyOn(Bun, "spawnSync").mockImplementation(
      () => ({ exitCode: 1, stderr: new Uint8Array(), stdout: new Uint8Array() }) as any,
    );

    const ok = await removeWorktree(dir, process.cwd());

    expect(ok).toBe(true);
    expect(fs.existsSync(dir)).toBe(false);
  });

  test("cleanupTeamWorktrees 只清理 mate-* 目录", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-clean-"));
    const base = path.join(projectDir, ".crab", "worktrees");
    fs.mkdirSync(path.join(base, "mate-a"), { recursive: true });
    fs.mkdirSync(path.join(base, "mate-b"), { recursive: true });
    fs.mkdirSync(path.join(base, "other"), { recursive: true });

    spyOn(Bun, "spawnSync").mockImplementation(
      () => ({ exitCode: 1, stderr: new Uint8Array(), stdout: new Uint8Array() }) as any,
    );

    const count = await cleanupTeamWorktrees(projectDir, ".crab/worktrees");

    expect(count).toBe(2);
    expect(fs.existsSync(path.join(base, "other"))).toBe(true);
  });

  test("autoCommitWorktreeChanges 在 git add 失败时返回 false", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-commit-fail-"));
    spyOn(Bun, "spawnSync").mockImplementation((args: any) => {
      if (args[1] === "rev-parse") {
        return { exitCode: 0, stderr: new Uint8Array(), stdout: new TextEncoder().encode(`${dir}\n`) } as any;
      }
      if (args[1] === "add") {
        return { exitCode: 1, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
      }
      return { exitCode: 0, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
    });

    expect(autoCommitWorktreeChanges(dir, "mate")).toBe(false);
  });

  test("autoCommitWorktreeChanges 跳过普通降级目录，避免向上污染主仓库", () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-parent-"));
    const fallbackDir = path.join(projectDir, ".crab", "worktrees", "mate-fallback");
    fs.mkdirSync(fallbackDir, { recursive: true });

    const calls: string[][] = [];
    spyOn(Bun, "spawnSync").mockImplementation((args: any) => {
      calls.push(args);
      if (args[1] === "rev-parse") {
        return { exitCode: 0, stderr: new Uint8Array(), stdout: new TextEncoder().encode(`${projectDir}\n`) } as any;
      }
      return { exitCode: 0, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
    });

    expect(isGitWorktreeRoot(fallbackDir)).toBe(false);
    expect(autoCommitWorktreeChanges(fallbackDir, "mate")).toBe(false);
    expect(calls.some((args) => args[1] === "add" || args[1] === "commit")).toBe(false);
  });

  test("autoCommitWorktreeChanges 仅在目录自身是 worktree 根时提交", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-commit-ok-"));
    const calls: string[][] = [];
    spyOn(Bun, "spawnSync").mockImplementation((args: any) => {
      calls.push(args);
      if (args[1] === "rev-parse") {
        return { exitCode: 0, stderr: new Uint8Array(), stdout: new TextEncoder().encode(`${dir}\n`) } as any;
      }
      return { exitCode: 0, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
    });

    expect(isGitWorktreeRoot(dir)).toBe(true);
    expect(autoCommitWorktreeChanges(dir, "mate")).toBe(true);
    expect(calls.some((args) => args[1] === "add")).toBe(true);
    expect(calls.some((args) => args[1] === "commit")).toBe(true);
  });

  test("mergeTeammateBranch 覆盖 theirs / ours / manual-conflicts", async () => {
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "wt-merge-"));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "proj-merge-"));

    const branchCalls: string[][] = [];
    spyOn(Bun, "spawnSync").mockImplementation((args: any) => {
      branchCalls.push(args);
      if (args[1] === "rev-parse") {
        return { exitCode: 0, stderr: new Uint8Array(), stdout: new TextEncoder().encode("team/branch\n") } as any;
      }
      if (args[1] === "add" || args[1] === "commit") {
        return { exitCode: 0, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
      }
      if (args[1] === "merge" && args.includes("-X") && args.includes("theirs")) {
        return { exitCode: 0, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
      }
      if (args[1] === "merge" && args.includes("-X") && args.includes("ours")) {
        return { exitCode: 0, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
      }
      if (args[1] === "merge" && !args.includes("-X")) {
        return { exitCode: 1, stderr: new TextEncoder().encode("merge failed"), stdout: new Uint8Array() } as any;
      }
      if (args[1] === "diff") {
        return { exitCode: 0, stderr: new Uint8Array(), stdout: new TextEncoder().encode("src/conflict.ts\n") } as any;
      }
      return { exitCode: 0, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
    });

    expect(await mergeTeammateBranch(worktree, project, "theirs")).toEqual({ success: true });
    expect(await mergeTeammateBranch(worktree, project, "ours")).toEqual({ success: true });
    expect(await mergeTeammateBranch(worktree, project, "manual")).toEqual({
      conflicts: ["src/conflict.ts"],
      success: false,
    });
    expect(branchCalls.some((args) => args.includes("theirs"))).toBe(true);
    expect(branchCalls.some((args) => args.includes("ours"))).toBe(true);
  });

  test("completeMerge / abortMerge / getTeammateDiffSummary / isGitRepo 覆盖成功与失败路径", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-misc-"));

    let mode = "success";
    spyOn(Bun, "spawnSync").mockImplementation((args: any) => {
      if (args[1] === "commit") {
        return { exitCode: mode === "success" ? 0 : 1, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
      }
      if (args[1] === "merge" && args[2] === "--abort") {
        return { exitCode: mode === "success" ? 0 : 1, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
      }
      if (args[1] === "diff" && args.includes("--stat")) {
        return {
          exitCode: mode === "success" ? 0 : 1,
          stderr: new Uint8Array(),
          stdout: new TextEncoder().encode(" 1 file changed"),
        } as any;
      }
      if (args[1] === "rev-parse" && args.includes("--is-inside-work-tree")) {
        return { exitCode: mode === "success" ? 0 : 1, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
      }
      return { exitCode: 1, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
    });

    expect(await completeMerge(dir)).toBe(true);
    expect(await abortMerge(dir)).toBe(true);
    expect(getTeammateDiffSummary(dir, dir)).toContain("1 file changed");
    expect(isGitRepo(dir)).toBe(true);

    mode = "fail";
    expect(await completeMerge(dir)).toBe(false);
    expect(await abortMerge(dir)).toBe(false);
    expect(getTeammateDiffSummary(dir, dir)).toBe("无变更");
    expect(isGitRepo(dir)).toBe(false);
  });
});
