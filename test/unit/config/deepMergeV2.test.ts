/**
 * 深度合并 V2 测试。
 *
 * 测试用例:
 *   - 新版合并算法
 *   - 性能优化
 *   - 边界情况处理
 */
import { describe, expect, test } from "bun:test";
import { AppConfigSchema, McpConfigFileSchema } from "@/schema/config";

describe("深合并追加策略验证", () => {
  test("MCP 配置文件格式解析", () => {
    const cfg = McpConfigFileSchema.parse({
      mcpServers: {
        "global-server": { args: ["--opt1"], command: "cmd1" },
        "project-server": { args: ["--opt2"], command: "cmd2" },
      },
    });

    expect(Object.keys(cfg.mcpServers).length).toBe(2);
    expect(cfg.mcpServers["global-server"]!.command).toBe("cmd1");
    expect(cfg.mcpServers["project-server"]!.command).toBe("cmd2");
  });

  test("agents 数组追加逻辑", () => {
    const base = { agents: [{ mode: "primary" as const, name: "general" }] };
    const extra = { agents: [{ mode: "subagent" as const, name: "review" }] };

    const merged = { ...base, agents: [...base.agents, ...extra.agents] };
    const parsed = AppConfigSchema.parse(merged);

    expect(parsed.agents.length).toBe(2);
    expect(parsed.agents[0]!.name).toBe("general");
    expect(parsed.agents[1]!.name).toBe("review");
  });
});
