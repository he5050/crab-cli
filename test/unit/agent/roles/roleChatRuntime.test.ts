/**
 * 角色 chat runtime 覆盖测试。
 *
 * 测试目标:
 *   - 验证 buildChatRuntimeOverrides 在 .crab/roles 下角色定义文件存在/缺失时的行为
 *
 * 测试用例:
 *   - 项目级角色文件被正确加载并覆盖
 *   - 角色定义文件缺失时回退到默认
 *   - override 模式下的角色合并
 */
import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentInfo } from "@/agent/core/manager";
import type { AppConfigSchema } from "@/schema/config";
import { buildChatRuntimeOverrides } from "@/ui/contexts/chatHelpers";

const originalCwd = process.cwd();
let tempProject: string | undefined;

function writeProjectRole(content: string, override = false) {
  tempProject = fs.mkdtempSync(path.join(os.tmpdir(), "crab-role-runtime-"));
  const crabDir = path.join(tempProject, ".crab");
  fs.mkdirSync(crabDir, { recursive: true });
  fs.writeFileSync(path.join(crabDir, "ROLE.md"), content, "utf8");
  fs.writeFileSync(
    path.join(crabDir, "settings.json"),
    JSON.stringify({ role: override ? { overrideRoleIds: ["active"] } : {} }),
    "utf8",
  );
  process.chdir(tempProject);
}

function createConfig(): AppConfigSchema {
  return {
    agents: [],
    autoformat: true,
    codebase: {
      documentTypes: ["pdf", "docx", "xlsx", "pptx"],
      embedding: {
        dimensions: 1536,
        model: "text-embedding-3-small",
        type: "openai",
      },
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
    profile: "test",
    promptCaching: { enabled: true },
    providerConfig: {
      openai: {
        apiKey: "sk-test",
        defaultModel: "gpt-4o",
        requestMethod: "chat",
      },
    },
    proxy: { browserDebugPort: 9222, enabled: false, port: 7890, searchEngine: "duckduckgo" },
    sensitiveCommands: { commands: [], enabled: true },
    telemetry: { enabled: false, exporterType: "none", sampleRate: 1, serviceName: "crab-cli" },
    theme: "dark",
    thinking: { enabled: false },
    toolResultTokenLimitPercent: 30,
  } as unknown as AppConfigSchema;
}

function createAgent(): AgentInfo {
  return {
    allowedTools: ["filesystem-read"],
    description: "Review agent",
    label: "Reviewer",
    mode: "primary",
    model: { modelID: "claude-sonnet-4", providerID: "anthropic" },
    name: "reviewer",
    options: {},
    prompt: "# Agent Base",
    steps: 7,
    temperature: 0.2,
    topP: 0.8,
  };
}

function createAgentWithoutSteps(): AgentInfo {
  const agent = createAgent();
  delete (agent as Partial<AgentInfo>).steps;
  return agent;
}

describe("role runtime injection", () => {
  afterEach(() => {
    process.chdir(originalCwd);
    if (tempProject) {
      fs.rmSync(tempProject, { force: true, recursive: true });
      tempProject = undefined;
    }
  });

  test("append role 添加 prompt 内容但不会改变 agent 执行属性", async () => {
    writeProjectRole("# Role Append", false);

    const overrides = buildChatRuntimeOverrides(createConfig(), createAgent(), "chat", false);

    expect(overrides.systemPrompt).toContain("# Agent Base");
    expect(overrides.systemPrompt).toContain("# Role Append");
    expect(overrides.allowedTools).toEqual(["filesystem-read"]);
    expect(overrides.maxToolRounds).toBe(7);
    expect(overrides.providerId).toBe("anthropic");
    expect(overrides.modelId).toBe("claude-sonnet-4");
    expect(overrides.temperature).toBe(0.2);
    expect(overrides.topP).toBe(0.8);
  });

  test("override role replaces only base prompt and keeps mode/tool/environment sections", async () => {
    writeProjectRole("# Override Role", true);

    const overrides = buildChatRuntimeOverrides(createConfig(), createAgent(), "plan", false);

    expect(overrides.systemPrompt).toContain("# Override Role");
    expect(overrides.systemPrompt).not.toContain("# Agent Base");
    expect(overrides.systemPrompt).toContain("Plan 模式");
    expect(overrides.systemPrompt).toContain("工具使用");
    expect(overrides.systemPrompt).toContain("cwd");
    expect(overrides.allowedTools).toEqual(["filesystem-read"]);
    expect(overrides.maxToolRounds).toBe(7);
    expect(overrides.providerId).toBe("anthropic");
    expect(overrides.modelId).toBe("claude-sonnet-4");
  });

  test("agent 未配置 steps 时使用全局 maxToolRounds", async () => {
    writeProjectRole("# Role Append", false);
    const config = { ...createConfig(), maxToolRounds: 42 };

    const overrides = buildChatRuntimeOverrides(config, createAgentWithoutSteps(), "chat", false);

    expect(overrides.maxToolRounds).toBe(42);
  });
});
