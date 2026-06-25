/**
 * Specialized Agent 基类单元测试
 *
 * 测试覆盖:
 *   - SpecializedAgent.execute 正常流程
 *   - SpecializedAgent.execute 超时控制
 *   - SpecializedAgent.execute 错误处理
 *   - createSpecializedAgent 工厂函数
 *   - AgentTimeoutError
 */
import { afterEach, describe, expect, mock, test } from "bun:test";
import { AgentTimeoutError, SpecializedAgent, createSpecializedAgent } from "@/agent/specialized/base";
import type { ModelMessage } from "ai";

class TestAgent extends SpecializedAgent<
  { maxTokens?: number; temperature?: number; timeoutMs?: number; input: string },
  { success: boolean; data?: string; error?: string }
> {
  protected agentName = "test";

  protected getDefaultConfig() {
    return { input: "default", temperature: 0.5 };
  }

  protected buildMessages(config: { input: string }): ModelMessage[] {
    return [{ content: config.input, role: "user" }];
  }

  protected parseResult(response: string) {
    return { data: response, success: true };
  }
}

describe("AgentTimeoutError", () => {
  test("应包含超时时间和名称", () => {
    const err = new AgentTimeoutError("超时", 5000);
    expect(err.name).toBe("AgentTimeoutError");
    expect(err.message).toBe("超时");
    expect(err.timeoutMs).toBe(5000);
  });
});

describe("SpecializedAgent", () => {
  afterEach(() => {
    mock.restore();
  });

  test("execute 正常执行", async () => {
    mock.module("@api", () => ({
      completeLlm: mock(() => Promise.resolve({ text: "结果" })),
    }));

    const agent = new TestAgent();
    const result = await agent.execute({ input: "测试" }, {
      defaultProvider: { model: "test", provider: "openai" },
    } as any);

    expect(result.success).toBe(true);
    expect(result.data).toBe("结果");
  });

  test("execute 合并配置", async () => {
    mock.module("@api", () => ({
      completeLlm: mock(() => Promise.resolve({ text: "结果" })),
    }));

    const agent = new TestAgent();
    const result = await agent.execute({ input: "自定义", temperature: 0.8 }, {
      defaultProvider: { model: "test", provider: "openai" },
    } as any);

    expect(result.success).toBe(true);
  });

  test("execute 缺少 appConfig 抛出错误", async () => {
    const agent = new TestAgent();
    const result = await agent.execute({ input: "测试" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("appConfig is required");
  });

  test("execute LLM 超时", async () => {
    mock.module("@api", () => ({
      completeLlm: mock(() => new Promise((resolve) => setTimeout(() => resolve({ text: "结果" }), 500))),
    }));

    const agent = new TestAgent();
    const result = await agent.execute({ input: "测试", timeoutMs: 50 }, {
      defaultProvider: { model: "test", provider: "openai" },
    } as any);

    expect(result.success).toBe(false);
    expect(result.error).toContain("超时");
  });

  test("execute 零或负超时不走超时逻辑", async () => {
    mock.module("@api", () => ({
      completeLlm: mock(() => Promise.resolve({ text: "结果" })),
    }));

    const agent = new TestAgent();
    const result = await agent.execute({ input: "测试", timeoutMs: 0 }, {
      defaultProvider: { model: "test", provider: "openai" },
    } as any);

    expect(result.success).toBe(true);
  });

  test("execute LLM 调用失败", async () => {
    mock.module("@api", () => ({
      completeLlm: mock(() => Promise.reject(new Error("API 错误"))),
    }));

    const agent = new TestAgent();
    const result = await agent.execute({ input: "测试" }, {
      defaultProvider: { model: "test", provider: "openai" },
    } as any);

    expect(result.success).toBe(false);
    expect(result.error).toContain("API 错误");
  });

  test("execute 子类可覆盖错误结果格式", async () => {
    class CustomErrorAgent extends TestAgent {
      protected override createErrorResult(error: string) {
        return { error: `CUSTOM:${error}`, success: false };
      }
    }

    mock.module("@api", () => ({
      completeLlm: mock(() => Promise.reject(new Error("fail"))),
    }));

    const agent = new CustomErrorAgent();
    const result = await agent.execute({ input: "测试" }, {
      defaultProvider: { model: "test", provider: "openai" },
    } as any);

    expect(result.error).toContain("CUSTOM:");
  });
});

describe("createSpecializedAgent", () => {
  afterEach(() => {
    mock.restore();
  });

  test("工厂函数创建可执行的 Agent", async () => {
    mock.module("@api", () => ({
      completeLlm: mock(() => Promise.resolve({ text: "工厂结果" })),
    }));

    const run = createSpecializedAgent(
      "factory-test",
      { input: "default", maxTokens: 100 },
      (config) => [{ content: config.input, role: "user" }],
      (response) => ({ data: response, success: true }),
    );

    const result = await run({ input: "测试" }, { defaultProvider: { model: "test", provider: "openai" } } as any);

    expect(result.success).toBe(true);
    expect(result.data).toBe("工厂结果");
  });

  test("工厂函数缺少 appConfig 抛出错误", async () => {
    const run = createSpecializedAgent(
      "factory-test",
      { input: "default" } as any,
      (config: { input: string }) => [{ content: config.input, role: "user" }],
      (response) => ({ data: response, success: true }),
    );

    const result = await run({ input: "测试" } as any);
    expect((result as any).success).toBe(false);
    expect((result as any).error).toContain("appConfig is required");
  });

  test("工厂函数错误处理", async () => {
    mock.module("@api", () => ({
      completeLlm: mock(() => Promise.reject(new Error("fail"))),
    }));

    const run = createSpecializedAgent(
      "factory-test",
      { input: "default" } as any,
      (config: { input: string }) => [{ content: config.input, role: "user" }],
      (response) => ({ data: response, success: true }),
    );

    const result = await run(
      { input: "测试" } as any,
      { defaultProvider: { model: "test", provider: "openai" } } as any,
    );

    expect((result as any).success).toBe(false);
    expect((result as any).error).toContain("fail");
  });
});
