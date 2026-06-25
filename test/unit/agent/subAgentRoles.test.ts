/**
 * G-09 子代理角色补全测试。
 *
 * 测试用例:
 *   - L3-T01: 内置子代理至少包含 explore/plan/general
 *   - L3-T02: 每个内置子代理有 id 和 name 字段
 */
import { beforeAll, describe, expect, it } from "bun:test";
import { type SubAgent, getSubAgents } from "@/config";

describe("G-09 子代理角色补全", () => {
  let builtinAgents: SubAgent[];

  beforeAll(async () => {
    builtinAgents = await getSubAgents();
  });

  it("L3-T01: 内置子代理至少包含 explore/plan/general", () => {
    const ids = builtinAgents.map((a) => a.id);
    expect(ids).toContain("explore");
    expect(ids).toContain("plan");
    expect(ids).toContain("general");
    expect(builtinAgents.length).toBeGreaterThanOrEqual(4);
  });

  it("L3-T02: 每个内置子代理有 id 和 name 字段", () => {
    for (const agent of builtinAgents) {
      expect(agent.id).toBeDefined();
      expect(agent.name).toBeDefined();
    }
  });
});
