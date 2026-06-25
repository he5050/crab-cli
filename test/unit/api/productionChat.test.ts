/**
 * 生产环境对话测试。
 *
 * 测试用例:
 *   - 生产配置
 *   - 性能测试
 *   - 稳定性测试
 */
import { describe, expect, test } from "bun:test";
import { hasLiveProviderConfig, loadRealTestConfig } from "../../helpers/realConfig";
import { installDbIsolation } from "../../helpers/dbIsolation";

installDbIsolation("production-chat-db-");

/**
 * 生产级 AI 对话集成测试。
 * 需要 ~/.crab/config.json 中有真实 API 配置。
 * 在无配置环境下自动跳过。
 */
describe("生产级 AI 对话集成测试", () => {
  test("读取真实配置并验证结构", async () => {
    const config = await loadRealTestConfig();

    // 验证配置结构完整性
    expect(config.defaultProvider).toBeDefined();
    expect(config.defaultProvider.provider).toBeDefined();
    expect(config.defaultProvider.model).toBeDefined();
    expect(config.providerConfig).toBeDefined();

    // 验证配置结构合规(providerConfig 可能有也可能没有 defaultProvider 对应的条目)
    const providerId = config.defaultProvider.provider;
    const pConf = config.providerConfig[providerId];
    if (pConf) {
      expect(typeof pConf).toBe("object");
    }

    console.log(`当前 Provider: ${providerId}, 模型: ${config.defaultProvider.model}`);
    console.log(`配置的 Provider 数: ${Object.keys(config.providerConfig).length}`);
  });

  test("真实 AI 对话(需要 API 配置)", async () => {
    if (process.env.CRAB_RUN_LIVE_TESTS !== "1") {
      console.log("跳过:未开启实时 API 集成测试(设置 CRAB_RUN_LIVE_TESTS=1 启用)");
      return;
    }

    if (!(await hasLiveProviderConfig())) {
      console.log("跳过:无真实 API 配置");
      return;
    }

    const config = await loadRealTestConfig();
    const { ConversationHandler } = await import("@/conversation/core/conversationHandler");
    const { globalBus } = await import("@/bus/core/eventBus");
    const { AppEvent } = await import("@/bus/events");

    const handler = new ConversationHandler(config);

    let chunkCount = 0;
    const unsub = globalBus.subscribe(AppEvent.ChatChunk, () => {
      chunkCount++;
    });

    try {
      const result = await handler.sendMessage("Hi, just confirm you are alive.");
      expect(result.ok).toBe(true);
      expect(result.text.length).toBeGreaterThan(0);
      expect(chunkCount).toBeGreaterThan(0);
      console.log("对话成功，预览:", result.text.substring(0, 50));
    } finally {
      unsub();
    }
  });
});
