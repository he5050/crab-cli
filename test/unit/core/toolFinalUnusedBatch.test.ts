/**
 * 工具最终未使用符号批次测试。
 *
 * 测试目标:
 *   - 验证最后一批工具源中未使用符号的清理
 *
 * 测试用例:
 *   - 多个低风险工具源无明显未使用符号
 */
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

function readRelative(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dir, "../../../src", relativePath), "utf8");
}

describe("工具最终未使用批量源", () => {
  test("remove remaining low-risk obvious unused symbols from tool modules", () => {
    const fsDiagnostics = readRelative("tool/filesystem/utils/diagnostics.ts");
    const fsEditTools = readRelative("tool/filesystem/utils/editTools.ts");
    const fsEncoding = readRelative("tool/filesystem/utils/encoding.ts");
    const fsReadTools = readRelative("tool/filesystem/utils/readTools.ts");

    expect(fsDiagnostics).not.toContain("const log =");
    expect(fsEditTools).not.toContain("const log =");
    expect(fsEncoding).not.toContain("ENCODING_SAMPLE_BYTES");
    expect(fsReadTools).not.toContain('import path from "node:path"');
    expect(fsReadTools).not.toContain("const log =");
  });
});
