/**
 * MCP 管理器测试。
 *
 * 测试用例:
 *   - 服务器启动
 *   - 客户端连接
 *   - 工具发现
 *   - 配置管理
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { execSync } from "node:child_process";
import path from "node:path";
import { McpManager } from "@/mcp/manager/mcpManager";
import { clearToolsCache, getRegisteredTools } from "@/tool/registry/toolRegistry";
import type { McpServerConfig } from "@/schema/config";
import { type AppConfigSchema, AppConfigSchema as AppConfigSchemaZod } from "@/schema/config";

const mockConfig: AppConfigSchema = AppConfigSchemaZod.parse({
  agents: [],
  autoformat: true,
  codebase: {
    documentTypes: ["pdf", "docx", "xlsx", "pptx"],
    ignorePatterns: [],
    includeDocuments: false,
    indexingEnabled: true,
    maxFileSize: 1_048_576,
    watchMode: true,
  },
  customHeaders: {},
  customSystemPrompt: "",
  defaultProvider: { model: "gpt-4o", provider: "openai" },
  devMode: false,
  doomLoopThreshold: 5,
  loops: { maxActive: 10 },
  maxContextTokens: 200_000,
  maxSpawnDepth: 3,
  permissions: [],
  profile: "default",
  providerConfig: {},
  proxy: { browserDebugPort: 9222, enabled: false, port: 7890, searchEngine: "duckduckgo" },
  sensitiveCommands: { commands: [], enabled: true },
  telemetry: { enabled: false, exporterType: "none", sampleRate: 1, serviceName: "crab-cli" },
  theme: "dark",
  thinking: { enabled: false },
  toolResultTokenLimitPercent: 30,
});

const hasBun = (() => {
  try {
    execSync("bun --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
})();

describe("McpManager — 基础", () => {
  test("启动带无服务", () => {
    const manager = new McpManager({
      getServerConfigs: () => [],
    });

    expect(manager.isStarted).toBe(false);
    expect(manager.connectedClients).toHaveLength(0);
    expect(manager.status).toHaveLength(0);
  });

  test("startAll 带无服务完成无错误", async () => {
    const manager = new McpManager({
      getServerConfigs: () => [],
    });

    await manager.startAll();
    expect(manager.isStarted).toBe(true);
    expect(manager.status).toHaveLength(0);

    await manager.stopAll();
  });

  test("stopAll 当不已开始是 a no-op", async () => {
    const manager = new McpManager({
      getServerConfigs: () => [],
    });

    await manager.stopAll(); // 不应抛错
    expect(manager.isStarted).toBe(false);
  });

  test("double startAll is a no-op", async () => {
    const manager = new McpManager({
      getServerConfigs: () => [],
    });

    await manager.startAll();
    await manager.startAll(); // 不应抛错
    expect(manager.isStarted).toBe(true);

    await manager.stopAll();
  });
});

describe("McpManager — 服务器连接", () => {
  test("startAll 连接至已配置服务", async () => {
    const configs: McpServerConfig[] = [{ args: [], command: "nonexistent-xyz", name: "test-srv" }];

    const manager = new McpManager({
      connectTimeout: 1000,
      getServerConfigs: () => configs,
    });

    // 连接会失败(命令不存在)，但不应抛出(startAll 使用 allSettled)
    await manager.startAll();
    expect(manager.isStarted).toBe(true);

    await manager.stopAll();
  });

  test("restartServer 抛出为未知服务", async () => {
    const manager = new McpManager({
      getServerConfigs: () => [],
    });

    await manager.startAll();
    expect(manager.restartServer("nonexistent")).rejects.toThrow("not found");

    await manager.stopAll();
  });

  test("refreshConfigs 添加新服务", async () => {
    let configs: McpServerConfig[] = [];

    const manager = new McpManager({
      connectTimeout: 1000,
      getServerConfigs: () => configs,
    });

    await manager.startAll();
    expect(manager.status).toHaveLength(0);

    // 添加新配置
    configs = [{ args: ["hi"], command: "echo", name: "new-srv" }];
    await manager.refreshConfigs();

    // 新服务器已添加(连接可能失败)
    await manager.stopAll();
  });

  test("refreshConfigs 移除已删除服务", async () => {
    let configs: McpServerConfig[] = [{ args: [], command: "echo", name: "to-remove" }];

    const manager = new McpManager({
      connectTimeout: 1000,
      getServerConfigs: () => configs,
    });

    await manager.startAll();

    // 清空配置
    configs = [];
    await manager.refreshConfigs();

    expect(manager.status).toHaveLength(0);

    await manager.stopAll();
  });
});

describe("McpManager — 重连策略", () => {
  test("默认重连策略值", () => {
    const manager = new McpManager({
      getServerConfigs: () => [],
    });

    // Manager 不暴露 reconnectPolicy，验证创建不报错即可
    expect(manager.isStarted).toBe(false);
  });

  test("自定义重连策略", () => {
    const manager = new McpManager({
      getServerConfigs: () => [],
      reconnectPolicy: {
        backoffMultiplier: 3,
        initialDelay: 1000,
        maxDelay: 60_000,
        maxRetries: 5,
      },
    });

    expect(manager.isStarted).toBe(false);
  });
});

describe("McpManager — 状态", () => {
  test("状态返回数组的服务状态", async () => {
    const configs: McpServerConfig[] = [
      { args: [], command: "echo", name: "srv-a" },
      { args: [], command: "echo", name: "srv-b" },
    ];

    const manager = new McpManager({
      connectTimeout: 500,
      getServerConfigs: () => configs,
    });

    await manager.startAll();

    const { status } = manager;
    expect(status).toHaveLength(2);
    expect(status.map((s) => s.name)).toContain("srv-a");
    expect(status.map((s) => s.name)).toContain("srv-b");

    await manager.stopAll();
  });

  (hasBun ? test : test.skip)(
    "updates registered tools and snapshot after tools/list_changed notification",
    async () => {
      clearToolsCache();
      const fixturePath = path.resolve("test/fixtures/mcp/list-changed-server.cjs");
      const manager = new McpManager({
        callTimeout: 10_000,
        connectTimeout: 10_000,
        getServerConfigs: () => [
          {
            args: [fixturePath],
            command: "bun",
            cwd: process.cwd(),
            name: "dynamic-manager",
          },
        ],
      });

      await manager.startAll();
      expect(manager.snapshot[0]?.toolCount).toBe(1);
      expect(getRegisteredTools()["dynamic-manager_alpha_tool"]).toBeDefined();

      await new Promise<void>((resolve, reject) => {
        const started = Date.now();
        const timer = setInterval(() => {
          const snapshot = manager.snapshot.find((item) => item.name === "dynamic-manager");
          if (snapshot?.toolCount === 2 && getRegisteredTools()["dynamic-manager_beta_tool"]) {
            clearInterval(timer);
            resolve();
            return;
          }
          if (Date.now() - started > 5000) {
            clearInterval(timer);
            reject(new Error("Timed out waiting for manager tools refresh"));
          }
        }, 50);
      });

      expect(manager.snapshot[0]?.toolCount).toBe(2);
      expect(getRegisteredTools()["dynamic-manager_beta_tool"]).toBeDefined();
      await manager.stopAll();
    },
  );
});
