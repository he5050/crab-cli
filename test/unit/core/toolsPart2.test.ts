/**
 * 工具集第二部分测试。
 *
 * 测试用例:
 *   - 工具集成
 *   - 批量操作
 *   - 性能测试
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { subagentTool } from "@/tool/subagent";
import { teamTool } from "@/tool/team";
import { skillsTool } from "@/tool/skills";
import { ideDiagnosticsTool } from "@/tool/ideDiagnostics";
import { codebaseSearchTool } from "@/tool/codebaseSearch";
import { teamExecutor } from "@/agent/team";
import { buildInvalidProviderConfig } from "../../helpers/realConfig";
import { __resetSubAgentResolverDepsForTesting, __setSubAgentResolverDepsForTesting } from "@/agent/subagent/resolver";
import { resetToolFacingDeps, setToolSubAgentResolver, type SubAgentResolver } from "@/agent/contracts/toolFacing";

/** 测试用 mock resolver: 按关键词路由子代理类型 */
function createMockSubAgentResolver(): SubAgentResolver {
  return {
    async resolve(request: string) {
      if (/审查|review|reviewer/i.test(request)) {
        return { agentName: "review", reason: "关键词匹配: 审查", resolved: true };
      }
      if (/测试|test|qa/i.test(request)) {
        return { agentName: "qa", reason: "关键词匹配: 测试", resolved: true };
      }
      return { agentName: "general", reason: "默认路由", resolved: true };
    },
  };
}

// ─── subagent ────────────────────────────────────────────────────

describe("子代理", () => {
  beforeEach(() => {
    __setSubAgentResolverDepsForTesting({
      completeLlm: async () => ({ text: "" }),
      loadConfig: async () => undefined as any,
    });
    setToolSubAgentResolver(createMockSubAgentResolver());
  });

  afterEach(() => {
    __resetSubAgentResolverDepsForTesting();
    resetToolFacingDeps();
  });

  test("创建子代理", async () => {
    const result = (await subagentTool.execute({
      action: "spawn",
      allowedTools: ["filesystem-read", "grep"],
      name: "代码审查员",
      prompt: "审查 src/ 目录下的所有代码",
    })) as any;

    expect(result.success).toBe(true);
    expect(result.agentId).toMatch(/^sub_/);
    expect(result.action).toBe("spawn");
    expect(result.name).toBe("代码审查员");
    expect(result.agentName).toBe("review");
  });

  test("动态路由只决定执行 agent，不能覆盖用户提供的追踪名称", async () => {
    let captured: any;
    const result = (await subagentTool.execute(
      {
        action: "spawn",
        name: "test-child",
        prompt: "执行测试任务",
      },
      {
        messageId: "msg-test",
        sessionId: "session-test",
        spawnSubagent: (params) => {
          captured = params;
        },
      },
    )) as any;

    expect(result.success).toBe(true);
    expect(result.agentId).toMatch(/^sub_/);
    expect(captured.agentId).toBe(result.agentId);
    expect(captured.agentName).toBe("qa");
    expect(captured.name).toBe("test-child");
    expect(result.agentName).toBe("qa");
    expect(result.name).toBe("test-child");
  });

  test("显式 agentName 优先于动态路由，同时保留用户追踪名称", async () => {
    let captured: any;
    const result = (await subagentTool.execute(
      {
        action: "spawn",
        agentName: "review",
        name: "测试跟进代理",
        prompt: "执行测试任务并输出风险",
      },
      {
        messageId: "msg-explicit",
        sessionId: "session-explicit",
        spawnSubagent: (params) => {
          captured = params;
        },
      },
    )) as any;

    expect(result.success).toBe(true);
    expect(captured.agentName).toBe("review");
    expect(captured.name).toBe("测试跟进代理");
    expect(result.agentName).toBe("review");
    expect(result.name).toBe("测试跟进代理");
  });

  test("只有 prompt 时使用执行 agent 作为可审计名称", async () => {
    let captured: any;
    const result = (await subagentTool.execute(
      {
        action: "spawn",
        prompt: "执行测试任务",
      },
      {
        messageId: "msg-prompt-only",
        sessionId: "session-prompt-only",
        spawnSubagent: (params) => {
          captured = params;
        },
      },
    )) as any;

    expect(result.success).toBe(true);
    expect(captured.agentName).toBe("qa");
    expect(captured.name).toBe("qa");
    expect(result.agentName).toBe("qa");
    expect(result.name).toBe("qa");
  });

  test("创建子代理缺少参数返回错误", async () => {
    const result = (await subagentTool.execute({ action: "spawn" })) as any;
    expect(result.success).toBe(false);
  });

  test("列出子代理", async () => {
    const result = (await subagentTool.execute({ action: "list" })) as any;
    expect(result.success).toBe(true);
    expect(Array.isArray(result.agents)).toBe(true);
  });

  test("查询不存在的子代理", async () => {
    const result = (await subagentTool.execute({
      action: "status",
      agentId: "sub_nonexistent",
    })) as any;
    expect(result.success).toBe(false);
  });
});

// ─── team ────────────────────────────────────────────────────────

describe("团队", () => {
  beforeEach(async () => {
    teamExecutor.getTracker().clear();
    teamExecutor.getTaskList().clear();
    teamExecutor.setAppConfig(
      await buildInvalidProviderConfig({
        model: "team-tools-model",
        providerId: "team-tools-test",
        requestMethod: "chat",
        unset: ["apiKey", "baseURL"],
      }),
    );
  });

  test("创建队友", async () => {
    const result = (await teamTool.execute({
      action: "spawn",
      name: "测试专家",
      role: "负责编写和维护测试",
    })) as any;

    expect(result.success).toBe(true);
    expect(result.teammateId).toMatch(/^mate_/);
  });

  test("创建队友缺少 name 返回错误", async () => {
    const result = (await teamTool.execute({ action: "spawn" })) as any;
    expect(result.success).toBe(false);
  });

  test("发送消息", async () => {
    const spawn = (await teamTool.execute({ action: "spawn", name: "test" })) as any;
    const result = (await teamTool.execute({
      action: "message",
      message: "请检查这个文件",
      teammateId: spawn.teammateId,
    })) as any;

    // TeamExecutor 已接入，消息成功投递
    expect(result.success).toBe(true);
    expect(result.action).toBe("message");
    expect(result.delivered).toBe(true);
  });

  test("更新任务", async () => {
    const spawn = (await teamTool.execute({ action: "spawn", name: "dev" })) as any;
    const result = (await teamTool.execute({
      action: "update_task",
      task: "完成认证模块",
      taskStatus: "in_progress",
      teammateId: spawn.teammateId,
    })) as any;

    expect(result.success).toBe(true);
  });

  test("列出队友", async () => {
    const result = (await teamTool.execute({ action: "list" })) as any;
    expect(result.success).toBe(true);
  });
});

// ─── skills ──────────────────────────────────────────────────────

describe("技能", () => {
  test("列出可用技能", async () => {
    const result = (await skillsTool.execute({ action: "list" })) as any;
    expect(result.success).toBe(true);
    expect(result.total).toBeGreaterThanOrEqual(7); // 内置 7 个
    expect(result.skills.some((s: any) => s.name === "review-code")).toBe(true);
  });

  test("查看技能详情", async () => {
    const result = (await skillsTool.execute({ action: "info", skillName: "explain-code" })) as any;
    expect(result.success).toBe(true);
    expect(result.skill.description).toBeDefined();
    expect(result.skill.prompt).toBeDefined();
  });

  test("执行技能", async () => {
    const result = (await skillsTool.execute({
      action: "execute",
      input: "function add(a, b) { return a + b; }",
      skillName: "explain-code",
    })) as any;

    expect(result.success).toBe(true);
    expect(result.prompt).toContain("function add");
  });

  test("执行不存在的技能返回错误", async () => {
    const result = (await skillsTool.execute({ action: "execute", skillName: "nonexistent" })) as any;
    expect(result.success).toBe(false);
  });
});

// ─── ide-diagnostics ─────────────────────────────────────────────

describe("ide-diagnostics", () => {
  test("工具结构完整", () => {
    expect(ideDiagnosticsTool.name).toBe("ide-diagnostics");
    expect(ideDiagnosticsTool.permission).toBe("fs.read");
    expect(typeof ideDiagnosticsTool.execute).toBe("function");
  });

  test("参数 Schema 验证", () => {
    const schema = ideDiagnosticsTool.parameters;
    expect(schema.safeParse({ path: "/tmp" }).success).toBe(true);
    expect(schema.safeParse({ type: "errors" }).success).toBe(true);
    expect(schema.safeParse({ maxResults: 10, path: "/tmp", type: "all" }).success).toBe(true);
  });

  test("检查不存在的目录返回空结果", async () => {
    const result = (await ideDiagnosticsTool.execute({
      path: "/nonexistent_dir_12345",
    })) as any;

    expect(result.success).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });
});

// ─── codebase-search ─────────────────────────────────────────────

describe("codebase-search", () => {
  test("工具结构完整", () => {
    expect(codebaseSearchTool.name).toBe("codebase-search");
    expect(codebaseSearchTool.permission).toBe("fs.read");
    expect(typeof codebaseSearchTool.execute).toBe("function");
  });

  test("参数 Schema 验证", () => {
    const schema = codebaseSearchTool.parameters;
    expect(schema.safeParse({ query: "hello" }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ include: "*.ts", mode: "symbols", query: "test" }).success).toBe(true);
  });

  test("文本搜索返回结果", async () => {
    const result = (await codebaseSearchTool.execute({
      include: "*.ts",
      maxResults: 5,
      mode: "text",
      query: "defineTool",
    })) as any;

    expect(result.success !== false).toBe(true);
    // 至少应该能搜到 defineTool 的定义
    if (result.total > 0) {
      expect(result.results[0].file).toMatch(/\.ts$/);
    }
  });
});
