/**
 * Team-worktree 白盒测试 — 纯函数:enforceWorktreePath, rewriteToolArgsForWorktree。
 *
 * 这些函数不依赖 git 或文件系统，可直接测试。
 */
import { describe, expect, test } from "bun:test";
import { enforceWorktreePath, rewriteToolArgsForWorktree } from "@/agent/team";

const WORKTREE = "/project/.crab/worktrees/mate-abc12345";

describe("enforceWorktreePath", () => {
  test("空字符串 → null", () => {
    expect(enforceWorktreePath("", WORKTREE)).toBeNull();
  });

  test("空白字符串 → null", () => {
    expect(enforceWorktreePath("   ", WORKTREE)).toBeNull();
  });

  test("SSH URL 直接通过", () => {
    expect(enforceWorktreePath("ssh://git@github.com/repo.git", WORKTREE)).toBe("ssh://git@github.com/repo.git");
  });

  test("worktree 内绝对路径直接通过", () => {
    const path = `${WORKTREE}/src/foo.ts`;
    expect(enforceWorktreePath(path, WORKTREE)).toBe(path);
  });

  test("worktree 根路径直接通过", () => {
    expect(enforceWorktreePath(WORKTREE, WORKTREE)).toBe(WORKTREE);
  });

  test("相对路径解析到 worktree 内", () => {
    const result = enforceWorktreePath("src/foo.ts", WORKTREE);
    expect(result).toBe(`${WORKTREE}/src/foo.ts`);
  });

  test("深层相对路径", () => {
    const result = enforceWorktreePath("a/b/c/d.ts", WORKTREE);
    expect(result).toBe(`${WORKTREE}/a/b/c/d.ts`);
  });
});

describe("rewriteToolArgsForWorktree", () => {
  describe("filesystem-* 工具", () => {
    test("filesystem-read 字符串 filePath 重写", () => {
      const result = rewriteToolArgsForWorktree("filesystem-read", { filePath: "src/foo.ts" }, WORKTREE);
      expect(result.args.filePath).toBe(`${WORKTREE}/src/foo.ts`);
      expect(result.error).toBeUndefined();
    });

    test("filesystem-read path 字段重写", () => {
      const result = rewriteToolArgsForWorktree("filesystem-read", { path: "src/foo.ts" }, WORKTREE);
      expect(result.args.path).toBe(`${WORKTREE}/src/foo.ts`);
    });

    test("filesystem-write 字符串 filePath 重写", () => {
      const result = rewriteToolArgsForWorktree("filesystem-write", { filePath: "src/bar.ts" }, WORKTREE);
      expect(result.args.filePath).toBe(`${WORKTREE}/src/bar.ts`);
    });

    test("filesystem-read 数组 filePath", () => {
      const result = rewriteToolArgsForWorktree("filesystem-read", { filePath: ["a.ts", "b.ts"] }, WORKTREE);
      const paths = result.args.filePath as string[];
      expect(paths[0]).toBe(`${WORKTREE}/a.ts`);
      expect(paths[1]).toBe(`${WORKTREE}/b.ts`);
    });

    test("filesystem-read 对象数组 filePath", () => {
      const result = rewriteToolArgsForWorktree(
        "filesystem-read",
        { filePath: [{ path: "a.ts" }, { path: "b.ts" }] },
        WORKTREE,
      );
      const arr = result.args.filePath as { path: string }[];
      expect(arr[0]!.path).toBe(`${WORKTREE}/a.ts`);
      expect(arr[1]!.path).toBe(`${WORKTREE}/b.ts`);
    });

    test("非 filesystem 工具不修改 filePath", () => {
      const result = rewriteToolArgsForWorktree("other-tool", { filePath: "src/foo.ts" }, WORKTREE);
      expect(result.args.filePath).toBe("src/foo.ts");
    });
  });

  describe("terminal 工具", () => {
    test("terminal-execute 无 cwd 时使用 worktree", () => {
      const result = rewriteToolArgsForWorktree("terminal-execute", { command: "ls" }, WORKTREE);
      expect(result.args.workingDirectory).toBe(WORKTREE);
    });

    test("terminal-execute 有 cwd 时重写", () => {
      const result = rewriteToolArgsForWorktree("terminal-execute", { command: "ls", cwd: "src" }, WORKTREE);
      expect(result.args.workingDirectory).toBe(`${WORKTREE}/src`);
      expect(result.args.cwd).toBe(`${WORKTREE}/src`);
    });

    test("terminal 阻止 git push", () => {
      const result = rewriteToolArgsForWorktree("terminal", { command: "git push origin main" }, WORKTREE);
      expect(result.error).toContain("git push");
    });

    test("terminal 允许 git commit", () => {
      const result = rewriteToolArgsForWorktree("terminal", { command: "git commit -m 'fix'" }, WORKTREE);
      expect(result.error).toBeUndefined();
    });

    test("terminal SSH URL cwd 不被重写", () => {
      const result = rewriteToolArgsForWorktree("terminal-execute", { command: "ls", cwd: "ssh://server" }, WORKTREE);
      expect(result.args.cwd).toBe("ssh://server");
    });
  });

  describe("搜索工具", () => {
    test("glob path 重写", () => {
      const result = rewriteToolArgsForWorktree("glob", { path: "src", pattern: "*.ts" }, WORKTREE);
      expect(result.args.path).toBe(`${WORKTREE}/src`);
    });

    test("grep path 重写", () => {
      const result = rewriteToolArgsForWorktree("grep", { path: "src", pattern: "TODO" }, WORKTREE);
      expect(result.args.path).toBe(`${WORKTREE}/src`);
    });

    test("codebase-search directory 重写", () => {
      const result = rewriteToolArgsForWorktree("codebase-search", { directory: "src", query: "test" }, WORKTREE);
      expect(result.args.directory).toBe(`${WORKTREE}/src`);
    });

    test("ace-search filePath 重写", () => {
      const result = rewriteToolArgsForWorktree("ace-search", { filePath: "src/index.ts" }, WORKTREE);
      expect(result.args.filePath).toBe(`${WORKTREE}/src/index.ts`);
    });

    test("ace-search directory 重写", () => {
      const result = rewriteToolArgsForWorktree("ace-search", { directory: "src" }, WORKTREE);
      expect(result.args.directory).toBe(`${WORKTREE}/src`);
    });
  });
});
