/**
 * G-14 Team System Prompt 增强测试。
 *
 * 测试用例:
 *   - L3-T12: getTeamModeSystemPrompt 是 consolidated stub，返回空字符串
 */
import { describe, expect, it } from "bun:test";
import { getTeamModeSystemPrompt } from "@/agent/prompt/teamModePrompt";

describe("G-14 Team System Prompt 增强", () => {
  it("L3-T12: getTeamModeSystemPrompt 返回空字符串(已 consolidated)", () => {
    const prompt = getTeamModeSystemPrompt();

    // 原始 prompt 内容已整合到其他模块，此处仅保留 barrel stub
    expect(prompt).toBe("");
  });

  it("L3-T12: Prompt 包含 Git 规则 — 已迁移", () => {
    const prompt = getTeamModeSystemPrompt();

    // 原始 Git 规则已整合到其他模块，stub 返回空字符串
    expect(prompt).toBe("");
  });

  it("L3-T12: Prompt 包含冲突解决流程 — 已迁移", () => {
    const prompt = getTeamModeSystemPrompt();

    // 原始冲突解决流程已整合到其他模块，stub 返回空字符串
    expect(prompt).toBe("");
  });

  it("L3-T12: Prompt 包含错误处理 — 已迁移", () => {
    const prompt = getTeamModeSystemPrompt();

    // 原始错误处理已整合到其他模块，stub 返回空字符串
    expect(prompt).toBe("");
  });
});
