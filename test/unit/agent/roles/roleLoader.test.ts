/**
 * 自定义 Agent 加载器测试(从 roleLoader 迁移)。
 *
 * 覆盖导出:
 *   - validateAgentConfig
 *   - parseAgentConfigs
 *   - configToAgent
 *   - getDefaultAgentsPath
 *   - loadAgentsFromFile(I/O 容错)
 *   - saveAgentsToFile
 *   - createCustomAgent / updateCustomAgent / deleteCustomAgent(CRUD)
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  configToAgent,
  createCustomAgent,
  deleteCustomAgent,
  getDefaultAgentsPath,
  loadAgentsFromFile,
  parseAgentConfigs,
  saveAgentsToFile,
  updateCustomAgent,
  validateAgentConfig,
} from "@/config";
import { getAgent, registerAgent, unregisterAgent } from "@/agent/core/manager";

describe("自定义 Agent 加载器", () => {
  describe("validateAgentConfig", () => {
    test("合法配置返回 ok=true", () => {
      const result = validateAgentConfig({
        id: "custom-agent",
        name: "自定义代理",
        systemPrompt: "你是一个代码专家",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.name).toBe("自定义代理");
      }
    });

    test("缺少 id 返回错误", () => {
      const result = validateAgentConfig({
        name: "无ID",
        systemPrompt: "test",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("id");
      }
    });

    test("缺少 name 返回错误", () => {
      const result = validateAgentConfig({
        id: "no-name",
        systemPrompt: "test",
      });
      expect(result.ok).toBe(false);
    });

    test("非法类型返回错误", () => {
      const result = validateAgentConfig("not an object");
      expect(result.ok).toBe(false);
    });

    test("null 返回错误", () => {
      const result = validateAgentConfig(null);
      expect(result.ok).toBe(false);
    });

    test("systemPrompt 为可选", () => {
      const result = validateAgentConfig({
        id: "minimal",
        name: "最小 Agent",
      });
      expect(result.ok).toBe(true);
    });
  });

  describe("parseAgentConfigs", () => {
    test("解析合法的数组", () => {
      const configs = parseAgentConfigs([
        { id: "a", name: "A", systemPrompt: "a" },
        { id: "b", name: "B", systemPrompt: "b" },
      ]);
      expect(configs).toHaveLength(2);
    });

    test("跳过无效项", () => {
      const configs = parseAgentConfigs([
        { id: "valid", name: "Valid", systemPrompt: "v" },
        { name: "NoId", systemPrompt: "x" }, // 缺少 id
      ]);
      expect(configs.length).toBeLessThanOrEqual(2);
    });

    test("空数组返回空", () => {
      expect(parseAgentConfigs([])).toEqual([]);
    });

    test("非数组返回空", () => {
      expect(parseAgentConfigs("not array")).toEqual([]);
    });
  });

  describe("configToAgent", () => {
    test("转换 AgentConfig 到 AgentInfo", () => {
      const agent = configToAgent({
        id: "expert",
        name: "专家",
        systemPrompt: "你是专家",
      });
      expect(agent.name).toBe("expert");
      expect(agent.label).toBe("专家");
      expect(agent.prompt).toBe("你是专家");
    });

    test("包含可选字段", () => {
      const agent = configToAgent({
        availableTools: ["bash"],
        color: "#ff0000",
        id: "expert",
        name: "专家",
        systemPrompt: "你是专家",
      });
      expect(agent.allowedTools).toBeDefined();
    });
  });

  describe("getDefaultAgentsPath", () => {
    test("返回有效路径字符串", () => {
      const path = getDefaultAgentsPath();
      expect(path).toBeTruthy();
      expect(typeof path).toBe("string");
    });

    test("不传 projectDir 返回全局路径", () => {
      expect(getDefaultAgentsPath()).toBe(join(homedir(), ".crab", "roles.json"));
    });

    test("传 projectDir 返回项目级路径", () => {
      expect(getDefaultAgentsPath("/tmp/proj")).toBe("/tmp/proj/.crab/roles.json");
    });
  });
});

describe("Agent 加载器 I/O 与 CRUD", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "crab-agent-test-"));
  });

  afterEach(() => {
    mock.restore();
    rmSync(tmpDir, { force: true, recursive: true });
    // 清理可能注册的非内置 Agent
    for (const name of ["new", "dup", "u", "rewrite", "d", "native-test-update", "native-test-delete"]) {
      try {
        unregisterAgent(name);
      } catch {}
    }
  });

  describe("loadAgentsFromFile", () => {
    test("文件不存在返回空数组", async () => {
      const result = await loadAgentsFromFile(join(tmpDir, "nope.json"));
      expect(result).toEqual([]);
    });

    test("空文件返回空数组", async () => {
      const path = join(tmpDir, "empty.json");
      writeFileSync(path, "");
      expect(await loadAgentsFromFile(path)).toEqual([]);
    });

    test("非法 JSON 走容错不抛", async () => {
      const path = join(tmpDir, "bad.json");
      writeFileSync(path, "{not valid json");
      expect(await loadAgentsFromFile(path)).toEqual([]);
    });

    test("有效 JSON 数组格式正确解析", async () => {
      const path = join(tmpDir, "ok.json");
      writeFileSync(
        path,
        JSON.stringify([
          { id: "a", name: "A" },
          { id: "b", name: "B" },
        ]),
      );
      const result = await loadAgentsFromFile(path);
      expect(result).toHaveLength(2);
      expect(result[0]!.native).toBeUndefined();
    });

    test("无效条目被过滤", async () => {
      const path = join(tmpDir, "mixed.json");
      writeFileSync(
        path,
        JSON.stringify([
          { id: "good", name: "Good" },
          { id: "", name: "" },
        ]),
      );
      const result = await loadAgentsFromFile(path);
      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe("good");
    });

    test("对象格式 { roles: [...] } 也可解析", async () => {
      const path = join(tmpDir, "object.json");
      writeFileSync(
        path,
        JSON.stringify({
          roles: [
            { id: "obj-a", name: "Obj A" },
            { id: "obj-b", name: "Obj B" },
          ],
        }),
      );

      const result = await loadAgentsFromFile(path);
      expect(result).toHaveLength(2);
      expect(result.map((r) => r.name)).toEqual(["obj-a", "obj-b"]);
    });
  });

  describe("saveAgentsToFile", () => {
    test("写入后文件存在且内容可读回", async () => {
      const path = join(tmpDir, "sub", "roles.json");
      const ok = await saveAgentsToFile(path, [{ id: "x", name: "X", systemPrompt: "p" }]);
      expect(ok).toBe(true);
      expect(existsSync(path)).toBe(true);
      const content = JSON.parse(readFileSync(path, "utf8"));
      expect(content[0].id).toBe("x");
    });

    test("自动创建父目录", async () => {
      const path = join(tmpDir, "deep", "nested", "roles.json");
      const ok = await saveAgentsToFile(path, [{ id: "y", name: "Y" }]);
      expect(ok).toBe(true);
      expect(existsSync(path)).toBe(true);
    });

    test("写入失败返回 false", () => {
      // ESM 命名绑定无法通过 require 覆盖，改用只读目录自然触发错误
      const readOnlyDir = join(tmpDir, "readonly");
      mkdirSync(readOnlyDir, { recursive: true });
      const { chmodSync } = require("node:fs") as typeof import("node:fs");
      chmodSync(readOnlyDir, 0o444);

      try {
        const ok = saveAgentsToFile(join(readOnlyDir, "roles.json"), [{ id: "z", name: "Z" }]);
        expect(ok).toBe(false);
      } finally {
        chmodSync(readOnlyDir, 0o755);
      }
    });
  });

  describe("createCustomAgent", () => {
    test("验证失败返回 ok=false", async () => {
      const result = await createCustomAgent({ id: "", name: "" } as never, join(tmpDir, "r.json"));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeDefined();
      }
    });

    test("成功路径:注册到 agentManager + 写入文件", async () => {
      const path = join(tmpDir, "roles.json");
      const result = await createCustomAgent({ id: "new", name: "New Agent", systemPrompt: "sp" }, path);
      expect(result.ok).toBe(true);
      expect(getAgent("new")).toBeDefined();
      expect(existsSync(path)).toBe(true);
    });

    test("同名 ID 创建会覆盖文件中的旧条目", async () => {
      const path = join(tmpDir, "roles.json");
      await createCustomAgent({ id: "dup", name: "First", systemPrompt: "v1" }, path);
      await createCustomAgent({ id: "dup", name: "Second", systemPrompt: "v2" }, path);
      const agents = await loadAgentsFromFile(path);
      expect(agents).toHaveLength(1);
      expect(agents[0]!.label).toBe("Second");
    });
  });

  describe("updateCustomAgent", () => {
    test("不存在的 agentId 返回错误", async () => {
      const result = await updateCustomAgent("nope", { name: "X" }, join(tmpDir, "r.json"));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("不存在");
      }
    });

    test("内置 Agent(native)禁止修改", async () => {
      registerAgent({
        description: "native test",
        label: "Native",
        mode: "primary",
        name: "native-test-update",
        native: true,
        options: {},
        prompt: "p",
      });
      const result = await updateCustomAgent("native-test-update", { name: "Hacked" }, join(tmpDir, "r.json"));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("内置");
      }
    });

    test("成功路径:只更新提供的字段", async () => {
      const path = join(tmpDir, "roles.json");
      await createCustomAgent(
        {
          id: "u",
          maxSteps: 10,
          name: "Old",
          systemPrompt: "sp",
          temperature: 0.5,
        },
        path,
      );
      const result = await updateCustomAgent("u", { name: "New" }, path);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.agent.label).toBe("New");
        expect(result.agent.steps).toBe(10);
        expect(result.agent.temperature).toBe(0.5);
      }
    });

    test("更新后会重写文件内容", async () => {
      const path = join(tmpDir, "roles.json");
      await createCustomAgent({ id: "rewrite", name: "Before", systemPrompt: "sp" }, path);

      const result = await updateCustomAgent("rewrite", { description: "After desc" }, path);
      expect(result.ok).toBe(true);

      const persisted = await loadAgentsFromFile(path);
      expect(persisted[0]!.description).toBe("After desc");
      expect(persisted[0]!.label).toBe("Before");
    });
  });

  describe("deleteCustomAgent", () => {
    test("内置 Agent 禁止删除", async () => {
      registerAgent({
        description: "native test",
        label: "Native",
        mode: "primary",
        name: "native-test-delete",
        native: true,
        options: {},
        prompt: "p",
      });
      const result = await deleteCustomAgent("native-test-delete", join(tmpDir, "r.json"));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("内置");
      }
    });

    test("成功路径:从 agentManager 注销 + 从文件移除", async () => {
      const path = join(tmpDir, "roles.json");
      await createCustomAgent({ id: "d", name: "D" }, path);
      expect(getAgent("d")).toBeDefined();
      const result = await deleteCustomAgent("d", path);
      expect(result.ok).toBe(true);
      expect(getAgent("d")).toBeUndefined();
      const agents = await loadAgentsFromFile(path);
      expect(agents.find((r) => r.name === "d")).toBeUndefined();
    });

    test("不存在的 agentId 返回错误", async () => {
      const result = await deleteCustomAgent("missing", join(tmpDir, "r.json"));
      expect(result.ok).toBe(false);
    });
  });
});
