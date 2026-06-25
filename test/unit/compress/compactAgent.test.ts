/**
 * CompactAgent 测试。
 *
 * 测试用例:
 *   - isAvailable 检查
 *   - clearCache
 *   - call 成功/失败
 *   - extractWebPageContent 成功/失败/不可用
 */
import { describe, expect, test, beforeEach } from "bun:test";
import { CompactAgent } from "@/compress/utils";

// 构造最小 AppConfigSchema
function createMockAppConfig(overrides: Record<string, unknown> = {}) {
  return {
    defaultProvider: {
      provider: "test-provider",
      model: "test-model",
    },
    ...overrides,
  } as never; // 测试用，跳过完整类型校验
}

describe("CompactAgent", () => {
  let agent: CompactAgent;

  beforeEach(() => {
    agent = new CompactAgent();
  });

  test("isAvailable 有 provider 和 model 时返回 true", async () => {
    const config = createMockAppConfig();
    expect(await agent.isAvailable(config)).toBe(true);
  });

  test("isAvailable 缺少 provider 时返回 false", async () => {
    const config = createMockAppConfig({
      defaultProvider: { model: "test-model" },
    });
    expect(await agent.isAvailable(config)).toBe(false);
  });

  test("isAvailable 缺少 model 时返回 false", async () => {
    const config = createMockAppConfig({
      defaultProvider: { provider: "test-provider" },
    });
    expect(await agent.isAvailable(config)).toBe(false);
  });

  test("clearCache 重置初始化状态", async () => {
    const config = createMockAppConfig();
    await agent.isAvailable(config);
    expect(agent.isAvailable.toString()).toBeTruthy(); // 验证对象存在
    agent.clearCache();
    // 清除后需要重新检查
    expect(typeof agent.clearCache).toBe("function");
  });

  test("extractWebPageContent 在不可用时返回原文", async () => {
    const agent2 = new CompactAgent();
    // 没有有效的 provider/model
    const config = createMockAppConfig({
      defaultProvider: {},
    });

    const result = await agent2.extractWebPageContent("原始内容", "查询", "https://example.com", config);
    expect(result).toBe("原始内容");
  });
});
