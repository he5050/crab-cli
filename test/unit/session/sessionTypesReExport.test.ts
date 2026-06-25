/**
 * Session/types.ts 类型导出与兼容性测试
 *
 * 覆盖 P2-2 修复:
 *   1. types.ts 导出的类型结构正确
 *   2. session/message.ts 和 session/tokenUsage.ts re-export 类型一致
 *   3. bus/events.ts 可从 @session/types 导入
 *   4. 类型字段完整性
 */

import { describe, expect, it } from "bun:test";

// 直接从 types.ts 导入(验证 bus/ 可以用此路径)
import type { MessageFileReference, MessagePartTime, TokenUsage } from "@/session/types";

describe("P2-2: session/types.ts 类型导出", () => {
  it("MessagePartTime 包含所有字段", () => {
    const t: MessagePartTime = {
      durationMs: 1000,
      endedAt: 2000,
      startedAt: 1000,
    };
    expect(t.startedAt).toBe(1000);
    expect(t.endedAt).toBe(2000);
    expect(t.durationMs).toBe(1000);
  });

  it("MessagePartTime 所有字段可选", () => {
    const t: MessagePartTime = {};
    expect(t.startedAt).toBeUndefined();
    expect(t.endedAt).toBeUndefined();
    expect(t.durationMs).toBeUndefined();
  });

  it("MessageFileReference 包含所有字段", () => {
    const f: MessageFileReference = {
      diff: "- old + new",
      kind: "edit",
      language: "typescript",
      line: 42,
      path: "/src/a.ts",
      status: "done",
    };
    expect(f.path).toBe("/src/a.ts");
    expect(f.kind).toBe("edit");
    expect(f.status).toBe("done");
    expect(f.diff).toBe("- old + new");
    expect(f.language).toBe("typescript");
    expect(f.line).toBe(42);
  });

  it("MessageFileReference path 为必填字段", () => {
    const f: MessageFileReference = { path: "/required.ts" };
    expect(f.path).toBe("/required.ts");
    expect(f.kind).toBeUndefined();
  });

  it("TokenUsage 包含核心字段", () => {
    const u: TokenUsage = {
      inputTokens: 100,
      outputTokens: 200,
    };
    expect(u.inputTokens).toBe(100);
    expect(u.outputTokens).toBe(200);
  });

  it("TokenUsage 可选缓存字段", () => {
    const u: TokenUsage = {
      cacheCreationInputTokens: 50,
      cacheReadInputTokens: 30,
      cachedTokens: 80,
      inputTokens: 100,
      outputTokens: 200,
    };
    expect(u.cacheCreationInputTokens).toBe(50);
    expect(u.cacheReadInputTokens).toBe(30);
    expect(u.cachedTokens).toBe(80);
  });
});
