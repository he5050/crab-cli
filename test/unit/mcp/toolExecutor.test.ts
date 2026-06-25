/**
 * 工具执行器测试。
 *
 * 测试用例:
 *   - 工具执行
 *   - 参数验证
 *   - 结果返回
 *   - 错误处理
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { defineTool } from "@/tool/types";
import { clearToolsCache, registerTool, unregisterTool } from "@/tool/registry/toolRegistry";
import {
  type ToolExecutionResult,
  ToolExecutor,
  checkCommandInjection,
  isSensitiveCall,
} from "@/tool/executor/toolExecutor";
import { type AppConfigSchema, AppConfigSchema as AppConfigSchemaZod } from "@/schema/config";
import { getDefaultPermissions } from "@/config";

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
  permissions: [{ action: "allow", pattern: "*", permission: "*" }],
  profile: "default",
  providerConfig: {},
  proxy: { browserDebugPort: 9222, enabled: false, port: 7890, searchEngine: "duckduckgo" },
  sensitiveCommands: { commands: [], enabled: true },
  telemetry: { enabled: false, exporterType: "none", sampleRate: 1, serviceName: "crab-cli" },
  theme: "dark",
  thinking: { enabled: false },
  toolResultTokenLimitPercent: 30,
});

async function withTempGlobalSettings(settings: Record<string, unknown>, run: () => Promise<void>): Promise<void> {
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  const tempConfigHome = fs.mkdtempSync(path.join(os.tmpdir(), "crab-tool-exec-settings-"));
  const configDir = path.join(tempConfigHome, "crab");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "settings.json"), JSON.stringify(settings), "utf8");
  process.env.XDG_CONFIG_HOME = tempConfigHome;

  try {
    await run();
  } finally {
    if (originalXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    }
    fs.rmSync(tempConfigHome, { force: true, recursive: true });
  }
}

describe("ToolExecutor — 工具查找", () => {
  let executor: ToolExecutor;

  beforeEach(() => {
    clearToolsCache();
    executor = new ToolExecutor({ getConfig: () => mockConfig });
  });

  test("返回错误为未知工具", async () => {
    const result = await executor.execute("nonexistent_tool", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  test("查找已注册工具", async () => {
    const tool = defineTool({
      description: "Echo test",
      execute: async (args) => args.msg,
      name: "test_echo",
      parameters: z.object({ msg: z.string() }),
      permission: "test",
    });
    registerTool(tool);

    const result = await executor.execute("test_echo", { msg: "hello" });
    expect(result.success).toBe(true);
    expect(result.output).toBe("hello");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    unregisterTool("test_echo");
  });

  test("直接执行前拦截已禁用的 MCP 工具", async () => {
    await withTempGlobalSettings({ disabledMCPTools: ["apifox:blocked_exec"] }, async () => {
      let didExecute = false;
      const tool = defineTool({
        description: "Disabled MCP execution guard",
        execute: async () => {
          didExecute = true;
          return "should not run";
        },
        name: "apifox_blocked_exec",
        parameters: z.object({}),
        permission: "mcp.apifox.blocked_exec",
      });
      registerTool(tool);

      try {
        const result = await executor.execute("apifox_blocked_exec", {});
        expect(result.success).toBe(false);
        expect(result.error).toContain("disabled by settings");
        expect(didExecute).toBe(false);
      } finally {
        unregisterTool("apifox_blocked_exec");
        clearToolsCache();
      }
    });
  });

  test("listToolNames 返回全部已注册工具", () => {
    const tool = defineTool({
      description: "Test",
      execute: async () => null,
      name: "list_test_tool",
      parameters: z.object({}),
      permission: "test",
    });
    registerTool(tool);

    const names = executor.listToolNames();
    expect(names).toContain("list_test_tool");

    unregisterTool("list_test_tool");
  });
});

describe("ToolExecutor — 权限检查", () => {
  test("未配置规则时默认询问", async () => {
    const tool = defineTool({
      description: "Test",
      execute: async () => "allowed",
      name: "perm_test_allow",
      parameters: z.object({}),
      permission: "test.allow",
    });
    registerTool(tool);

    const executor = new ToolExecutor({ getConfig: () => ({ ...mockConfig, permissions: [] }) });
    const result = await executor.execute("perm_test_allow", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("rejected");

    unregisterTool("perm_test_allow");
  });

  test("回退回至默认权限当配置.权限是空", async () => {
    const tool = defineTool({
      description: "Default bash deny coverage",
      execute: async () => "should not run",
      name: "perm_default_bash_deny",
      parameters: z.object({
        command: z.string(),
      }),
      permission: "bash",
    });
    registerTool(tool);

    const executor = new ToolExecutor({
      getConfig: () => ({ ...mockConfig, permissions: [] }),
    });
    const result = await executor.execute("perm_default_bash_deny", { command: "sudo rm -rf /" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("denied");

    unregisterTool("perm_default_bash_deny");
  });

  test("hard deny rules take precedence over user allow rules", async () => {
    const tool = defineTool({
      description: "Hard deny precedence coverage",
      execute: async () => "should not run",
      name: "perm_hard_deny_precedence",
      parameters: z.object({
        command: z.string(),
      }),
      permission: "bash",
    });
    registerTool(tool);

    const executor = new ToolExecutor({
      getConfig: () => ({
        ...mockConfig,
        permissions: [{ action: "allow", pattern: "*", permission: "bash" }],
      }),
    });
    const result = await executor.execute("perm_hard_deny_precedence", { command: "sudo rm -rf /" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("denied");

    unregisterTool("perm_hard_deny_precedence");
  });

  test("拒绝当规则匹配", async () => {
    const tool = defineTool({
      description: "Test",
      execute: async () => "should not run",
      name: "perm_test_deny",
      parameters: z.object({}),
      permission: "test.deny",
    });
    registerTool(tool);

    const configWithDeny: AppConfigSchema = {
      ...mockConfig,
      permissions: [
        {
          action: "deny",
          pattern: "*",
          permission: "test.deny",
        },
      ],
    };

    const executor = new ToolExecutor({ getConfig: () => configWithDeny });
    const result = await executor.execute("perm_test_deny", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("denied");

    unregisterTool("perm_test_deny");
  });

  test("ask 触发 callback 并尊重拒绝", async () => {
    const tool = defineTool({
      description: "Test",
      execute: async () => "should not run",
      name: "perm_test_ask_reject",
      parameters: z.object({}),
      permission: "test.ask",
    });
    registerTool(tool);

    const configWithAsk: AppConfigSchema = {
      ...mockConfig,
      permissions: [
        {
          action: "ask",
          pattern: "*",
          permission: "test.ask",
        },
      ],
    };

    const askPermission = mock(async (_toolName: string, _args: Record<string, unknown>) => false);
    const executor = new ToolExecutor({
      askPermission,
      getConfig: () => configWithAsk,
    });

    const result = await executor.execute("perm_test_ask_reject", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("rejected");
    expect(askPermission).toHaveBeenCalled();

    unregisterTool("perm_test_ask_reject");
  });

  test("ask 触发 callback 并尊重批准", async () => {
    const tool = defineTool({
      description: "Test",
      execute: async () => "approved result",
      name: "perm_test_ask_approve",
      parameters: z.object({}),
      permission: "test.ask",
    });
    registerTool(tool);

    const configWithAsk: AppConfigSchema = {
      ...mockConfig,
      permissions: [
        {
          action: "ask",
          pattern: "*",
          permission: "test.ask",
        },
      ],
    };

    const askPermission = mock(() => Promise.resolve(true));
    const executor = new ToolExecutor({
      askPermission,
      getConfig: () => configWithAsk,
    });

    const result = await executor.execute("perm_test_ask_approve", {});
    expect(result.success).toBe(true);
    expect(result.output).toBe("approved result");

    unregisterTool("perm_test_ask_approve");
  });

  test("terminal-execute sensitive command requires a second sensitive approval", async () => {
    const configAllowBash: AppConfigSchema = {
      ...mockConfig,
      permissions: [{ action: "allow", pattern: "*", permission: "bash" }],
    };
    const askPermission = mock(() => Promise.resolve(false));
    const executor = new ToolExecutor({
      askPermission,
      getConfig: () => configAllowBash,
    });

    const result = await executor.execute("terminal-execute", { command: "git push --force origin main" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("sensitive command");
    expect(askPermission).toHaveBeenCalledTimes(1);
    const calls = askPermission.mock.calls as unknown as [string, Record<string, unknown>][];
    expect(calls[0]?.[1]).toMatchObject({ __sensitive: true });
  });

  test("通配符权限规则匹配全部工具", async () => {
    const tool = defineTool({
      description: "Test",
      execute: async () => "blocked",
      name: "perm_wildcard_test",
      parameters: z.object({}),
      permission: "anything.here",
    });
    registerTool(tool);

    const configWithWildcardDeny: AppConfigSchema = {
      ...mockConfig,
      permissions: [{ action: "deny", pattern: "*", permission: "*" }],
    };

    const executor = new ToolExecutor({ getConfig: () => configWithWildcardDeny });
    const result = await executor.execute("perm_wildcard_test", {});
    expect(result.success).toBe(false);

    unregisterTool("perm_wildcard_test");
  });

  test("前缀通配符匹配", async () => {
    const tool = defineTool({
      description: "Test",
      execute: async () => "data",
      name: "perm_prefix_test",
      parameters: z.object({}),
      permission: "fs.read.file",
    });
    registerTool(tool);

    const configWithPrefix: AppConfigSchema = {
      ...mockConfig,
      permissions: [{ action: "deny", pattern: "*", permission: "fs.*" }],
    };

    const executor = new ToolExecutor({ getConfig: () => configWithPrefix });
    const result = await executor.execute("perm_prefix_test", {});
    expect(result.success).toBe(false);

    unregisterTool("perm_prefix_test");
  });
});

describe("ToolExecutor — 参数验证", () => {
  test("校验参数带 Zod 模式", async () => {
    const tool = defineTool({
      description: "Test",
      execute: async (args) => `${args.name}: ${args.count}`,
      name: "validate_test",
      parameters: z.object({
        count: z.number().int().positive(),
        name: z.string().min(1),
      }),
      permission: "test",
    });
    registerTool(tool);

    const executor = new ToolExecutor({ getConfig: () => mockConfig });

    // Valid
    const good = await executor.execute("validate_test", { count: 5, name: "test" });
    expect(good.success).toBe(true);
    expect(good.output).toBe("test: 5");

    // Invalid count
    const bad1 = await executor.execute("validate_test", { count: -1, name: "test" });
    expect(bad1.success).toBe(false);
    expect(bad1.error).toContain("validation failed");

    // Missing name
    const bad2 = await executor.execute("validate_test", { count: 5 });
    expect(bad2.success).toBe(false);
    expect(bad2.error).toContain("validation failed");

    unregisterTool("validate_test");
  });
});

describe("ToolExecutor — 执行错误", () => {
  test("捕获执行错误", async () => {
    const tool = defineTool({
      description: "Test",
      execute: async () => {
        throw new Error("execution boom");
      },
      name: "error_test",
      parameters: z.object({}),
      permission: "test",
    });
    registerTool(tool);

    const executor = new ToolExecutor({ getConfig: () => mockConfig });
    const result = await executor.execute("error_test", {});
    expect(result.success).toBe(false);
    expect(result.error).toBe("execution boom");

    unregisterTool("error_test");
  });

  test("捕获非 Error 抛出", async () => {
    const tool = defineTool({
      description: "Test",
      execute: async () => {
        throw "string error";
      },
      name: "string_throw_test",
      parameters: z.object({}),
      permission: "test",
    });
    registerTool(tool);

    const executor = new ToolExecutor({ getConfig: () => mockConfig });
    const result = await executor.execute("string_throw_test", {});
    expect(result.success).toBe(false);
    expect(result.error).toBe("string error");

    unregisterTool("string_throw_test");
  });

  test("按配置 token limit 截断超长字符串输出", async () => {
    const tool = defineTool({
      description: "Test",
      execute: async () => "x".repeat(4000),
      name: "token_limit_string_test",
      parameters: z.object({}),
      permission: "test",
    });
    registerTool(tool);

    const limitedConfig: AppConfigSchema = {
      ...mockConfig,
      maxContextTokens: 1000,
      toolResultTokenLimitPercent: 20,
    };

    const executor = new ToolExecutor({ getConfig: () => limitedConfig });
    const result = await executor.execute("token_limit_string_test", {});

    expect(result.success).toBe(true);
    expect(typeof result.output).toBe("string");
    expect(String(result.output)).toContain("Output truncated");
    expect(String(result.output).length).toBeLessThan(4000);

    unregisterTool("token_limit_string_test");
  });

  test("按配置 token limit 截断超大对象输出", async () => {
    const tool = defineTool({
      description: "Test",
      execute: async () => ({
        payload: "y".repeat(120_000),
      }),
      name: "token_limit_object_test",
      parameters: z.object({}),
      permission: "test",
    });
    registerTool(tool);

    const limitedConfig: AppConfigSchema = {
      ...mockConfig,
      maxContextTokens: 1000,
      toolResultTokenLimitPercent: 20,
    };

    const executor = new ToolExecutor({ getConfig: () => limitedConfig });
    const result = await executor.execute("token_limit_object_test", {});

    expect(result.success).toBe(true);
    expect(typeof result.output).toBe("string");
    expect(String(result.output)).toContain("Output truncated");
    expect(String(result.output).length).toBeLessThan(120_000);

    unregisterTool("token_limit_object_test");
  });
});

describe("isSensitiveCall", () => {
  test("检测 rm -rf", () => {
    expect(isSensitiveCall("terminal_execute", { command: "rm -rf /" })).toBe(true);
  });

  test("detects sudo rm", () => {
    expect(isSensitiveCall("bash_tool", { cmd: "sudo rm /etc/passwd" })).toBe(true);
  });

  test("detects git push --force", () => {
    expect(isSensitiveCall("shell_run", { command: "git push --force origin main" })).toBe(true);
  });

  test("检测 DROP TABLE", () => {
    expect(isSensitiveCall("exec_sql", { command: "DROP TABLE users" })).toBe(true);
  });

  test("忽略安全命令", () => {
    expect(isSensitiveCall("terminal_execute", { command: "ls -la" })).toBe(false);
    expect(isSensitiveCall("bash_tool", { command: "echo hello" })).toBe(false);
  });

  test("忽略非终态工具", () => {
    expect(isSensitiveCall("read_file", { command: "rm -rf /" })).toBe(false);
    expect(isSensitiveCall("search_tool", { command: "DROP TABLE" })).toBe(false);
  });

  test("ignores non-string commands", () => {
    expect(isSensitiveCall("terminal_execute", { command: 123 })).toBe(false);
    expect(isSensitiveCall("terminal_execute", {})).toBe(false);
  });
});
