/**
 * normalizeApprovalAction — 审批动作归一化测试
 */
import { describe, expect, test } from "bun:test";
import { normalizeApprovalAction } from "@/permission/core/normalize";

describe("normalizeApprovalAction — 审批动作归一化", () => {
  test("true → once", () => {
    expect(normalizeApprovalAction(true)).toBe("once");
  });

  test("false → reject", () => {
    expect(normalizeApprovalAction(false)).toBe("reject");
  });

  test('"once" 原样返回', () => {
    expect(normalizeApprovalAction("once")).toBe("once");
  });

  test('"always" 原样返回', () => {
    expect(normalizeApprovalAction("always")).toBe("always");
  });

  test('"reject" 原样返回', () => {
    expect(normalizeApprovalAction("reject")).toBe("reject");
  });
});
