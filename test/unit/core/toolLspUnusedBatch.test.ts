/**
 * 工具 LSP 未使用符号批次测试。
 *
 * 测试目标:
 *   - 验证 LSP 相关工具源中未使用符号被识别与清理
 *
 * 测试用例:
 *   - 多个 LSP 工具源中无明显未使用符号
 */
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

function readRelative(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dir, "../../../src", relativePath), "utf8");
}

describe("tool lsp unused batch sources", () => {
  test("remove remaining obvious unused symbols from ide diagnostics and lsp", () => {
    const ideDiagnostics = readRelative("tool/ideDiagnostics/index.ts");
    const lsp = readRelative("tool/lsp/index.ts");

    expect(ideDiagnostics).not.toContain("const args =");
    expect(lsp).not.toContain("import { detectLanguage }");
    expect(lsp).not.toContain("async function getDiagnostics(filePath: string, cwd?: string)");
    expect(lsp).not.toContain("async function getWorkspaceSymbols(query: string, cwd: string)");
    expect(lsp).not.toContain(
      "async function getCodeActions(filePath: string, line: number, column: number, cwd: string)",
    );
    expect(lsp).not.toContain("function parseTscForFile(");
  });
});
