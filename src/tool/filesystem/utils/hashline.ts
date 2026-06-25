/**
 * 哈希行工具 — 基于内容哈希的精确行定位编辑。
 *
 * 职责:
 *   - 计算行内容哈希
 *   - 生成带哈希锚点的行格式
 *   - 解析锚点字符串
 *   - 验证锚点匹配
 *   - 构建文件哈希映射
 *
 * 模块功能:
 *   - lineHash: 计算行哈希(FNV-1a)
 *   - formatLineWithHash: 格式化带哈希的行
 *   - parseAnchor: 解析锚点
 *   - validateAnchor: 验证锚点
 *   - buildHashMap: 构建哈希映射
 *
 * 使用场景:
 *   - 精确行定位编辑
 *   - 避免行号偏移问题
 *   - 文件变更检测
 *   - 编辑锚定
 *
 * 边界:
 *   1. 使用 FNV-1a 32-bit 哈希
 *   2. 8-bit 截断(2 位十六进制)
 *   3. 格式:lineNum:hash→content
 *   4. 锚点格式:lineNum:hash
 *   5. 验证时比较预期和实际哈希
 *
 * 流程:
 *   1. 计算每行内容的哈希
 *   2. 生成带哈希的行格式
 *   3. 解析锚点字符串
 *   4. 验证锚点是否匹配当前内容
 *   5. 构建完整文件的哈希映射
 */

import { createHash } from "node:crypto";

/** 计算行内容的 MD5 短 hash(8 字符十六进制)，用于 read/edit 的 hash-anchored 编辑 */
export function computeLineHash(line: string): string {
  return createHash("md5").update(line).digest("hex").slice(0, 8);
}

/** 计算单行的 2 位十六进制内容哈希(FNV-1a 32-bit → 8-bit 截断) */
export function lineHash(content: string): string {
  let h = 0x81_1c_9d_c5; // FNV-1a 32-bit offset basis
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i);
    h = Math.imul(h, 0x01_00_01_93); // FNV-1a 32-bit prime
  }
  return ((h >>> 0) & 0xff).toString(16).padStart(2, "0");
}

/** 格式化带哈希锚点的行: `lineNum:hash→content` */
export function formatLineWithHash(lineNum: number, content: string): string {
  return `${lineNum}:${lineHash(content)}→${content}`;
}

/** 解析锚点字符串 `lineNum:hash` */
export interface ParsedAnchor {
  lineNum: number;
  hash: string;
}

/** 解析行锚点字符串（格式: "行号:hash"） */
export function parseAnchor(anchor: string): ParsedAnchor | null {
  const m = anchor.match(/^(\d+):([0-9a-f]{2})$/i);
  if (!m) {
    return null;
  }
  return { hash: m[2]!.toLowerCase(), lineNum: Number(m[1]) };
}

/** 验证锚点是否匹配当前文件内容 */
export function validateAnchor(
  anchor: string,
  lines: string[],
): { valid: boolean; lineNum: number; expected?: string; actual?: string } {
  const parsed = parseAnchor(anchor);
  if (!parsed) {
    return { lineNum: -1, valid: false };
  }

  const { lineNum, hash } = parsed;
  if (lineNum < 1 || lineNum > lines.length) {
    return { lineNum, valid: false };
  }

  const actual = lineHash(lines[lineNum - 1]!);
  return {
    actual,
    expected: hash,
    lineNum,
    valid: actual === hash,
  };
}

/** 构建完整文件的哈希映射 */
export function buildHashMap(lines: string[]): string[] {
  return lines.map((line) => lineHash(line));
}
