/**
 * AppConfig Schema 测试。
 *
 * 测试用例:
 *   - AppConfigSchema 默认值完整性
 *   - configVersion 迁移支持
 *   - strict 模式拒绝多余字段
 *   - 数值边界验证 + 中文错误消息
 *   - Codebase 嵌套默认值
 *   - Telemetry/Proxy/Provider/MCP/Thinking/Permission 验证
 *   - McpServerConfig.name/url 约束
 *   - ProxyConfig.url 约束
 *   - telemetry.endpoint z.url 约束
 */
import { describe, expect, test } from "bun:test";
import {
  AppConfigSchema,
  McpServerConfig,
  McpConfigFileSchema,
  ProxyConfig,
  RequestMethod,
  SingleProviderConfig,
  McpOAuthConfig,
  ThinkingConfig,
  PromptCachingConfig,
} from "@/schema/config";

/**
 * 辅助：验证失败并可选检查错误消息
 */
function expectReject(
  result: { success: boolean; error?: { issues?: Array<{ message?: string }> } },
  errorSubstring?: string,
): void {
  expect(result.success).toBe(false);
  if (errorSubstring && !result.success) {
    const msg = result.error?.issues?.[0]?.message ?? "";
    expect(msg).toContain(errorSubstring);
  }
}

describe("AppConfig Schema", () => {
  test("空对象解析产生完整默认值", () => {
    const config = AppConfigSchema.parse({});
    expect(config.profile).toBe("default");
    expect(config.theme).toBe("dark");
    expect(config.devMode).toBe(false);
    expect(config.autoformat).toBe(true);
    expect(config.permissions).toEqual([]);
    expect(config.agents).toEqual([]);
    expect(config.providerConfig).toEqual({});
    expect(config.maxSpawnDepth).toBe(3);
    expect(config.maxContextTokens).toBe(200_000);
    expect(config.maxToolRounds).toBe(50);
    expect(config.doomLoopThreshold).toBe(5);
    expect(config.toolResultTokenLimitPercent).toBe(30);
    expect(config.defaultAgent).toBe("general");
    expect(config.configVersion).toBe(1);
  });

  test("defaultProvider 默认值", () => {
    const config = AppConfigSchema.parse({});
    expect(config.defaultProvider).toEqual({ model: "", provider: "openai" });
  });

  test("customSystemPrompt 默认空字符串", () => {
    const config = AppConfigSchema.parse({});
    expect(config.customSystemPrompt).toBe("");
  });

  test("customHeaders 默认空对象", () => {
    const config = AppConfigSchema.parse({});
    expect(config.customHeaders).toEqual({});
  });

  test("strict 模式拒绝未知字段", () => {
    expectReject(AppConfigSchema.safeParse({ unknownField: "value" }));
  });

  // ─── configVersion ───────────────────────────────────

  test("configVersion 默认值为 1", () => {
    expect(AppConfigSchema.parse({}).configVersion).toBe(1);
  });

  test("configVersion 接受正整数", () => {
    expect(AppConfigSchema.parse({ configVersion: 2 }).configVersion).toBe(2);
  });

  test("configVersion 拒绝负数和非整数", () => {
    expectReject(AppConfigSchema.safeParse({ configVersion: -1 }));
    expectReject(AppConfigSchema.safeParse({ configVersion: 1.5 }));
  });

  // ─── 数值边界（含中文错误消息验证）────────────────

  test("maxSpawnDepth 边界约束 + 中文错误", () => {
    expectReject(AppConfigSchema.safeParse({ maxSpawnDepth: 0 }), "最小值为 1");
    expectReject(AppConfigSchema.safeParse({ maxSpawnDepth: 11 }), "最大值为 10");
    expect(AppConfigSchema.safeParse({ maxSpawnDepth: 5 }).success).toBe(true);
  });

  test("doomLoopThreshold 最小值 + 中文错误", () => {
    expectReject(AppConfigSchema.safeParse({ doomLoopThreshold: 0 }), "最小值为 1");
  });

  test("toolResultTokenLimitPercent 范围约束 + 中文错误", () => {
    expectReject(AppConfigSchema.safeParse({ toolResultTokenLimitPercent: 19 }), "最小值为 20");
    expectReject(AppConfigSchema.safeParse({ toolResultTokenLimitPercent: 81 }), "最大值为 80");
  });

  test("maxContextTokens 最小值 + 中文错误", () => {
    expectReject(AppConfigSchema.safeParse({ maxContextTokens: 999 }), "最小值为 1000");
  });

  test("defaultAgent 拒绝空字符串 + 中文错误", () => {
    expectReject(AppConfigSchema.safeParse({ defaultAgent: "" }), "不能为空");
  });

  test("loops.maxActive 边界约束", () => {
    expectReject(AppConfigSchema.safeParse({ loops: { maxActive: 0 } }));
    expectReject(AppConfigSchema.safeParse({ loops: { maxActive: 51 } }));
    expect(AppConfigSchema.safeParse({ loops: { maxActive: 25 } }).success).toBe(true);
  });

  // ─── Codebase 嵌套默认值 ──────────────────────────────

  test("codebase 嵌套对象完整默认值", () => {
    const config = AppConfigSchema.parse({});
    expect(config.codebase.indexingEnabled).toBe(true);
    expect(config.codebase.watchMode).toBe(true);
    expect(config.codebase.maxFileSize).toBe(1_048_576);
    expect(config.codebase.includeDocuments).toBe(false);
    expect(config.codebase.ignorePatterns).toEqual([]);
    expect(config.codebase.documentTypes).toEqual(["pdf", "docx", "xlsx", "pptx"]);
    expect(config.codebase.embedding.type).toBe("openai");
    expect(config.codebase.embedding.model).toBe("text-embedding-3-small");
    expect(config.codebase.embedding.dimensions).toBe(1536);
  });

  test("codebase 部分覆盖保留未覆盖默认值", () => {
    const config = AppConfigSchema.parse({ codebase: { indexingEnabled: false } });
    expect(config.codebase.indexingEnabled).toBe(false);
    expect(config.codebase.watchMode).toBe(true); // 保留默认
  });

  // ─── Telemetry 默认值 ──────────────────────────────────

  test("telemetry 默认值", () => {
    const config = AppConfigSchema.parse({});
    expect(config.telemetry.enabled).toBe(false);
    expect(config.telemetry.exporterType).toBe("none");
    expect(config.telemetry.sampleRate).toBe(1);
    expect(config.telemetry.serviceName).toBe("crab-cli");
  });

  test("telemetry.endpoint 拒绝非法 URL", () => {
    expectReject(AppConfigSchema.safeParse({ telemetry: { endpoint: "not-a-url" } }));
    expect(AppConfigSchema.safeParse({ telemetry: { endpoint: "http://localhost:4318/v1/traces" } }).success).toBe(
      true,
    );
  });

  // ─── Thinking 默认值 ───────────────────────────────

  test("thinking 默认值", () => {
    const config = AppConfigSchema.parse({});
    expect(config.thinking.enabled).toBe(false);
  });

  // ─── Loops 默认值 ──────────────────────────────────

  test("loops 默认值", () => {
    const config = AppConfigSchema.parse({});
    expect(config.loops.maxActive).toBe(10);
  });

  // ─── SensitiveCommands 默认值 ──────────────────────────

  test("sensitiveCommands 默认值", () => {
    const config = AppConfigSchema.parse({});
    expect(config.sensitiveCommands.enabled).toBe(true);
    expect(config.sensitiveCommands.commands).toEqual([]);
  });

  test("sensitiveCommands.action 默认值", () => {
    const config = AppConfigSchema.parse({
      sensitiveCommands: { commands: [{ pattern: "rm -rf" }] },
    });
    expect(config.sensitiveCommands.commands[0]!.action).toBe("confirm");
  });

  // ─── Proxy 默认值 ──────────────────────────────────

  test("proxy 完整默认值", () => {
    const config = AppConfigSchema.parse({});
    expect(config.proxy.enabled).toBe(false);
    expect(config.proxy.port).toBe(7890);
    expect(config.proxy.browserDebugPort).toBe(9222);
    expect(config.proxy.searchEngine).toBe("duckduckgo");
  });

  // ─── Permissions 复用 PermissionRule ──────────────────

  test("permissions 字段接受 PermissionRule 格式", () => {
    const config = AppConfigSchema.parse({
      permissions: [
        { action: "allow", pattern: "git *", permission: "bash" },
        { action: "deny", pattern: "/etc/*", permission: "fs.write" },
      ],
    });
    expect(config.permissions).toHaveLength(2);
  });

  test("permissions 字段接受含 description 的 PermissionRule", () => {
    const config = AppConfigSchema.parse({
      permissions: [{ action: "allow", description: "允许 git 操作", pattern: "git *", permission: "bash" }],
    });
    expect(config.permissions[0]!.description).toBe("允许 git 操作");
  });

  test("permissions 字段拒绝非法 action", () => {
    expectReject(
      AppConfigSchema.safeParse({
        permissions: [{ action: "invalid", pattern: "*", permission: "bash" }],
      }),
    );
  });

  // ─── Agent 条目 ──────────────────────────────────────

  test("agents 默认空数组", () => {
    const config = AppConfigSchema.parse({});
    expect(config.agents).toEqual([]);
  });

  test("agents 接受合法 agent 条目", () => {
    const config = AppConfigSchema.parse({
      agents: [{ mode: "primary", name: "custom-agent", permission: [] }],
    });
    expect(config.agents).toHaveLength(1);
    expect(config.agents[0]?.options).toEqual({});
  });

  // ─── ProviderConfig ────────────────────────────────

  test("providerConfig 默认空对象", () => {
    const config = AppConfigSchema.parse({});
    expect(config.providerConfig).toEqual({});
  });

  test("providerConfig 接受多 provider", () => {
    const config = AppConfigSchema.parse({
      providerConfig: {
        openai: { defaultModel: "gpt-4o", apiKey: "sk-test" },
        anthropic: { defaultModel: "claude-3", requestMethod: "claude" },
      },
    });
    expect(Object.keys(config.providerConfig)).toEqual(["openai", "anthropic"]);
  });

  // ─── FallbackChain ───────────────────────────────

  test("fallbackChain 接受合法请求方法序列", () => {
    const config = AppConfigSchema.parse({
      fallbackChain: ["chat", "claude", "responses", "gemini"],
    });
    expect(config.fallbackChain).toHaveLength(4);
  });

  test("fallbackChain 拒绝非法方法", () => {
    expectReject(AppConfigSchema.safeParse({ fallbackChain: ["invalid"] }));
  });
});

describe("McpServerConfig", () => {
  test("最小定义仅 name", () => {
    const result = McpServerConfig.safeParse({ name: "test-server" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.args).toEqual([]);
    }
  });

  test("stdio 模式完整配置", () => {
    const result = McpServerConfig.safeParse({
      args: ["--port", "3000"],
      command: "npx",
      enabled: true,
      env: { NODE_ENV: "production" },
      name: "my-server",
      timeout: 60000,
      type: "stdio",
    });
    expect(result.success).toBe(true);
  });

  test("sse 模式配置", () => {
    const result = McpServerConfig.safeParse({
      name: "remote-server",
      type: "sse",
      url: "https://example.com/mcp",
    });
    expect(result.success).toBe(true);
  });

  test("拒绝非法传输类型", () => {
    expectReject(McpServerConfig.safeParse({ name: "test", type: "websocket" }));
  });

  test("OAuth 配置", () => {
    const result = McpServerConfig.safeParse({
      name: "oauth-server",
      oauth: {
        authorizationUrl: "https://example.com/auth",
        clientId: "test-id",
        clientSecret: "test-secret",
        redirectUri: "http://localhost:3000/callback",
        scope: "read write",
      },
    });
    expect(result.success).toBe(true);
  });

  test("oauth: false 显式关闭", () => {
    expect(McpServerConfig.safeParse({ name: "test", oauth: false }).success).toBe(true);
  });

  test("disabledTools 过滤列表", () => {
    const result = McpServerConfig.safeParse({
      disabledTools: ["dangerous_tool"],
      name: "test",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.disabledTools).toEqual(["dangerous_tool"]);
    }
  });

  test("enabled 允许临时禁用 server", () => {
    expect(McpServerConfig.safeParse({ enabled: false, name: "test" }).success).toBe(true);
  });

  test("name 拒绝空字符串 + 中文错误", () => {
    expectReject(McpServerConfig.safeParse({ name: "" }), "不能为空");
  });

  test("url 拒绝非法 URL（z.url 约束）", () => {
    expectReject(McpServerConfig.safeParse({ name: "test", type: "sse", url: "not-a-url" }));
    expect(McpServerConfig.safeParse({ name: "test", type: "sse", url: "https://example.com/mcp" }).success).toBe(true);
  });
});

describe("McpConfigFileSchema", () => {
  test("空对象默认空 servers", () => {
    const result = McpConfigFileSchema.parse({});
    expect(result.mcpServers).toEqual({});
  });

  test("接受 server 条目（不含 name，name 来自 key）", () => {
    const result = McpConfigFileSchema.parse({
      mcpServers: {
        "my-server": { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"] },
      },
    });
    expect(Object.keys(result.mcpServers)).toEqual(["my-server"]);
  });
});

describe("ProxyConfig", () => {
  test("默认值完整", () => {
    const config = ProxyConfig.parse({});
    expect(config.enabled).toBe(false);
    expect(config.port).toBe(7890);
    expect(config.browserDebugPort).toBe(9222);
    expect(config.searchEngine).toBe("duckduckgo");
  });

  test("searchEngine 仅允许 duckduckgo 或 bing", () => {
    expect(ProxyConfig.safeParse({ searchEngine: "google" }).success).toBe(false);
    expect(ProxyConfig.safeParse({ searchEngine: "bing" }).success).toBe(true);
  });

  test("url 拒绝非法 URL（z.url 约束）", () => {
    expect(ProxyConfig.safeParse({ url: "not-a-url" }).success).toBe(false);
    expect(ProxyConfig.safeParse({ url: "https://proxy.example.com" }).success).toBe(true);
  });
});

describe("RequestMethod", () => {
  test("四种方法合法", () => {
    for (const method of ["chat", "responses", "claude", "gemini"]) {
      expect(RequestMethod.safeParse(method).success).toBe(true);
    }
  });

  test("非法方法拒绝", () => {
    expect(RequestMethod.safeParse("websocket").success).toBe(false);
  });
});

describe("SingleProviderConfig", () => {
  test("最小配置（有默认值的 requestMethod）", () => {
    const result = SingleProviderConfig.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requestMethod).toBe("chat");
    }
  });

  test("vision 专用配置", () => {
    const result = SingleProviderConfig.safeParse({
      visionApiKey: "sk-vision",
      visionBaseURL: "https://vision.example.com/v1",
      visionModel: "gpt-4-vision",
      visionProvider: "openai",
      visionRequestMethod: "chat",
    });
    expect(result.success).toBe(true);
  });

  test("modelRequestMethods 覆盖", () => {
    const result = SingleProviderConfig.safeParse({
      modelRequestMethods: { "claude-3": "claude", "gpt-4o": "chat" },
      requestMethod: "chat",
    });
    expect(result.success).toBe(true);
  });

  test("temperature 边界", () => {
    expect(SingleProviderConfig.safeParse({ temperature: -0.1 }).success).toBe(false);
    expect(SingleProviderConfig.safeParse({ temperature: 2.1 }).success).toBe(false);
    expect(SingleProviderConfig.safeParse({ temperature: 1.5 }).success).toBe(true);
  });

  test("ThinkingConfig provider 级默认", () => {
    const result = SingleProviderConfig.safeParse({
      thinking: { enabled: true, reasoningEffort: "high" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.thinking?.enabled).toBe(true);
      expect(result.data.thinking?.reasoningEffort).toBe("high");
    }
  });

  test("PromptCachingConfig", () => {
    const result = SingleProviderConfig.safeParse({ promptCaching: { enabled: false } });
    expect(result.success).toBe(true);
  });

  test("streamTimeout 正整数约束", () => {
    expect(SingleProviderConfig.safeParse({ streamTimeout: -1 }).success).toBe(false);
    expect(SingleProviderConfig.safeParse({ streamTimeout: 30000 }).success).toBe(true);
  });
});

describe("ThinkingConfig", () => {
  test("默认值", () => {
    const config = ThinkingConfig.parse({});
    expect(config.enabled).toBe(false);
  });

  test("所有字段组合", () => {
    const result = ThinkingConfig.safeParse({
      budgetTokens: 10000,
      enabled: true,
      includeThoughts: true,
      reasoningEffort: "high",
      thinkingLevel: "high",
    });
    expect(result.success).toBe(true);
  });

  test("budgetTokens 正整数约束", () => {
    expect(ThinkingConfig.safeParse({ budgetTokens: 0 }).success).toBe(false);
    expect(ThinkingConfig.safeParse({ budgetTokens: -1 }).success).toBe(false);
  });
});

describe("McpOAuthConfig", () => {
  test("全部字段可选", () => {
    expect(McpOAuthConfig.safeParse({}).success).toBe(true);
  });

  test("authorizationUrl 和 redirectUri 必须是合法 URL", () => {
    expect(McpOAuthConfig.safeParse({ authorizationUrl: "not-a-url" }).success).toBe(false);
    expect(McpOAuthConfig.safeParse({ authorizationUrl: "https://example.com/auth" }).success).toBe(true);
  });
});

describe("PromptCachingConfig", () => {
  test("默认启用", () => {
    const config = PromptCachingConfig.parse({});
    expect(config.enabled).toBe(true);
  });
});
