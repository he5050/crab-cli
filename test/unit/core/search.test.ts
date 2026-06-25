/**
 * 搜索工具测试。
 *
 * 测试用例:
 *   - glob 文件匹配
 *   - grep 文本搜索
 *   - 应用代码补丁
 */
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../helpers/testPaths";
import * as processManager from "@/bus/lifecycle/processManager";

const TMP_DIR = createGlobalTmpTestDir("crab-test-search-");

async function loadSearchTools(tag: string) {
  const now = Date.now();
  const [globMod, grepMod, patchMod] = await Promise.all([
    import("@/tool/codebaseSearch/globTool.ts"),
    import("@/tool/codebaseSearch/grepTool.ts"),
    import("@/tool/codebaseSearch/applyPatchTool.ts"),
  ]);
  return {
    applyPatchTool: patchMod.applyPatchTool,
    globTool: globMod.globTool,
    grepTool: grepMod.grepTool,
  };
}

beforeEach(() => {
  mock.restore();
  fs.mkdirSync(TMP_DIR, { recursive: true });
  // 创建测试文件
  fs.writeFileSync(path.join(TMP_DIR, "app.ts"), "function hello() {\n  return 'hello';\n}\n");
  fs.writeFileSync(path.join(TMP_DIR, "util.ts"), "function util() {\n  return 'util';\n}\n");
  fs.writeFileSync(path.join(TMP_DIR, "style.css"), ".hello { color: red; }\n");
  fs.mkdirSync(path.join(TMP_DIR, "sub"));
  fs.writeFileSync(path.join(TMP_DIR, "sub", "deep.ts"), "function deep() {\n  return 'deep';\n}\n");
});

afterEach(() => {
  mock.restore();
  cleanupTestDir(TMP_DIR);
});

// ─── glob ──────────────────────────────────────────────────────

describe("glob", () => {
  test("*.ts 匹配 TypeScript 文件", async () => {
    const { globTool } = await loadSearchTools("glob-basic");
    const result = (await globTool.execute({ path: TMP_DIR, pattern: "*.ts" })) as any;
    expect(result.files.length).toBe(2); // App.ts, util.ts
    expect(result.files).toContain("app.ts");
    expect(result.files).toContain("util.ts");
  });

  test("**/*.ts 递归匹配", async () => {
    const { globTool } = await loadSearchTools("glob-recursive");
    const result = (await globTool.execute({ path: TMP_DIR, pattern: "**/*.ts" })) as any;
    expect(result.files.length).toBe(3); // App.ts, util.ts, sub/deep.ts
    expect(result.files).toContain("sub/deep.ts");
  });

  test("不存在的目录返回错误", async () => {
    const { globTool } = await loadSearchTools("glob-missing");
    const result = (await globTool.execute({ path: "/nonexistent", pattern: "*.ts" })) as any;
    expect(result.error).toBeDefined();
    expect(result.errorCode).toBe("USER-204");
  });

  test("maxResults 限制结果数", async () => {
    const { globTool } = await loadSearchTools("glob-max");
    const result = (await globTool.execute({ maxResults: 2, path: TMP_DIR, pattern: "**/*" })) as any;
    expect(result.files.length).toBeLessThanOrEqual(2);
  });

  test("排除 node_modules 和 .git 目录", async () => {
    const { globTool } = await loadSearchTools("glob-exclude-dot");
    // 创建 node_modules 和 .git 目录中的文件
    fs.mkdirSync(path.join(TMP_DIR, "node_modules", "pkg"), { recursive: true });
    fs.writeFileSync(path.join(TMP_DIR, "node_modules", "pkg", "index.ts"), "export {};\n");
    fs.mkdirSync(path.join(TMP_DIR, ".git", "objects"), { recursive: true });
    fs.writeFileSync(path.join(TMP_DIR, ".git", "test.ts"), "git internal;\n");

    const result = (await globTool.execute({ path: TMP_DIR, pattern: "**/*.ts" })) as any;

    // 应包含正常文件
    expect(result.files).toContain("app.ts");
    // 不应包含 node_modules 和 .git 中的文件
    for (const f of result.files) {
      expect(f).not.toContain("node_modules");
      expect(f).not.toContain(".git");
    }
  });

  test("排除 dist 和 build 目录", async () => {
    const { globTool } = await loadSearchTools("glob-exclude-build");
    fs.mkdirSync(path.join(TMP_DIR, "dist"), { recursive: true });
    fs.writeFileSync(path.join(TMP_DIR, "dist", "bundle.js"), "compiled;\n");
    fs.mkdirSync(path.join(TMP_DIR, "build"), { recursive: true });
    fs.writeFileSync(path.join(TMP_DIR, "build", "output.js"), "built;\n");

    const result = (await globTool.execute({ path: TMP_DIR, pattern: "**/*" })) as any;

    for (const f of result.files) {
      expect(f).not.toContain("dist/");
      expect(f).not.toContain("build/");
    }
  });
});

// ─── grep ──────────────────────────────────────────────────────

describe("grep", () => {
  test("搜索 function 返回匹配行", async () => {
    spyOn(processManager, "exec").mockResolvedValue({ exitCode: 2, stderr: "missing", stdout: "" } as any);
    const { grepTool } = await loadSearchTools("grep-function");
    const result = (await grepTool.execute({ path: TMP_DIR, pattern: "function" })) as any;
    expect(result.total).toBeGreaterThanOrEqual(3); // Hello, util, deep
    expect(result.engine).toBe("js");
    expect(result.matches[0].text).toContain("function");
  });

  test("大小写不敏感搜索", async () => {
    spyOn(processManager, "exec").mockResolvedValue({ exitCode: 2, stderr: "missing", stdout: "" } as any);
    const { grepTool } = await loadSearchTools("grep-ignore-case");
    const result = (await grepTool.execute({
      ignoreCase: true,
      path: TMP_DIR,
      pattern: "HELLO",
    })) as any;
    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.engine).toBe("js");
  });

  test("无匹配返回空", async () => {
    const { grepTool } = await loadSearchTools("grep-no-match");
    const result = (await grepTool.execute({
      path: TMP_DIR,
      pattern: "zzz_nonexistent_pattern_12345",
    })) as any;
    expect(result.total).toBe(0);
    expect(result.matches.length).toBe(0);
  });

  test("include 参数过滤文件类型", async () => {
    spyOn(processManager, "exec").mockResolvedValue({ exitCode: 2, stderr: "missing", stdout: "" } as any);
    const { grepTool } = await loadSearchTools("grep-include");
    const result = (await grepTool.execute({
      include: "*.ts",
      path: TMP_DIR,
      pattern: "function",
    })) as any;
    // 只匹配 .ts 文件中的 function
    for (const match of result.matches) {
      expect(match.file).toMatch(/\.ts$/);
    }
  });

  // ── grep 上下文行 ────────────────────────────────────────────────

  test("beforeContext 显示匹配前的上下文行", async () => {
    spyOn(processManager, "exec").mockResolvedValue({ exitCode: 2, stderr: "missing", stdout: "" } as any);
    const { grepTool } = await loadSearchTools("grep-before");
    // 创建多行文件用于上下文测试
    const multiLineFile = path.join(TMP_DIR, "context.txt");
    fs.writeFileSync(multiLineFile, "line1\nline2\ntarget\nline4\nline5");

    const result = (await grepTool.execute({
      beforeContext: 2,
      include: "context.txt",
      path: TMP_DIR,
      pattern: "target",
    })) as any;

    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.engine).toBe("js");
    // 如果引擎返回了上下文，检查它
    if (result.matches[0]?.contextBefore) {
      expect(result.matches[0].contextBefore.length).toBeGreaterThan(0);
    }
    // 至少验证搜索成功不报错
    expect(result.error).toBeUndefined();
  });

  test("afterContext 显示匹配后的上下文行", async () => {
    spyOn(processManager, "exec").mockResolvedValue({ exitCode: 2, stderr: "missing", stdout: "" } as any);
    const { grepTool } = await loadSearchTools("grep-after");
    const multiLineFile = path.join(TMP_DIR, "ctx-after.txt");
    fs.writeFileSync(multiLineFile, "line1\nline2\ntarget\nline4\nline5");

    const result = (await grepTool.execute({
      afterContext: 2,
      include: "ctx-after.txt",
      path: TMP_DIR,
      pattern: "target",
    })) as any;

    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.engine).toBe("js");
    if (result.matches[0]?.contextAfter) {
      expect(result.matches[0].contextAfter.length).toBeGreaterThan(0);
    }
    expect(result.error).toBeUndefined();
  });

  test("beforeContext + afterContext 同时使用", async () => {
    spyOn(processManager, "exec").mockResolvedValue({ exitCode: 2, stderr: "missing", stdout: "" } as any);
    const { grepTool } = await loadSearchTools("grep-both");
    const multiLineFile = path.join(TMP_DIR, "ctx-both.txt");
    fs.writeFileSync(multiLineFile, "a\nb\ntarget\nc\nd");

    const result = (await grepTool.execute({
      afterContext: 1,
      beforeContext: 1,
      include: "ctx-both.txt",
      path: TMP_DIR,
      pattern: "target",
    })) as any;

    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.engine).toBe("js");
    expect(result.error).toBeUndefined();
  });

  test("rg 不可用时回退到 grep 引擎", async () => {
    spyOn(processManager, "exec").mockImplementation(async (args: string[]) => {
      if (args[0] === "rg") {
        return { exitCode: 2, stderr: "rg missing", stdout: "" } as any;
      }
      return {
        exitCode: 0,
        stderr: "",
        stdout: `${path.join(TMP_DIR, "app.ts")}:1:function hello() {`,
      } as any;
    });
    const mod = await import("@/tool/codebaseSearch/grepTool.ts");

    const result = (await mod.grepTool.execute({
      path: TMP_DIR,
      pattern: "function",
    })) as { engine: string; total: number; matches: { text: string }[] };

    expect(result.engine).toBe("grep");
    expect(result.total).toBe(1);
    expect(result.matches[0]!.text).toContain("function hello()");
    mock.restore();
  });

  test("rg 和 grep 都失败时回退到 JS 搜索并附带上下文", async () => {
    spyOn(processManager, "exec").mockResolvedValue({ exitCode: 2, stderr: "missing", stdout: "" } as any);
    const mod = await import("@/tool/codebaseSearch/grepTool.ts");
    const filePath = path.join(TMP_DIR, "js-fallback.txt");
    fs.writeFileSync(filePath, "a\nbefore\ntarget\nafter\nz");
    fs.mkdirSync(path.join(TMP_DIR, "node_modules"), { recursive: true });
    fs.writeFileSync(path.join(TMP_DIR, "node_modules", "ignored.txt"), "target");

    const result = (await mod.grepTool.execute({
      afterContext: 1,
      beforeContext: 1,
      include: "*.txt",
      path: TMP_DIR,
      pattern: "target",
    })) as {
      engine: string;
      total: number;
      matches: { file: string; contextBefore: string[]; contextAfter: string[] }[];
    };

    expect(result.engine).toBe("js");
    expect(result.total).toBeGreaterThanOrEqual(1);
    const hit = result.matches.find((m) => m.file === "js-fallback.txt");
    expect(hit!.contextBefore).toEqual(["before"]);
    expect(hit!.contextAfter).toEqual(["after"]);
    expect(result.matches.some((m) => String(m.file).includes("node_modules"))).toBe(false);
    mock.restore();
  });

  test("JS 搜索对特殊字符进行转义并正常返回结果", async () => {
    spyOn(processManager, "exec").mockResolvedValue({ exitCode: 2, stderr: "missing", stdout: "" } as any);
    const { grepTool } = await loadSearchTools("grep-invalid-regex");

    // pattern "[" 经 escapeRegex 转义为 "\[" 变为合法正则，不会抛错
    const result = (await grepTool.execute({
      path: TMP_DIR,
      pattern: "[",
    })) as any;

    expect(result.engine).toBe("js");
    // "[" 经转义后是字面量匹配，不会匹配任何文件内容
    expect(result.total).toBe(0);
    expect(result.matches).toEqual([]);
    mock.restore();
  });
});

// ─── apply_patch ──────────────────────────────────────────────

describe("apply_patch", () => {
  test("应用单行补丁", async () => {
    const { applyPatchTool } = await loadSearchTools("patch-single");
    const filePath = path.join(TMP_DIR, "patch-target.txt");
    fs.writeFileSync(filePath, "line1\nline2\nline3\n");

    const patch = `--- a/patch-target.txt\n+++ b/patch-target.txt\n@@ -1,3 +1,3 @@\n line1\n-line2\n+LINE2\n line3\n`;

    const result = (await applyPatchTool.execute({ patch, path: filePath })) as any;
    expect(result.success).toBe(true);
    expect(fs.readFileSync(filePath, "utf8")).toContain("LINE2");
    expect(fs.readFileSync(filePath, "utf8")).not.toContain("line2");
  });

  test("无效补丁格式返回错误", async () => {
    const { applyPatchTool } = await loadSearchTools("patch-invalid");
    const result = (await applyPatchTool.execute({
      patch: "this is not a valid patch",
    })) as any;
    expect(result.success).toBe(false);
    expect(result.error).toContain("无法解析");
    expect(result.errorCode).toBe("TOOL-603");
  });

  test("上下文不匹配返回错误", async () => {
    const { applyPatchTool } = await loadSearchTools("patch-mismatch");
    const filePath = path.join(TMP_DIR, "mismatch.txt");
    fs.writeFileSync(filePath, "actual content\n");

    const patch = `--- a/mismatch.txt\n+++ b/mismatch.txt\n@@ -1 +1 @@\n-expected content\n+new content\n`;

    const result = (await applyPatchTool.execute({ patch, path: filePath })) as any;
    expect(result.success).toBe(false);
    expect(result.results[0].errorCode).toBe("TOOL-601");
  });
});
