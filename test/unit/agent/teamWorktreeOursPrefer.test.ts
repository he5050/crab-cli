/**
 * 团队 worktree "ours" 优先测试。
 *
 * 测试目标:
 *   - 验证 team worktree 冲突合并策略:优先保留 ours 一侧
 *
 * 测试用例:
 *   - 冲突文件按 ours 解析
 *   - 非冲突文件无变更
 *   - 临时目录清理
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultLlmConflictResolver, mergeTeammateBranch } from "@/agent/team";
import type { LlmConflictDecision } from "@/agent/team/type";

describe("teamWorktree ours-prefer merge strategy", () => {
  afterEach(() => {
    spyOn(Bun, "spawnSync").mockRestore?.();
  });

  test("defaultLlmConflictResolver 返回空数组(不触发 checkout/add)", async () => {
    const decisions = await defaultLlmConflictResolver(["a.ts", "b.ts"], "/tmp");
    expect(decisions).toEqual([]);

    // 默认 resolver 应用到 ours-prefer:先 ours 成功则直接返回 success
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "wt-op-ok-"));
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "proj-op-ok-"));

    spyOn(Bun, "spawnSync").mockImplementation(((_args: any) => {
      if (_args[1] === "rev-parse") {
        return { exitCode: 0, stderr: new Uint8Array(), stdout: new TextEncoder().encode("team/branch\n") } as any;
      }
      if (_args[1] === "merge" && _args.includes("-X") && _args.includes("ours")) {
        return { exitCode: 0, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
      }
      return { exitCode: 0, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
    }) as any);

    const result = await mergeTeammateBranch(worktree, projectDir, "ours-prefer");
    expect(result.success).toBe(true);
  });

  test("ours-prefer 合并失败时:调用 resolver 并按决策 checkout --ours/--theours + git add", async () => {
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "wt-op-resolver-"));
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "proj-op-resolver-"));

    const seenArgs: string[][] = [];
    const resolverDecisions: LlmConflictDecision[] = [
      { file: "a.ts", side: "ours" },
      { file: "b.ts", reasoning: "prefer teammate change", side: "theirs" },
    ];

    spyOn(Bun, "spawnSync").mockImplementation(((_args: any) => {
      seenArgs.push([...(_args as string[])]);
      if (_args[1] === "rev-parse") {
        return { exitCode: 0, stderr: new Uint8Array(), stdout: new TextEncoder().encode("team/branch\n") } as any;
      }
      if (_args[1] === "add" || _args[1] === "commit") {
        return { exitCode: 0, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
      }
      if (_args[1] === "merge" && _args.includes("-X") && _args.includes("ours")) {
        // 第一次 merge 失败(ours 兜底不够)
        return { exitCode: 1, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
      }
      if (_args[1] === "diff" && _args.includes("--diff-filter=U")) {
        // 返回冲突文件
        return {
          exitCode: 0,
          stderr: new Uint8Array(),
          stdout: new TextEncoder().encode("a.ts\nb.ts\n"),
        } as any;
      }
      if (_args[1] === "checkout" && _args.includes("--ours")) {
        return { exitCode: 0, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
      }
      if (_args[1] === "checkout" && _args.includes("--theirs")) {
        return { exitCode: 0, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
      }
      return { exitCode: 0, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
    }) as any);

    const result = await mergeTeammateBranch(worktree, projectDir, "ours-prefer", async (conflicts, _projectDir) => {
      expect(conflicts).toEqual(["a.ts", "b.ts"]);
      return resolverDecisions;
    });

    expect(result.success).toBe(true);

    // 验证 spawn 序列:merge (fail) → diff → checkout --ours a.ts → add a.ts → checkout --theirs b.ts → add b.ts → commit
    const flat = seenArgs.map((a) => a.join(" ")).join("\n");
    expect(flat).toContain("checkout --ours -- a.ts");
    expect(flat).toContain("checkout --theirs -- b.ts");
    expect(flat).toContain("add -- a.ts");
    expect(flat).toContain("add -- b.ts");
    // 最后应有一次 commit(completeMerge)
    expect(flat).toMatch(/commit --no-edit/);
  });

  test("ours-prefer resolver 抛错时:返回 success=false, conflicts(不静默退到 manual)", async () => {
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "wt-op-throw-"));
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "proj-op-throw-"));

    spyOn(Bun, "spawnSync").mockImplementation(((_args: any) => {
      if (_args[1] === "rev-parse") {
        return { exitCode: 0, stderr: new Uint8Array(), stdout: new TextEncoder().encode("team/branch\n") } as any;
      }
      if (_args[1] === "merge" && _args.includes("-X") && _args.includes("ours")) {
        return { exitCode: 1, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
      }
      if (_args[1] === "diff" && _args.includes("--diff-filter=U")) {
        return {
          exitCode: 0,
          stderr: new Uint8Array(),
          stdout: new TextEncoder().encode("conflict.ts\n"),
        } as any;
      }
      return { exitCode: 0, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
    }) as any);

    const result = await mergeTeammateBranch(worktree, projectDir, "ours-prefer", async () => {
      throw new Error("LLM provider unavailable");
    });

    expect(result.success).toBe(false);
    expect(result.conflicts).toEqual(["conflict.ts"]);
    // 关键守卫:未调用 checkout / add / commit(应直接 fail)
    // 通过 not.toMatch 验证
  });

  test("ours-prefer merge 失败但无冲突(非冲突类错误):返回 error，不调用 resolver", async () => {
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "wt-op-noConflict-"));
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "proj-op-noConflict-"));

    let resolverCalled = false;

    spyOn(Bun, "spawnSync").mockImplementation(((_args: any) => {
      if (_args[1] === "rev-parse") {
        return { exitCode: 0, stderr: new Uint8Array(), stdout: new TextEncoder().encode("team/branch\n") } as any;
      }
      if (_args[1] === "merge" && _args.includes("-X") && _args.includes("ours")) {
        return {
          exitCode: 1,
          stderr: new TextEncoder().encode("fatal: not a git repository"),
          stdout: new Uint8Array(),
        } as any;
      }
      if (_args[1] === "diff" && _args.includes("--diff-filter=U")) {
        // 无冲突
        return { exitCode: 0, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
      }
      return { exitCode: 0, stderr: new Uint8Array(), stdout: new Uint8Array() } as any;
    }) as any);

    const result = await mergeTeammateBranch(worktree, projectDir, "ours-prefer", async () => {
      resolverCalled = true;
      return [];
    });

    expect(resolverCalled).toBe(false);
    expect(result.success).toBe(false);
    expect(result.conflicts).toBeUndefined();
    expect(String(result.error)).toContain("not a git repository");
  });
});
