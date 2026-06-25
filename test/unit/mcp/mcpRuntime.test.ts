/**
 * MCP 运行时测试。
 *
 * 测试目标:
 *   - 验证 MCP 工具的运行时调用、清理、超时与错误恢复
 *
 * 测试用例:
 *   - 正常调用 MCP 工具并清理 handler
 *   - 异常调用时错误被包装返回
 *   - 模拟超时 / 取消行为
 */
import { afterEach, describe, expect, mock, test } from "bun:test";

describe("MCP 运行时", () => {
  const cleanupHandlers = new Set<() => void | Promise<void>>();

  afterEach(async () => {
    mock.restore();
    cleanupHandlers.clear();
  });

  test("ensureMcpRuntimeStarted 首次启动单例化，重复调用不重复 startAll", async () => {
    const calls: string[] = [];

    class FakeManager {
      snapshot = [{ enabled: true, name: "s1", state: "connected", toolCount: 1, type: "stdio" }];
      connectedClients = [{ name: "s1", tools: [{ name: "s1_toolA" }] }];
      async startAll() {
        calls.push("startAll");
      }
      async stopAll() {
        calls.push("stopAll");
      }
      async refreshConfigs() {
        calls.push("refreshConfigs");
      }
      async restartServer(name: string) {
        calls.push(`restart:${name}`);
      }
      getServerConfig() {
        return { disabledTools: [] };
      }
    }

    mock.module("@/mcp/manager/mcpManager", () => ({
      McpManager: FakeManager,
    }));
    mock.module("@/mcp/oauth/oauthStore", () => ({
      clearOAuthSession: async () => {},
      deriveMcpAuthStatus: () => "not_authenticated",
      getOAuthEntry: async () => undefined,
      supportsMcpOAuth: () => false,
      updateOAuthClientInfo: async () => {},
      updateOAuthSession: async () => {},
      updateOAuthTokens: async () => {},
    }));
    mock.module("@/mcp/manager/mcpConfig", () => ({
      getMcpServers: async () => [],
      getProjectMcpConfigPath: () => undefined,
      loadMcpConfig: async () => [],
      readMergedMcpConfigRecord: async () => ({}),
      readMergedMcpConfigSources: async () => ({}),
      resetMcpConfigCache: () => {},
      setGlobalMcpServerEnabled: async () => {},
      setGlobalMcpToolDisabled: async () => {},
    }));
    mock.module("@/mcp/oauth/oauthCallback", () => ({
      cancelPendingOAuthCallback: () => {},
      ensureOAuthCallbackServer: async () => ({ redirectUri: "http://localhost/callback" }),
      waitForOAuthCallback: async () => ({ code: "x", state: "y" }),
    }));
    mock.module("@/mcp/client/mcpClient", () => ({
      McpClient: class {},
    }));
    mock.module("@/bus/lifecycle/globalCleanup", () => ({
      clearCleanup: () => cleanupHandlers.clear(),
      registerCleanup: (handler: () => void | Promise<void>) => {
        cleanupHandlers.add(handler);
        return () => cleanupHandlers.delete(handler);
      },
      runCleanup: async () => {
        for (const handler of [...cleanupHandlers].toReversed()) {
          await handler();
        }
        cleanupHandlers.clear();
        return false;
      },
    }));
    mock.module("@/core/logging/logger", () => ({
      createLogger: () => ({ debug: () => {}, error: () => {}, info: () => {}, warn: () => {} }),
    }));
    const actualToolRegistry = await import("@/tool/registry/toolRegistry");
    mock.module("@/tool/registry/toolRegistry", () => ({
      ...actualToolRegistry,
      getBuiltinToolGroups: () => [{ name: "builtin_demo", tools: ["tool_a", "tool_b"] }],
    }));

    const mod = await import("@/mcp/manager/runtime.ts");
    const a = await mod.ensureMcpRuntimeStarted();
    const b = await mod.ensureMcpRuntimeStarted();

    expect(a).toBe(b);
    expect(calls.filter((item: any) => item === "startAll")).toHaveLength(1);

    const snapshot = mod.getMcpRuntimeSnapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot.some((item: any) => item.name === "s1")).toBe(true);
    expect(snapshot.some((item: any) => item.tag === "builtin")).toBe(false);

    const builtinSnapshot = mod.getMcpRuntimeBuiltinSnapshot();
    expect(builtinSnapshot).toHaveLength(1);
    expect(builtinSnapshot[0]?.name).toBe("builtin_demo");
  });

  test("ensureMcpRuntimeStarted 结构化记录 startAll 失败并继续发布快照", async () => {
    class FakeManager {
      snapshot = [{ enabled: true, name: "broken", state: "error", toolCount: 0, type: "stdio" }];
      connectedClients: any[] = [];
      async startAll() {
        throw new Error("startup failed");
      }
      async stopAll() {}
      async refreshConfigs() {}
      async restartServer() {}
      getServerConfig() {
        return { disabledTools: [] };
      }
    }

    mock.module("@/mcp/manager/mcpManager", () => ({
      McpManager: FakeManager,
    }));
    mock.module("@/mcp/oauth/oauthStore", () => ({
      clearOAuthSession: async () => {},
      deriveMcpAuthStatus: () => "not_authenticated",
      getOAuthEntry: async () => undefined,
      supportsMcpOAuth: () => false,
      updateOAuthClientInfo: async () => {},
      updateOAuthSession: async () => {},
      updateOAuthTokens: async () => {},
    }));
    mock.module("@/mcp/manager/mcpConfig", () => ({
      getMcpServers: async () => [],
      getProjectMcpConfigPath: () => undefined,
      loadMcpConfig: async () => [],
      readMergedMcpConfigRecord: async () => ({}),
      readMergedMcpConfigSources: async () => ({}),
      resetMcpConfigCache: () => {},
      setGlobalMcpServerEnabled: async () => {},
      setGlobalMcpToolDisabled: async () => {},
    }));
    mock.module("@/mcp/oauth/oauthCallback", () => ({
      cancelPendingOAuthCallback: () => {},
      ensureOAuthCallbackServer: async () => ({ redirectUri: "http://localhost/callback" }),
      waitForOAuthCallback: async () => ({ code: "x", state: "y" }),
    }));
    mock.module("@/mcp/client/mcpClient", () => ({
      McpClient: class {},
    }));
    mock.module("@/bus/lifecycle/globalCleanup", () => ({
      clearCleanup: () => cleanupHandlers.clear(),
      registerCleanup: (handler: () => void | Promise<void>) => {
        cleanupHandlers.add(handler);
        return () => cleanupHandlers.delete(handler);
      },
      runCleanup: async () => {
        for (const handler of [...cleanupHandlers].toReversed()) {
          await handler();
        }
        cleanupHandlers.clear();
        return false;
      },
    }));
    mock.module("@/core/logging/logger", () => ({
      createLogger: () => ({ debug: () => {}, error: () => {}, info: () => {}, warn: () => {} }),
    }));
    const actualToolRegistry = await import("@/tool/registry/toolRegistry");
    mock.module("@/tool/registry/toolRegistry", () => ({
      ...actualToolRegistry,
      getBuiltinToolGroups: () => [],
    }));

    const mod = await import("@/mcp/manager/runtime.ts");
    await mod.ensureMcpRuntimeStarted();
    const { createMcpError, toMcpLogPayload } = await import("@/mcp/core/errors");
    const normalized = createMcpError(new Error("startup failed"), { operation: "startAll" }, "runtime");

    expect(toMcpLogPayload(normalized)).toMatchObject({
      error: "startup failed",
      errorCode: "TOOL-601",
    });
    expect(mod.getMcpRuntimeSnapshot()[0]?.name).toBe("broken");
  });

  test("startMcpRuntimeAuth 对缺失和不支持 OAuth 的 server 返回稳定错误码", async () => {
    let mergedRecord: Record<string, any> = {};

    mock.module("@/mcp/manager/mcpManager", () => ({
      McpManager: class {},
    }));
    mock.module("@/mcp/oauth/oauthStore", () => ({
      clearOAuthSession: async () => {},
      deriveMcpAuthStatus: () => "not_authenticated",
      getOAuthEntry: async () => undefined,
      supportsMcpOAuth: (config: any) => Boolean(config?.url) && config.oauth !== false,
      updateOAuthClientInfo: async () => {},
      updateOAuthSession: async () => {},
      updateOAuthTokens: async () => {},
    }));
    mock.module("@/mcp/manager/mcpConfig", () => ({
      getMcpServers: async () => [],
      getProjectMcpConfigPath: () => undefined,
      loadMcpConfig: async () => [],
      readMergedMcpConfigRecord: async () => mergedRecord,
      readMergedMcpConfigSources: async () => ({}),
      resetMcpConfigCache: () => {},
      setGlobalMcpServerEnabled: async () => {},
      setGlobalMcpToolDisabled: async () => {},
    }));
    mock.module("@/mcp/oauth/oauthCallback", () => ({
      cancelPendingOAuthCallback: () => {},
      ensureOAuthCallbackServer: async () => ({ redirectUri: "http://localhost/callback" }),
      waitForOAuthCallback: async () => ({ code: "x", state: "y" }),
    }));
    mock.module("@/mcp/client/mcpClient", () => ({
      McpClient: class {},
    }));
    mock.module("@/core/logging/logger", () => ({
      createLogger: () => ({ debug: () => {}, error: () => {}, info: () => {}, warn: () => {} }),
    }));

    const mod = await import("@/mcp/manager/runtime.ts");
    await expect(mod.startMcpRuntimeAuth("missing")).rejects.toMatchObject({
      code: "USER-204",
      message: 'MCP server "missing" not found',
    });

    mergedRecord = {
      stdio_only: {
        args: [],
        command: "node",
        oauth: false,
        type: "stdio",
      },
    };
    await expect(mod.startMcpRuntimeAuth("stdio_only")).rejects.toMatchObject({
      code: "TOOL-604",
      message: 'MCP server "stdio_only" does not support OAuth',
    });
  });

  test("refresh 和 restart 会委托到底层 manager，并在 cleanup 后可重启", async () => {
    const calls: string[] = [];

    class FakeManager {
      snapshot = [];
      connectedClients: any[] = [];
      async startAll() {
        calls.push("startAll");
      }
      async stopAll() {
        calls.push("stopAll");
      }
      async refreshConfigs() {
        calls.push("refreshConfigs");
      }
      async restartServer(name: string) {
        calls.push(`restart:${name}`);
      }
      getServerConfig() {
        return { disabledTools: [] };
      }
    }

    mock.module("@/mcp/manager/mcpManager", () => ({
      McpManager: FakeManager,
    }));
    mock.module("@/mcp/oauth/oauthStore", () => ({
      clearOAuthSession: async () => {},
      deriveMcpAuthStatus: () => "not_authenticated",
      getOAuthEntry: async () => undefined,
      supportsMcpOAuth: () => false,
      updateOAuthClientInfo: async () => {},
      updateOAuthSession: async () => {},
      updateOAuthTokens: async () => {},
    }));
    mock.module("@/mcp/manager/mcpConfig", () => ({
      getMcpServers: async () => [],
      getProjectMcpConfigPath: () => undefined,
      loadMcpConfig: async () => [],
      readMergedMcpConfigRecord: async () => ({}),
      readMergedMcpConfigSources: async () => ({}),
      resetMcpConfigCache: () => {},
      setGlobalMcpServerEnabled: async () => {},
      setGlobalMcpToolDisabled: async () => {},
    }));
    mock.module("@/mcp/oauth/oauthCallback", () => ({
      cancelPendingOAuthCallback: () => {},
      ensureOAuthCallbackServer: async () => ({ redirectUri: "http://localhost/callback" }),
      waitForOAuthCallback: async () => ({ code: "x", state: "y" }),
    }));
    mock.module("@/mcp/client/mcpClient", () => ({
      McpClient: class {},
    }));
    mock.module("@/bus/lifecycle/globalCleanup", () => ({
      clearCleanup: () => cleanupHandlers.clear(),
      registerCleanup: (handler: () => void | Promise<void>) => {
        cleanupHandlers.add(handler);
        return () => cleanupHandlers.delete(handler);
      },
      runCleanup: async () => {
        for (const handler of [...cleanupHandlers].toReversed()) {
          await handler();
        }
        cleanupHandlers.clear();
        return false;
      },
    }));
    mock.module("@/core/logging/logger", () => ({
      createLogger: () => ({ debug: () => {}, error: () => {}, info: () => {}, warn: () => {} }),
    }));
    const actualToolRegistry = await import("@/tool/registry/toolRegistry");
    mock.module("@/tool/registry/toolRegistry", () => ({
      ...actualToolRegistry,
      getBuiltinToolGroups: () => [],
    }));

    const mod = await import("@/mcp/manager/runtime.ts");
    await mod.ensureMcpRuntimeStarted();
    await mod.refreshMcpRuntime();
    await mod.restartMcpRuntimeServer("demo");

    expect(calls).toContain("refreshConfigs");
    expect(calls).toContain("restart:demo");

    for (const handler of [...cleanupHandlers].toReversed()) {
      await handler();
    }
    cleanupHandlers.clear();
    await mod.ensureMcpRuntimeStarted();

    expect(calls.filter((item: any) => item === "startAll").length).toBe(2);
    expect(calls).toContain("stopAll");
  });

  test("runtime snapshot 按具体 server 来源标记 global/project", async () => {
    class FakeManager {
      snapshot = [
        { enabled: true, name: "global_server", state: "connected", toolCount: 1, type: "stdio" },
        { enabled: true, name: "project_server", state: "connected", toolCount: 1, type: "stdio" },
      ];
      connectedClients = [
        { name: "global_server", tools: [{ name: "global_server_toolA" }] },
        { name: "project_server", tools: [{ name: "project_server_toolB" }] },
      ];
      async startAll() {}
      async stopAll() {}
      async refreshConfigs() {}
      async restartServer() {}
      getServerConfig() {
        return { disabledTools: [] };
      }
    }

    mock.module("@/mcp/manager/mcpManager", () => ({
      McpManager: FakeManager,
    }));
    mock.module("@/mcp/oauth/oauthStore", () => ({
      clearOAuthSession: async () => {},
      deriveMcpAuthStatus: () => "not_authenticated",
      getOAuthEntry: async () => undefined,
      supportsMcpOAuth: () => false,
      updateOAuthClientInfo: async () => {},
      updateOAuthSession: async () => {},
      updateOAuthTokens: async () => {},
    }));
    mock.module("@/mcp/manager/mcpConfig", () => ({
      getMcpServers: async () => [],
      getProjectMcpConfigPath: () => "/project/.crab/mcp.json",
      loadMcpConfig: async () => [],
      readMergedMcpConfigRecord: async () => ({}),
      readMergedMcpConfigSources: async () => ({
        global_server: { configPath: "/Users/test/.crab/mcp.json", source: "global" },
        project_server: { configPath: "/project/.crab/mcp.json", source: "project" },
      }),
      resetMcpConfigCache: () => {},
      setGlobalMcpServerEnabled: async () => {},
      setGlobalMcpToolDisabled: async () => {},
    }));
    mock.module("@/mcp/oauth/oauthCallback", () => ({
      cancelPendingOAuthCallback: () => {},
      ensureOAuthCallbackServer: async () => ({ redirectUri: "http://localhost/callback" }),
      waitForOAuthCallback: async () => ({ code: "x", state: "y" }),
    }));
    mock.module("@/mcp/client/mcpClient", () => ({
      McpClient: class {},
    }));
    mock.module("@/bus/lifecycle/globalCleanup", () => ({
      clearCleanup: () => cleanupHandlers.clear(),
      registerCleanup: (handler: () => void | Promise<void>) => {
        cleanupHandlers.add(handler);
        return () => cleanupHandlers.delete(handler);
      },
      runCleanup: async () => {
        for (const handler of [...cleanupHandlers].toReversed()) {
          await handler();
        }
        cleanupHandlers.clear();
        return false;
      },
    }));
    mock.module("@/core/logging/logger", () => ({
      createLogger: () => ({ debug: () => {}, error: () => {}, info: () => {}, warn: () => {} }),
    }));
    const actualToolRegistry = await import("@/tool/registry/toolRegistry");
    mock.module("@/tool/registry/toolRegistry", () => ({
      ...actualToolRegistry,
      getBuiltinToolGroups: () => [{ name: "builtin_demo", tools: ["tool_a"] }],
    }));

    const mod = await import("@/mcp/manager/runtime.ts");
    await mod.ensureMcpRuntimeStarted();

    const snapshot = mod.getMcpRuntimeSnapshot();
    const globalServer = snapshot.find((item: any) => item.name === "global_server");
    const projectServer = snapshot.find((item: any) => item.name === "project_server");

    expect(globalServer?.source).toBe("global");
    expect(globalServer?.configPath).toBe("/Users/test/.crab/mcp.json");
    expect(projectServer?.source).toBe("project");
    expect(projectServer?.configPath).toBe("/project/.crab/mcp.json");
    expect(snapshot.some((item: any) => item.tag === "builtin")).toBe(false);
    expect(mod.getMcpRuntimeBuiltinSnapshot()[0]?.name).toBe("builtin_demo");
  });

  test("runtime exposes auth capabilities, prompt/resource helpers, and config toggles", async () => {
    const calls: string[] = [];

    class FakeManager {
      snapshot = [
        { enabled: true, name: "oauth_srv", state: "connected", toolCount: 2, type: "http" },
        { enabled: true, name: "stdio_srv", state: "connected", toolCount: 1, type: "stdio" },
      ];
      connectedClients = [
        {
          getPrompt: async (name: string, args?: Record<string, string>) => ({ args, name }),
          listPrompts: async () => [{ description: "Summarize context", name: "summarize" }],
          listResources: async () => [{ mimeType: "text/markdown", name: "docs", uri: "file:///docs.md" }],
          name: "oauth_srv",
          readResource: async (uri: string) => ({ text: "resource text", uri }),
          tools: [{ name: "oauth_srv_read" }, { name: "custom_tool" }],
        },
      ];
      async startAll() {
        calls.push("startAll");
      }
      async stopAll() {
        calls.push("stopAll");
      }
      async refreshConfigs() {
        calls.push("refreshConfigs");
      }
      async restartServer(name: string) {
        calls.push(`restart:${name}`);
      }
      getServerConfig(name: string) {
        if (name === "oauth_srv") {
          return {
            disabledTools: ["write"],
            name,
            oauth: {},
            type: "http",
            url: "https://example.com/mcp",
          };
        }
        if (name === "stdio_srv") {
          return {
            command: "node",
            disabledTools: [],
            name,
            oauth: false,
            type: "stdio",
          };
        }
        return undefined;
      }
    }

    mock.module("@/mcp/manager/mcpManager", () => ({
      McpManager: FakeManager,
    }));
    mock.module("@/mcp/oauth/oauthStore", () => ({
      clearOAuthSession: async () => true,
      deriveMcpAuthStatus: (config: any, entry: any) => {
        if (!config?.url || config.oauth === false) {
          return "unsupported";
        }
        return entry?.tokens?.accessToken ? "authenticated" : "not_authenticated";
      },
      getOAuthEntry: async (name: string) =>
        name === "oauth_srv" ? { tokens: { accessToken: "token-1" } } : undefined,
      supportsMcpOAuth: (config: any) => Boolean(config?.url) && config.oauth !== false,
      updateOAuthClientInfo: async () => true,
      updateOAuthSession: async () => true,
      updateOAuthTokens: async () => true,
    }));
    mock.module("@/mcp/manager/mcpConfig", () => ({
      getMcpServers: async () => [],
      getProjectMcpConfigPath: () => undefined,
      loadMcpConfig: async () => [],
      readMergedMcpConfigRecord: async () => ({}),
      readMergedMcpConfigSources: async () => ({
        oauth_srv: { configPath: "/tmp/global-mcp.json", source: "global" },
        stdio_srv: { configPath: "/tmp/project/.crab/mcp.json", source: "project" },
      }),
      resetMcpConfigCache: () => {},
      setGlobalMcpServerEnabled: async (name: string, enabled: boolean) => {
        calls.push(`server-enabled:${name}:${enabled}`);
        return name !== "missing";
      },
      setGlobalMcpToolDisabled: async (name: string, toolName: string, disabled: boolean) => {
        calls.push(`tool-disabled:${name}:${toolName}:${disabled}`);
        return toolName !== "missing_tool";
      },
    }));
    mock.module("@/mcp/oauth/oauthCallback", () => ({
      cancelPendingOAuthCallback: () => {},
      ensureOAuthCallbackServer: async () => ({ redirectUri: "http://localhost/callback" }),
      waitForOAuthCallback: async () => ({ code: "x", state: "y" }),
    }));
    mock.module("@/mcp/client/mcpClient", () => ({
      McpClient: class {},
    }));
    mock.module("@/bus/lifecycle/globalCleanup", () => ({
      clearCleanup: () => cleanupHandlers.clear(),
      registerCleanup: (handler: () => void | Promise<void>) => {
        cleanupHandlers.add(handler);
        return () => cleanupHandlers.delete(handler);
      },
      runCleanup: async () => {
        for (const handler of [...cleanupHandlers].toReversed()) {
          await handler();
        }
        cleanupHandlers.clear();
        return false;
      },
    }));
    mock.module("@/core/logging/logger", () => ({
      createLogger: () => ({ debug: () => {}, error: () => {}, info: () => {}, warn: () => {} }),
    }));
    const actualToolRegistry = await import("@/tool/registry/toolRegistry");
    mock.module("@/tool/registry/toolRegistry", () => ({
      ...actualToolRegistry,
      getBuiltinToolGroups: () => [],
    }));

    const mod = await import("@/mcp/manager/runtime.ts");
    await mod.ensureMcpRuntimeStarted();

    expect(await mod.getMcpRuntimeAuthStatus("oauth_srv")).toBe("authenticated");
    expect(await mod.getMcpRuntimeAuthStatus("stdio_srv")).toBe("unsupported");
    expect(await mod.getMcpRuntimeAuthCapabilities()).toEqual([
      { name: "oauth_srv", status: "authenticated", supported: true },
      { name: "stdio_srv", status: "unsupported", supported: false },
    ]);

    expect(await mod.getMcpRuntimePrompts()).toEqual([
      { description: "Summarize context", name: "summarize", server: "oauth_srv" },
    ]);
    expect(await mod.getMcpRuntimeResources()).toEqual([
      { mimeType: "text/markdown", name: "docs", server: "oauth_srv", uri: "file:///docs.md" },
    ]);
    expect(await mod.getMcpRuntimePrompt("oauth_srv", "summarize", { topic: "mcp" })).toEqual({
      args: { topic: "mcp" },
      name: "summarize",
    });
    expect(await mod.readMcpRuntimeResource("oauth_srv", "file:///docs.md")).toEqual({
      text: "resource text",
      uri: "file:///docs.md",
    });
    await expect(mod.getMcpRuntimePrompt("missing_srv", "summarize")).rejects.toThrow(
      'MCP server "missing_srv" is not connected',
    );
    await expect(mod.readMcpRuntimeResource("missing_srv", "file:///docs.md")).rejects.toThrow(
      'MCP server "missing_srv" is not connected',
    );

    expect(await mod.setMcpRuntimeServerEnabled("oauth_srv", false)).toBe(true);
    expect(await mod.setMcpRuntimeServerEnabled("missing", true)).toBe(false);
    expect(await mod.setMcpRuntimeToolDisabled("oauth_srv", "write", true)).toBe(true);
    expect(await mod.setMcpRuntimeToolDisabled("oauth_srv", "missing_tool", false)).toBe(false);
    expect(calls).toContain("server-enabled:oauth_srv:false");
    expect(calls).toContain("server-enabled:missing:true");
    expect(calls).toContain("tool-disabled:oauth_srv:write:true");
    expect(calls).toContain("tool-disabled:oauth_srv:missing_tool:false");
    expect(calls.filter((item) => item === "refreshConfigs").length).toBe(2);

    const snapshot = mod.getMcpRuntimeSnapshot();
    const oauthSnapshot = snapshot.find((item: any) => item.name === "oauth_srv");
    expect(oauthSnapshot?.disabledTools).toEqual(["write"]);
    expect(oauthSnapshot?.toolNames).toEqual(["read", "custom_tool"]);
    expect(oauthSnapshot?.supportsOAuth).toBe(true);
    expect(oauthSnapshot?.authStatus).toBe("authenticated");
  });
});
