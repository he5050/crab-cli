/**
 * MCP 高风险写操作端到端测试。
 *
 * 测试目标:
 *   - 验证 McpManager 在执行高风险写工具(删除/重写/外部副作用)时的端到端行为
 *
 * 测试用例:
 *   - 高风险写操作被正确拦截或审批
 *   - 真实脚本执行后磁盘状态与预期一致
 */
import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { McpManager } from "@/mcp/manager/mcpManager";
import { ToolExecutor } from "@/tool/executor/toolExecutor";
import { clearToolsCache, getRegisteredTools } from "@/tool/registry/toolRegistry";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../helpers/testPaths";
import { type AppConfigSchema, AppConfigSchema as AppConfigSchemaZod } from "@/schema/config";

const hasBun = (() => {
  try {
    execSync("bun --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
})();

const baseConfig: AppConfigSchema = AppConfigSchemaZod.parse({
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

describe.skipIf(!hasBun)("MCP high-risk write E2E", () => {
  let tempDir = "";
  let manager: McpManager | undefined;

  afterEach(async () => {
    await manager?.stopAll();
    manager = undefined;
    clearToolsCache();
    if (tempDir) {
      cleanupTestDir(tempDir);
    }
    tempDir = "";
  });

  test("真实 stdio MCP 写入工具走权限确认后执行，高风险删除工具被 hard-deny", async () => {
    tempDir = createGlobalTmpTestDir("mcp-high-risk-");
    const fixturePath = path.resolve("test/fixtures/mcp/high-risk-write-server.cjs");
    manager = new McpManager({
      callTimeout: 10_000,
      connectTimeout: 10_000,
      getServerConfigs: () => [
        {
          args: [fixturePath],
          command: "bun",
          cwd: process.cwd(),
          env: { CRAB_MCP_SANDBOX_ROOT: tempDir },
          name: "highrisk",
        },
      ],
    });

    await manager.startAll();
    expect(getRegisteredTools()["highrisk_write_file"]).toBeDefined();
    expect(getRegisteredTools()["highrisk_delete_file"]).toBeDefined();

    const asked: string[] = [];
    const executor = new ToolExecutor({
      askPermission: async (toolName) => {
        asked.push(toolName);
        return true;
      },
      getConfig: () => baseConfig,
      getToolContext: () => ({ messageId: "msg_mcp_highrisk", sessionId: "ses_mcp_highrisk" }),
    });

    const filePath = path.join(tempDir, "nested", "from-mcp.txt");
    const writeResult = await executor.execute("highrisk_write_file", {
      content: "mcp write ok",
      path: filePath,
    });

    expect(writeResult.success).toBe(true);
    expect(asked).toContain("highrisk_write_file");
    expect(fs.readFileSync(filePath, "utf8")).toBe("mcp write ok");

    const deleteResult = await executor.execute("highrisk_delete_file", { path: filePath });
    expect(deleteResult.success).toBe(false);
    expect(deleteResult.error).toContain("Permission denied");
    expect(fs.existsSync(filePath)).toBe(true);
  }, 30_000);
});
