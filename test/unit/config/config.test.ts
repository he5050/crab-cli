/**
 * 配置系统测试。
 *
 * 测试用例:
 *   - 默认配置加载
 *   - 全局配置覆盖
 *   - 部分覆盖
 *   - 环境变量配置
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { AppConfigSchema, McpConfigFileSchema } from "@/schema/config";
import fs from "node:fs";
import path from "node:path";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../helpers/testPaths";

describe("配置系统", () => {
  test("默认配置加载", () => {
    const cfg = AppConfigSchema.parse({});
    expect(cfg.profile).toBe("default");
    expect(cfg.defaultProvider.provider).toBe("openai");
    expect(cfg.defaultProvider.model).toBe("");
    expect(cfg.theme).toBe("dark");
    expect(cfg.permissions).toEqual([]);
    expect(cfg.devMode).toBe(false);
  });

  test("全局配置覆盖默认", () => {
    const cfg = AppConfigSchema.parse({
      defaultProvider: { model: "claude-3.5-sonnet", provider: "anthropic" },
      theme: "light",
    });
    expect(cfg.defaultProvider.provider).toBe("anthropic");
    expect(cfg.defaultProvider.model).toBe("claude-3.5-sonnet");
    expect(cfg.theme).toBe("light");
    expect(cfg.profile).toBe("default");
  });

  test("部分覆盖不影响其他字段", () => {
    const cfg = AppConfigSchema.parse({
      defaultProvider: { model: "gpt-5" },
    });
    expect(cfg.defaultProvider.model).toBe("gpt-5");
    expect(cfg.defaultProvider.provider).toBe("openai");
  });

  test("无效配置 Zod 报错(无效 Provider 配置 baseURL)", () => {
    const result = AppConfigSchema.safeParse({
      providerConfig: {
        openai: { baseURL: "not-a-url" },
      },
    });
    expect(result.success).toBe(false);
  });

  test("MCP 服务器配置(从 mcp.json 独立加载)", () => {
    const cfg = McpConfigFileSchema.parse({
      mcpServers: {
        filesystem: {
          args: ["-y", "@modelcontextprotocol/server-filesystem"],
          command: "npx",
          disabledTools: ["edit_file"],
        },
      },
    });
    expect(cfg.mcpServers.filesystem).toBeDefined();
    expect(cfg.mcpServers.filesystem!.command).toBe("npx");
    expect(cfg.mcpServers.filesystem!.disabledTools).toEqual(["edit_file"]);
  });

  test("Proxy 配置", () => {
    const cfg = AppConfigSchema.parse({
      proxy: { enabled: true, url: "http://localhost:7890" },
    });
    expect(cfg.proxy.enabled).toBe(true);
  });

  test("默认语言固定为中文，未暴露语言切换", () => {
    const cfg = AppConfigSchema.parse({});
    expect((cfg as any).language).toBeUndefined();
  });

  test("providerConfig 多 Provider 共存", () => {
    const cfg = AppConfigSchema.parse({
      providerConfig: {
        anthropic: { apiKey: "sk-ant-test", defaultModel: "claude-sonnet-4-20250514" },
        openai: { apiKey: "sk-test", defaultModel: "gpt-4o" },
      },
    });
    expect(cfg.providerConfig.openai!).toBeDefined();
    expect(cfg.providerConfig.anthropic!).toBeDefined();
    expect(cfg.providerConfig.openai!.apiKey).toBe("sk-test");
  });

  test("profile 字段默认 default", () => {
    const cfg = AppConfigSchema.parse({});
    expect(cfg.profile).toBe("default");
  });

  test("permissions 规则支持 description 字段", () => {
    const cfg = AppConfigSchema.parse({
      permissions: [{ action: "allow", description: "文件读取默认允许", pattern: "**", permission: "fs.read" }],
    });
    expect(cfg.permissions[0]!.description).toBe("文件读取默认允许");
  });

  test("agents 配置拒绝旧内置 agent 名称", () => {
    const result = AppConfigSchema.safeParse({
      agents: [{ mode: "subagent", name: "coder", permission: [] }],
    });

    expect(result.success).toBe(false);
  });
});

// ─── config() 默认配置(真实文件)──────────────────────────

describe("config() 默认配置加载", () => {
  let tmpDir: string;
  let origXdgConfig: string | undefined;
  let origCwd: string;

  beforeEach(() => {
    origXdgConfig = process.env.XDG_CONFIG_HOME;
    origCwd = process.cwd();
    tmpDir = createGlobalTmpTestDir("crab-cfg-");
    const configDir = path.join(tmpDir, "crab");
    fs.mkdirSync(configDir, { recursive: true });
    // 无 config.json → readJsonFile 返回 null → 使用默认配置
    process.env.XDG_CONFIG_HOME = tmpDir;
    // Chdir 避免项目级 .crab/config.json 被加载
    process.chdir(path.parse(tmpDir).root);
  });

  afterEach(async () => {
    process.chdir(origCwd);
    if (origXdgConfig !== undefined) {
      process.env.XDG_CONFIG_HOME = origXdgConfig;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }

    const { resetConfigCache } = await import("@/config/loader/config");
    resetConfigCache();
    cleanupTestDir(tmpDir);
  });

  test("config() 返回默认配置(无配置文件时)", async () => {
    const { config, resetConfigCache } = await import("@/config/loader/config");
    resetConfigCache();
    const cfg = await config();
    expect(cfg.profile).toBe("default");
    expect(cfg.defaultProvider.provider).toBeTruthy();
    expect(cfg.defaultProvider.model).toBe("");
  });
});

describe("配置路径", () => {
  test("getGlobalConfigPath 返回有效路径", async () => {
    const { getGlobalConfigPath } = await import("@/config/paths/paths");
    const configPath = getGlobalConfigPath();
    expect(configPath).toContain("crab");
    expect(configPath.endsWith("/config.json") || configPath.endsWith(String.raw`\config.json`)).toBe(true);
  });

  test("getDataDir 返回有效路径", async () => {
    const { getDataDir } = await import("@/config/paths/paths");
    const dir = getDataDir();
    expect(dir).toContain("crab");
  });
});
