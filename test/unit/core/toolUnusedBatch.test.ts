/**
 * 工具未使用符号批次测试。
 *
 * 测试目标:
 *   - 验证工具源中未使用符号的清理
 *
 * 测试用例:
 *   - 多个工具源中无明显未使用符号
 */
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

function readRelative(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dir, "../../../src", relativePath), "utf8");
}

describe("工具未使用批量源", () => {
  test("remove low-risk obvious unused symbols from tool helpers", () => {
    const sshExec = readRelative("tool/bash/sshExec.ts");
    const aceGrepEngine = readRelative("tool/codebaseSearch/aceRuntime/aceGrepEngine.ts");
    const aceService = readRelative("tool/codebaseSearch/aceRuntime/aceService.ts");
    const searchStrategies = readRelative("tool/codebaseSearch/searchStrategies.ts");
    const htmlToMarkdown = readRelative("tool/deepwiki/htmlToMarkdown.ts");

    expect(sshExec).not.toContain("const log =");
    expect(aceGrepEngine).not.toContain('import * as path from "node:path"');
    expect(aceService).not.toContain("const queryLower =");
    expect(aceService).not.toContain("type FileToSearch");
    expect(htmlToMarkdown).not.toContain("const { mode =");
    expect(htmlToMarkdown).toContain("_options: ConversionOptions");
  });
});
