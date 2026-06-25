/**
 * ID 生成器测试。
 *
 * 测试用例:
 *   - 品牌化 ID 前缀
 *   - ID 唯一性
 *   - 时间排序
 */
import { describe, expect, test } from "bun:test";
import { createId, extractPrefix, extractTimestamp, isIdPrefix } from "@/core/identity";

describe("品牌化 ID", () => {
  test("createId 生成正确前缀", () => {
    expect(createId("ses").startsWith("ses_")).toBe(true);
    expect(createId("msg").startsWith("msg_")).toBe(true);
    expect(createId("prt").startsWith("prt_")).toBe(true);
    expect(createId("evt").startsWith("evt_")).toBe(true);
    expect(createId("tool").startsWith("tool_")).toBe(true);
  });

  test("1000 个 ID 全部唯一", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(createId("ses"));
    }
    expect(ids.size).toBe(1000);
  });

  test("时间排序正确(升序)", () => {
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      ids.push(createId("ses"));
    }
    // ULID 基于时间，后面的 ID 应该更大
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]! > ids[i - 1]!).toBe(true);
    }
  });

  test("extractPrefix 正确提取前缀", () => {
    expect(extractPrefix("ses_01HZ3K5P0QXJM9EG8ABCD4FGHI")).toBe("ses");
    expect(extractPrefix("msg_01HZ3K5P0QXJM9EG8ABCD4FGHI")).toBe("msg");
    expect(extractPrefix("noprefix")).toBe("");
  });

  test("extractTimestamp 返回有效时间戳", () => {
    const id = createId("ses");
    const ts = extractTimestamp(id);
    expect(ts).toBeGreaterThan(0);
    expect(ts).toBeLessThanOrEqual(Date.now());
    expect(ts).toBeGreaterThan(Date.now() - 10_000); // 10秒内生成
  });

  test("isIdPrefix 验证前缀", () => {
    const id = createId("ses");
    expect(isIdPrefix(id, "ses")).toBe(true);
    expect(isIdPrefix(id, "msg")).toBe(false);
  });
});
