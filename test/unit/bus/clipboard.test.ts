/**
 * 剪贴板测试。
 *
 * 测试用例:
 *   - 复制到剪贴板
 *   - 剪贴板内容读取
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readClipboard, writeClipboard } from "@/core/io/clipboard";

describe("Clipboard — 剪贴板工具", () => {
  let originalClipboard: string | null = null;

  beforeEach(async () => {
    originalClipboard = await readClipboard();
  });

  afterEach(async () => {
    if (originalClipboard !== null) {
      await writeClipboard(originalClipboard);
    }
  });

  test("writeClipboard 写入后 readClipboard 能读取", async () => {
    const testText = `crab-test-${Date.now()}`;

    // 写入剪贴板
    const writeSuccess = await writeClipboard(testText);

    // 只在支持的平台上验证
    if (writeSuccess) {
      const readText = await readClipboard();
      expect(readText).toBe(testText);
    }
  });

  test("readClipboard 返回字符串或 null", async () => {
    const result = await readClipboard();
    expect(typeof result === "string" || result === null).toBe(true);
  });

  test("writeClipboard 返回布尔值表示成功/失败", async () => {
    const result = await writeClipboard("test");
    expect(typeof result).toBe("boolean");
  });
});
