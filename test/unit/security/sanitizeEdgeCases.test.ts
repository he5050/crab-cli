/**
 * sanitizeAuditData 边界情况测试 — 循环引用、深度限制、数组、非 string 值
 */
import { describe, it, expect } from "bun:test";
import { sanitizeAuditData } from "@/security/audit/sanitize";

describe("sanitizeAuditData 循环引用防护", () => {
  it("循环引用不会导致栈溢出", () => {
    const a: Record<string, unknown> = { name: "A" };
    const b: Record<string, unknown> = { name: "B" };
    a.ref = b;
    b.ref = a;

    // 不应抛错，应安全返回
    const result = sanitizeAuditData(a) as Record<string, unknown>;
    expect(result.name).toBe("A");
    expect(result.ref).toBeDefined();
  });

  it("自引用不会导致栈溢出", () => {
    const obj: Record<string, unknown> = { name: "self" };
    obj.self = obj;

    const result = sanitizeAuditData(obj) as Record<string, unknown>;
    expect(result.name).toBe("self");
  });

  it("三元循环引用安全处理", () => {
    const a: Record<string, unknown> = { id: "a" };
    const b: Record<string, unknown> = { id: "b" };
    const c: Record<string, unknown> = { id: "c" };
    a.next = b;
    b.next = c;
    c.next = a;

    const result = sanitizeAuditData(a) as Record<string, unknown>;
    expect(result.id).toBe("a");
  });
});

describe("sanitizeAuditData 深度限制", () => {
  it("超过 5 层深度的嵌套对象原样返回", () => {
    const deep: Record<string, unknown> = { level: 1 };
    let current = deep;
    for (let i = 2; i <= 7; i++) {
      current.child = { level: i };
      current = current.child as Record<string, unknown>;
    }
    // level 6 和 level 7 应超过深度限制，原样返回
    const result = sanitizeAuditData(deep) as Record<string, unknown>;
    expect((result as any).level).toBe(1);
  });
});

describe("sanitizeAuditData 数组处理", () => {
  it("数组中的对象内敏感字段被脱敏", () => {
    const data = {
      items: [
        { name: "ok", token: "secret123" },
        { name: "ok2", password: "pass456" },
      ],
    };
    const result = sanitizeAuditData(data) as { items: Array<{ name: string; token: string; password: string }> };
    expect(result.items[0]!.token).toContain("****");
    expect(result.items[1]!.password).toContain("****");
  });

  it("空数组原样返回", () => {
    const result = sanitizeAuditData({ items: [] });
    expect(result).toEqual({ items: [] });
  });
});

describe("sanitizeAuditData 非 string 敏感值", () => {
  it("number 类型的敏感字段值不脱敏", () => {
    const data = { token: 12345 };
    const result = sanitizeAuditData(data) as { token: number };
    expect(result.token).toBe(12345);
  });

  it("boolean 类型的敏感字段值不脱敏", () => {
    const data = { secret: true };
    const result = sanitizeAuditData(data) as { secret: boolean };
    expect(result.secret).toBe(true);
  });

  it("null 值原样返回", () => {
    const result = sanitizeAuditData(null);
    expect(result).toBeNull();
  });

  it("undefined 值原样返回", () => {
    const result = sanitizeAuditData(undefined);
    expect(result).toBeUndefined();
  });

  it("纯字符串输入原样返回（不脱敏顶层字符串）", () => {
    const result = sanitizeAuditData("hello");
    expect(result).toBe("hello");
  });

  it("number 输入原样返回", () => {
    const result = sanitizeAuditData(42);
    expect(result).toBe(42);
  });
});
