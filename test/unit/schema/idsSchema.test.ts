/**
 * ID Schema 测试。
 *
 * 测试用例:
 *   - SessionID 格式验证
 *   - MessageID 格式验证
 *   - PartID 格式验证
 *   - ToolCallID 格式验证
 *   - BrandedId 通用格式验证
 *   - 非法 ID 拒绝
 *   - 边界情况
 */
import { describe, expect, test } from "bun:test";
import { SessionID, MessageID, PartID, ToolCallID, BrandedId } from "@/schema/ids";

/** 生成合法的 26 位 ULID（仅用于测试） */
function makeUlid(): string {
  // 使用固定测试值，避免依赖 ULID 库
  return "01ARZ3NDEKTSV4RRFFQ69G5FAV";
}

describe("ID Schema", () => {
  const ulid = makeUlid();

  test("SessionID 合法格式 (ses_ 前缀 + 26 位 ULID)", () => {
    expect(SessionID.safeParse(`ses_${ulid}`).success).toBe(true);
  });

  test("SessionID 拒绝非 ses_ 前缀", () => {
    expect(SessionID.safeParse(`msg_${ulid}`).success).toBe(false);
    expect(SessionID.safeParse(`tool_${ulid}`).success).toBe(false);
    expect(SessionID.safeParse(`prt_${ulid}`).success).toBe(false);
  });

  test("SessionID 拒绝纯字符串", () => {
    expect(SessionID.safeParse("some-random-id").success).toBe(false);
    expect(SessionID.safeParse("ses_123").success).toBe(false);
  });

  test("MessageID 合法格式 (msg_ 前缀 + 26 位 ULID)", () => {
    expect(MessageID.safeParse(`msg_${ulid}`).success).toBe(true);
  });

  test("MessageID 拒绝非 msg_ 前缀", () => {
    expect(MessageID.safeParse(`ses_${ulid}`).success).toBe(false);
    expect(MessageID.safeParse("message-123").success).toBe(false);
  });

  test("PartID 合法格式 (prt_ 前缀 + 26 位 ULID)", () => {
    expect(PartID.safeParse(`prt_${ulid}`).success).toBe(true);
  });

  test("PartID 拒绝非 prt_ 前缀", () => {
    expect(PartID.safeParse(`msg_${ulid}`).success).toBe(false);
  });

  test("ToolCallID 合法格式 (tool_ 前缀 + 26 位 ULID)", () => {
    expect(ToolCallID.safeParse(`tool_${ulid}`).success).toBe(true);
  });

  test("ToolCallID 拒绝非 tool_ 前缀", () => {
    expect(ToolCallID.safeParse(`ses_${ulid}`).success).toBe(false);
  });

  test("BrandedId 接受任意小写前缀 + 26 位 ULID", () => {
    expect(BrandedId.safeParse(`ses_${ulid}`).success).toBe(true);
    expect(BrandedId.safeParse(`msg_${ulid}`).success).toBe(true);
    expect(BrandedId.safeParse(`custom_${ulid}`).success).toBe(true);
  });

  test("BrandedId 拒绝大写前缀", () => {
    expect(BrandedId.safeParse(`SES_${ulid}`).success).toBe(false);
  });

  test("BrandedId 拒绝无前缀", () => {
    expect(BrandedId.safeParse(ulid).success).toBe(false);
  });

  test("BrandedId 拒绝前缀中含数字", () => {
    expect(BrandedId.safeParse(`s1_${ulid}`).success).toBe(false);
  });

  test("所有 ID 类型拒绝空字符串", () => {
    expect(SessionID.safeParse("").success).toBe(false);
    expect(MessageID.safeParse("").success).toBe(false);
    expect(PartID.safeParse("").success).toBe(false);
    expect(ToolCallID.safeParse("").success).toBe(false);
    expect(BrandedId.safeParse("").success).toBe(false);
  });

  test("ULID 不含 I/L/O/U（Crockford Base32 排除字符）", () => {
    // 包含 I, L, O, U 的 ULID 应被拒绝
    const badUlid = "01ARZ3NDEKTSV4RRFFQ69G5FAI"; // 以 I 结尾
    expect(SessionID.safeParse(`ses_${badUlid}`).success).toBe(false);

    const badUlid2 = "01ARZ3NDEKTSV4RRFFQ69GFAL"; // 含 L
    expect(SessionID.safeParse(`ses_${badUlid2}`).success).toBe(false);

    const badUlid3 = "01ARZ3NDEKTSV4RRFFQ69GFAO"; // 含 O
    expect(SessionID.safeParse(`ses_${badUlid3}`).success).toBe(false);

    const badUlid4 = "01ARZ3NDEKTSV4RRFFQ69GFAU"; // 含 U
    expect(SessionID.safeParse(`ses_${badUlid4}`).success).toBe(false);
  });

  test("ULID 长度必须恰好 26 位", () => {
    expect(SessionID.safeParse("ses_01ARZ3NDEKTSV4RRFFQ69G5F").success).toBe(false); // 25 位
    expect(SessionID.safeParse("ses_01ARZ3NDEKTSV4RRFFQ69G5FAVX").success).toBe(false); // 27 位
  });
});
