/**
 * 子代理内置协作工具测试。
 *
 * 覆盖导出:
 *   - getBuiltinAgentToolSchemas
 *   - injectBuiltinToolNames
 *   - buildPeerAgentsContext
 *   - buildSubAgentInitialMessages
 *   - BUILTIN_AGENT_TOOL_NAMES
 *   - BUILTIN_TOOL_PREFIXES
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  BUILTIN_AGENT_TOOL_NAMES,
  BUILTIN_TOOL_PREFIXES,
  buildPeerAgentsContext,
  buildSubAgentInitialMessages,
  getBuiltinAgentToolSchemas,
  injectBuiltinToolNames,
} from "@/agent/subagent/builtinTools";
import { subAgentTracker } from "@/agent/subagent/tracker";

beforeEach(() => {
  subAgentTracker.clear();
});

describe("子代理内置协作工具", () => {
  // ─── 常量验证 ──────────────────────────────────────────

  describe("BUILTIN_AGENT_TOOL_NAMES", () => {
    test("包含 3 个内置工具名", () => {
      expect(BUILTIN_AGENT_TOOL_NAMES).toHaveLength(3);
      expect(BUILTIN_AGENT_TOOL_NAMES).toContain("send_message_to_agent");
      expect(BUILTIN_AGENT_TOOL_NAMES).toContain("query_agents_status");
      expect(BUILTIN_AGENT_TOOL_NAMES).toContain("spawn_sub_agent");
    });
  });

  describe("BUILTIN_TOOL_PREFIXES", () => {
    test("包含预期前缀", () => {
      expect(BUILTIN_TOOL_PREFIXES.has("todo-")).toBe(true);
      expect(BUILTIN_TOOL_PREFIXES.has("filesystem-")).toBe(true);
      expect(BUILTIN_TOOL_PREFIXES.has("terminal-")).toBe(true);
      expect(BUILTIN_TOOL_PREFIXES.has("websearch-")).toBe(true);
      expect(BUILTIN_TOOL_PREFIXES.has("subagent-")).toBe(true);
    });
  });

  // ─── getBuiltinAgentToolSchemas ────────────────────────

  describe("getBuiltinAgentToolSchemas", () => {
    test("depth < 3 时返回全部 3 个工具 schema", () => {
      const schemas = getBuiltinAgentToolSchemas(0);
      expect(Object.keys(schemas)).toHaveLength(3);
      expect(schemas["send_message_to_agent"]).toBeDefined();
      expect(schemas["query_agents_status"]).toBeDefined();
      expect(schemas["spawn_sub_agent"]).toBeDefined();
    });

    test("depth = 2 时返回全部 3 个工具 schema(depth < MAX_SPAWN_DEPTH=3)", () => {
      const schemas = getBuiltinAgentToolSchemas(2);
      expect(Object.keys(schemas)).toHaveLength(3);
    });

    test("depth >= 3 时不包含 spawn_sub_agent", () => {
      const schemas = getBuiltinAgentToolSchemas(3);
      expect(Object.keys(schemas)).toHaveLength(2);
      expect(schemas["send_message_to_agent"]).toBeDefined();
      expect(schemas["query_agents_status"]).toBeDefined();
      expect(schemas["spawn_sub_agent"]).toBeUndefined();
    });

    test("depth = 5 时也不包含 spawn", () => {
      const schemas = getBuiltinAgentToolSchemas(5);
      expect(schemas["spawn_sub_agent"]).toBeUndefined();
    });

    test("每个 schema 包含 description 和 inputSchema", () => {
      const schemas = getBuiltinAgentToolSchemas(0);
      for (const [name, schema] of Object.entries(schemas)) {
        expect(schema.description).toBeTruthy();
        expect(schema.inputSchema).toBeDefined();
      }
    });
  });

  // ─── injectBuiltinToolNames ────────────────────────────

  describe("injectBuiltinToolNames", () => {
    test("注入 send_message + query_agents + spawn_sub_agent(depth < 3)", () => {
      const result = injectBuiltinToolNames(["bash"], 0);
      expect(result).toContain("bash");
      expect(result).toContain("send_message_to_agent");
      expect(result).toContain("query_agents_status");
      expect(result).toContain("spawn_sub_agent");
    });

    test("depth >= 3 时不注入 spawn_sub_agent", () => {
      const result = injectBuiltinToolNames(["bash"], 3);
      expect(result).toContain("send_message_to_agent");
      expect(result).toContain("query_agents_status");
      expect(result).not.toContain("spawn_sub_agent");
    });

    test("allowedTools 为 undefined 时仍然注入", () => {
      const result = injectBuiltinToolNames(undefined, 0);
      expect(result).toContain("send_message_to_agent");
      expect(result).toContain("query_agents_status");
      expect(result).toContain("spawn_sub_agent");
    });

    test("不修改原始 allowedTools 数组", () => {
      const original = ["bash", "fs_read"];
      const result = injectBuiltinToolNames(original, 0);
      expect(original).toEqual(["bash", "fs_read"]);
      expect(result.length).toBeGreaterThan(original.length);
    });

    test("空 allowedTools 注入后只包含内置工具", () => {
      const result = injectBuiltinToolNames([], 0);
      expect(result).toHaveLength(5);
    });
  });

  // ─── buildPeerAgentsContext ────────────────────────────

  describe("buildPeerAgentsContext", () => {
    test("无 peer 时返回代理协作工具说明", () => {
      const ctx = buildPeerAgentsContext("inst-1", false);
      expect(ctx).toContain("代理协作工具");
      expect(ctx).toContain("query_agents_status");
      expect(ctx).toContain("send_message_to_agent");
    });

    test("canSpawn=true 时包含 spawn 相关说明", () => {
      const ctx = buildPeerAgentsContext("inst-1", true);
      expect(ctx).toContain("spawn_sub_agent");
      expect(ctx).toContain("启动规则");
    });

    test("canSpawn=false 时不包含 spawn 相关说明", () => {
      const ctx = buildPeerAgentsContext("inst-1", false);
      expect(ctx).not.toContain("spawn_sub_agent");
      expect(ctx).not.toContain("启动规则");
    });
  });

  // ─── buildSubAgentInitialMessages ──────────────────────

  describe("buildSubAgentInitialMessages", () => {
    test("prompt 后追加 peer context", () => {
      const result = buildSubAgentInitialMessages("general", "修复 bug #123", "inst-1", 0);
      expect(result).toContain("修复 bug #123");
      expect(result.length).toBeGreaterThan("修复 bug #123".length);
    });

    test("空 prompt 也返回 peer context", () => {
      const result = buildSubAgentInitialMessages("general", "", "inst-1", 0);
      expect(result.length).toBeGreaterThan(0);
    });

    test("高 spawn depth 时不含 spawn 工具提示", () => {
      const result = buildSubAgentInitialMessages("general", "task", "inst-1", 3);
      expect(result).not.toContain("spawn_sub_agent");
    });
  });
});
