/**
 * 团队 worktree 直接测试。
 *
 * 测试目标:
 *   - 验证 team worktree 直接调用 API(不经由团队调度)的行为
 *
 * 测试用例:
 *   - worktree 创建/删除/列出
 *   - 临时目录清理
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  abortMerge,
  autoCommitWorktreeChanges,
  completeMerge,
  createWorktree,
  enforceWorktreePath,
  getConflictedFiles,
  getTeammateDiffSummary,
  isGitRepo,
  isInMergeState,
  mergeTeammateBranch,
  rewriteToolArgsForWorktree,
} from "@/agent/team";

describe("teamWorktree 直接覆盖率", () => {
  afterEach(() => {
    spyOn(Bun, "spawnSync").mockRestore?.();
  });

  test("createWorktree 首次成功、重试成功、失败时不降级为普通目录", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-create-"));
    const target = path.resolve(projectDir, ".crab/worktrees", "mate-mate_1234abcd");

    let call = 0;
    spyOn(Bun, "spawnSync").mockImplementation(() => {
      call++;
      if (call === 1) {
        return { exitCode: 0, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
      }
      if (call === 2) {
        return { exitCode: 1, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
      }
      return { exitCode: 0, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
    });

    expect(await createWorktree("mate_1234abcd", ".crab/worktrees", projectDir)).toBe(target);
    expect(fs.existsSync(path.dirname(target))).toBe(true);
    expect(await createWorktree("mate_1234abcd", ".crab/worktrees", projectDir)).toBe(target);

    spyOn(Bun, "spawnSync").mockImplementation(() => {
      throw new Error("spawn failed");
    });
    const failedTarget = path.resolve(projectDir, ".crab/worktrees", "mate-mate_deadbeef");
    await expect(createWorktree("mate_deadbeef", ".crab/worktrees", projectDir)).rejects.toThrow("未创建普通目录降级");
    expect(fs.existsSync(failedTarget)).toBe(false);
  });

  test("createWorktree uses enough teammate ID entropy to avoid mate_01K prefix collisions", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-entropy-"));
    const calls: string[][] = [];
    spyOn(Bun, "spawnSync").mockImplementation((args: any) => {
      calls.push(args);
      return { exitCode: 0, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
    });

    const first = await createWorktree("mate_01KAAAAAA11111111111111111", ".crab/worktrees", projectDir);
    const second = await createWorktree("mate_01KAAAAAA22222222222222222", ".crab/worktrees", projectDir);

    expect(first).not.toBe(second);
    expect(first).toContain("mate-mate_01KAAAAAA11111111111111111");
    expect(second).toContain("mate-mate_01KAAAAAA22222222222222222");
    expect(calls[0]).toContain("team/mate_01KAAAAAA11111111111111111");
    expect(calls[1]).toContain("team/mate_01KAAAAAA22222222222222222");
  });

  test("enforceWorktreePath 覆盖主工作区绝对路径映射与外部拒绝", () => {
    const worktree = "/repo/.crab/worktrees/mate-x";
    const insideMain = path.resolve(process.cwd(), "src/example.ts");
    expect(enforceWorktreePath(insideMain, worktree)).toBe(path.resolve(worktree, "src/example.ts"));
    expect(enforceWorktreePath("/tmp/outside.ts", worktree)).toBeNull();
  });

  test("rewriteToolArgsForWorktree 覆盖越界报错和 workingDirectory 重写", () => {
    const worktree = "/repo/.crab/worktrees/mate-x";

    const blocked = rewriteToolArgsForWorktree(
      "filesystem-write",
      { content: "x", filePath: "/tmp/outside.ts" },
      worktree,
    );
    expect(String(blocked.error)).toContain("worktree 之外");

    const terminal = rewriteToolArgsForWorktree(
      "terminal-execute",
      { command: "pwd", workingDirectory: "src/app" },
      worktree,
    );
    expect(terminal.args.workingDirectory).toBe(path.resolve(worktree, "src/app"));

    const blockedArray = rewriteToolArgsForWorktree(
      "filesystem-read",
      { filePath: ["ok.ts", "/tmp/outside.ts"] },
      worktree,
    );
    expect(String(blockedArray.error)).toContain("/tmp/outside.ts");

    const blockedObjectArray = rewriteToolArgsForWorktree(
      "filesystem-read",
      { filePath: [{ path: "ok.ts" }, { path: "/tmp/outside.ts" }, 7] as any },
      worktree,
    );
    expect(String(blockedObjectArray.error)).toContain("/tmp/outside.ts");

    const terminalPush = rewriteToolArgsForWorktree(
      "terminal",
      { command: "git push origin main", cwd: "SSH://server/path" },
      worktree,
    );
    expect(String(terminalPush.error)).toContain("git push");
  });

  test("mergeTeammateBranch 覆盖不存在、branch 获取失败、无冲突失败、异常", async () => {
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "wt-merge2-"));
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "proj-merge2-"));

    expect(await mergeTeammateBranch(path.join(projectDir, "missing"), projectDir, "manual")).toEqual({
      error: "Worktree 不存在",
      success: false,
    });

    spyOn(Bun, "spawnSync").mockImplementation((args: any) => {
      if (args[1] === "rev-parse") {
        return { exitCode: 1, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
      }
      return { exitCode: 0, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
    });
    expect(await mergeTeammateBranch(worktree, projectDir, "manual")).toEqual({
      error: "无法获取分支名",
      success: false,
    });

    spyOn(Bun, "spawnSync").mockImplementation((args: any) => {
      if (args[1] === "rev-parse") {
        return { exitCode: 0, stderr: new Uint8Array(), stdout: new TextEncoder().encode("team/branch\n") } as any;
      }
      if (args[1] === "add" || args[1] === "commit") {
        return { exitCode: 0, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
      }
      if (args[1] === "merge") {
        return {
          exitCode: 1,
          stderr: new TextEncoder().encode("plain merge failure"),
          stdout: new Uint8Array(),
        } as any;
      }
      if (args[1] === "diff") {
        return { exitCode: 1, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
      }
      return { exitCode: 0, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
    });
    expect(await mergeTeammateBranch(worktree, projectDir, "manual")).toEqual({
      error: "plain merge failure",
      success: false,
    });

    spyOn(Bun, "spawnSync").mockImplementation(() => {
      throw new Error("merge exploded");
    });
    const exploded = await mergeTeammateBranch(worktree, projectDir, "manual");
    expect(exploded.success).toBe(false);
    expect(String(exploded.error)).toContain("merge exploded");
  });

  test("mergeTeammateBranch 覆盖 theirs/ours 失败与 manual 成功", async () => {
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "wt-merge3-"));
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "proj-merge3-"));
    let mode: "theirs-fail" | "ours-fail" | "manual-ok" = "theirs-fail";

    spyOn(Bun, "spawnSync").mockImplementation((args: any) => {
      if (args[1] === "rev-parse") {
        return { exitCode: 0, stderr: new Uint8Array(), stdout: new TextEncoder().encode("team/branch\n") } as any;
      }
      if (args[1] === "add" || args[1] === "commit") {
        return { exitCode: 0, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
      }
      if (args[1] === "merge" && args.includes("-X") && args.includes("theirs")) {
        return { exitCode: mode === "theirs-fail" ? 1 : 0, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
      }
      if (args[1] === "merge" && args.includes("-X") && args.includes("ours")) {
        return { exitCode: mode === "ours-fail" ? 1 : 0, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
      }
      if (args[1] === "merge" && !args.includes("-X")) {
        return { exitCode: mode === "manual-ok" ? 0 : 1, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
      }
      return { exitCode: 0, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
    });

    expect(await mergeTeammateBranch(worktree, projectDir, "theirs")).toEqual({
      error: "合并失败(theirs 策略)",
      success: false,
    });

    mode = "ours-fail";
    expect(await mergeTeammateBranch(worktree, projectDir, "ours")).toEqual({
      error: "合并失败(ours 策略)",
      success: false,
    });

    mode = "manual-ok";
    expect(await mergeTeammateBranch(worktree, projectDir, "manual")).toEqual({ success: true });
  });

  test("getConflictedFiles / isInMergeState / completeMerge / abortMerge / diff / git repo 覆盖边界", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-boundary-"));
    let mode = 0;
    spyOn(Bun, "spawnSync").mockImplementation((args: any) => {
      if (args[1] === "diff" && args.includes("--diff-filter=U")) {
        if (mode === 0) {
          return { exitCode: 0, stderr: new Uint8Array(), stdout: new TextEncoder().encode("a.ts\nb.ts\n") } as any;
        }
        return { exitCode: 1, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
      }
      if (args[1] === "rev-parse" && args.includes("MERGE_HEAD")) {
        return { exitCode: mode === 0 ? 0 : 1, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
      }
      if (args[1] === "commit") {
        return { exitCode: mode === 0 ? 0 : 1, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
      }
      if (args[1] === "merge" && args[2] === "--abort") {
        return { exitCode: mode === 0 ? 0 : 1, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
      }
      if (args[1] === "diff" && args.includes("--stat")) {
        return {
          exitCode: mode === 0 ? 0 : 1,
          stderr: new Uint8Array(),
          stdout: new TextEncoder().encode(" 2 files changed"),
        } as any;
      }
      if (args[1] === "rev-parse" && args.includes("--is-inside-work-tree")) {
        return { exitCode: mode === 0 ? 0 : 1, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
      }
      return { exitCode: 1, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
    });

    expect(getConflictedFiles(dir)).toEqual(["a.ts", "b.ts"]);
    expect(isInMergeState(dir)).toBe(true);
    expect(await completeMerge(dir)).toBe(true);
    expect(await abortMerge(dir)).toBe(true);
    expect(getTeammateDiffSummary(dir, dir)).toContain("2 files changed");
    expect(isGitRepo(dir)).toBe(true);

    mode = 1;
    expect(getConflictedFiles(dir)).toEqual([]);
    expect(isInMergeState(dir)).toBe(false);
    expect(await completeMerge(dir)).toBe(false);
    expect(await abortMerge(dir)).toBe(false);
    expect(getTeammateDiffSummary(dir, dir)).toBe("无变更");
    expect(isGitRepo(dir)).toBe(false);
  });

  test("getConflictedFiles / isInMergeState / completeMerge / abortMerge / diff / git repo 覆盖异常分支", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-throw-"));
    spyOn(Bun, "spawnSync").mockImplementation(() => {
      throw new Error("spawn throw");
    });

    expect(getConflictedFiles(dir)).toEqual([]);
    expect(isInMergeState(dir)).toBe(false);
    expect(await completeMerge(dir)).toBe(false);
    expect(await abortMerge(dir)).toBe(false);
    expect(getTeammateDiffSummary(dir, dir)).toBe("无法获取 diff");
    expect(isGitRepo(dir)).toBe(false);
  });
});
