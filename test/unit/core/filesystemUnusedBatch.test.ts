/**
 * 文件系统未使用符号批次测试。
 *
 * 测试目标:
 *   - 验证文件系统工具源中未使用符号的清理
 *
 * 测试用例:
 *   - 多个 filesystem 工具源中无明显未使用符号
 */
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

function readRelative(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dir, `../../../src/${relativePath}`), "utf8");
}

describe("文件系统未使用批量源", () => {
  test("remove low-risk obvious unused symbols from filesystem helpers", () => {
    const multiEdit = readRelative("tool/filesystem/multiEdit.ts");
    const readTool = readRelative("tool/filesystem/read.ts");

    expect(multiEdit).not.toContain("interface EditOperation");
    expect(multiEdit).not.toContain("const changedLines =");
    expect(readTool).not.toContain("function listDirectory(dirPath: string, stat:");
  });
});
