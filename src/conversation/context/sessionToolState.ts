/**
 * 会话工具状态 — 管理 Skill、外部工具、白名单等会话级工具状态。
 *
 * 从 ConversationHandler 提取的独立职责:
 *   - 持有 Skill/外部工具的会话状态数组
 *   - 提供 enable/get 便捷方法(委托 conversationSessionState 纯函数)
 *   - 支持序列化/恢复(persistence)
 *
 * 设计原则:
 *   1. 所有 enable 方法委托给 conversationSessionState 的纯函数
 *   2. 本类仅持有可变状态和便捷入口
 *   3. 与 ConversationHandler 通过单一字段组合
 *
 * 边界:
 *   1. 不管理对话历史(messages)
 *   2. 不感知 LLM 循环状态
 *   3. 不直接触发事件
 */
import { type ChatMode } from "@/agent/prompt/modes";
import type { LlmToolSchema } from "@/conversation/type";
import type { ExternalToolResolution } from "@/tool/registry/externalToolResolver";
import {
  type ConversationSessionState,
  enableExternalToolForSession,
  enableExplicitExternalToolsFromText,
  enableExternalToolsFromDiscoveryResult,
  enableSkillForSession,
  enableSkillsFromToolResult,
  getAllowedToolsForExecution,
  buildSessionDynamicReminder,
  getToolsForLlm as buildToolsForLlmFn,
} from "./conversationSessionState";

/** 可持久化的工具状态快照 */
export interface ToolSessionSnapshot {
  sessionAllowedExternalTools: string[];
  sessionDiscoveredSkills: string[];
  sessionActiveSkills: string[];
  sessionLoadedSkills: string[];
}

/**
 * 会话工具状态 — 管理 Skill/外部工具的白名单和发现状态。
 *
 * 使用方式:
 *   handler.toolSession.enableExternalToolForSession("myTool");
 *   handler.toolSession.enableSkillForSession("mySkill");
 *   handler.toolSession.getAllowedToolsForExecution();
 */
export class SessionToolState {
  private allowedTools?: string[];
  private mode?: ChatMode;
  sessionAllowedExternalTools: string[] = [];
  sessionDiscoveredSkills: string[] = [];
  sessionActiveSkills: string[] = [];
  sessionLoadedSkills: string[] = [];
  private originalAllowedTools?: string[];
  activeSkillContext?: string;

  /**
   * 生成纯函数所需的只读状态快照。
   *
   * 注意: 返回的数组字段（如 sessionAllowedExternalTools）为内部引用而非副本，
   * 这是有意设计 — 纯函数通过此引用直接修改内部状态（push）。
   * 调用方不应缓存此对象或将其传递给外部模块。
   */
  getEffectiveState(): ConversationSessionState {
    return {
      allowedTools: this.allowedTools,
      mode: this.mode,
      sessionActiveSkills: this.sessionActiveSkills,
      sessionAllowedExternalTools: this.sessionAllowedExternalTools,
      sessionDiscoveredSkills: this.sessionDiscoveredSkills,
      sessionLoadedSkills: this.sessionLoadedSkills,
    };
  }

  // ─── 外部工具 ────────────────────────────────────────────

  enableExternalToolForSession(query: string): ExternalToolResolution {
    return enableExternalToolForSession(this.getEffectiveState(), query);
  }

  enableExplicitExternalToolsFromText(input: string): string[] {
    return enableExplicitExternalToolsFromText(this.getEffectiveState(), input);
  }

  enableExternalToolsFromDiscoveryResult(output: unknown): string[] {
    return enableExternalToolsFromDiscoveryResult(this.getEffectiveState(), output);
  }

  // ─── Skill 管理 ─────────────────────────────────────────────

  enableSkillForSession(skillName: string): boolean {
    return enableSkillForSession(this.getEffectiveState(), skillName);
  }

  enableSkillsFromToolResult(
    toolName: string,
    output: unknown,
  ): { active: string[]; discovered: string[]; loaded: string[] } {
    return enableSkillsFromToolResult(this.getEffectiveState(), toolName, output);
  }

  // ─── Skill 上下文（活跃 Skill 的系统提示词注入）───────────

  /** 设置活跃的 Skill 上下文(注入到系统提示词 + 可选工具白名单) */
  setActiveSkillContext(skillPrompt: string, skillTools?: string[]): void {
    this.activeSkillContext = skillPrompt;
    if (skillTools && skillTools.length > 0) {
      this.originalAllowedTools = this.allowedTools;
      if (this.allowedTools) {
        this.allowedTools = skillTools.filter((t) => this.allowedTools!.includes(t));
      } else {
        this.allowedTools = skillTools;
      }
    }
  }

  clearActiveSkillContext(): void {
    this.activeSkillContext = undefined;
    if (this.originalAllowedTools !== undefined) {
      this.allowedTools = this.originalAllowedTools;
      this.originalAllowedTools = undefined;
    }
  }

  // ─── 工具查询 ──────────────────────────────────────────────

  getAllowedToolsForExecution(): string[] | undefined {
    return getAllowedToolsForExecution(this.getEffectiveState());
  }

  getToolsForLlm(
    additionalToolSchemas?: Record<string, { description: string; inputSchema: unknown }>,
  ): Record<string, LlmToolSchema> | undefined {
    return buildToolsForLlmFn(this.getEffectiveState(), additionalToolSchemas);
  }

  /** 构建动态提醒文本(供系统提示词使用) */
  buildDynamicReminder(): string | undefined {
    return buildSessionDynamicReminder({
      sessionActiveSkills: this.sessionActiveSkills,
      sessionAllowedExternalTools: this.sessionAllowedExternalTools,
      sessionDiscoveredSkills: this.sessionDiscoveredSkills,
      sessionLoadedSkills: this.sessionLoadedSkills,
    });
  }

  // ─── 持久化 ──────────────────────────────────────────────

  /** 导出可持久化的状态快照 */
  toSnapshot(): ToolSessionSnapshot {
    return {
      sessionActiveSkills: [...this.sessionActiveSkills],
      sessionAllowedExternalTools: [...this.sessionAllowedExternalTools],
      sessionDiscoveredSkills: [...this.sessionDiscoveredSkills],
      sessionLoadedSkills: [...this.sessionLoadedSkills],
    };
  }

  /** 从持久化快照恢复状态(不清空，追加到当前状态) */
  restoreFrom(snapshot: ToolSessionSnapshot): void {
    if (snapshot.sessionDiscoveredSkills) {
      this.sessionDiscoveredSkills.push(...snapshot.sessionDiscoveredSkills);
    }
    if (snapshot.sessionActiveSkills) {
      this.sessionActiveSkills.push(...snapshot.sessionActiveSkills);
    }
    if (snapshot.sessionLoadedSkills) {
      this.sessionLoadedSkills.push(...snapshot.sessionLoadedSkills);
    }
    if (snapshot.sessionAllowedExternalTools) {
      this.sessionAllowedExternalTools.push(...snapshot.sessionAllowedExternalTools);
    }
  }

  /** 设置模式(影响工具白名单过滤) */
  setMode(mode?: ChatMode): void {
    this.mode = mode;
  }

  /** 设置基础白名单 */
  setAllowedTools(allowedTools?: string[]): void {
    this.allowedTools = allowedTools;
  }

  // ─── 只读访问器 ────────────────────────────────────────────

  /** 获取当前模式 */
  getMode(): ChatMode | undefined {
    return this.mode;
  }

  /** 获取基础白名单(不含外部工具) */
  getAllowedTools(): string[] | undefined {
    return this.allowedTools;
  }
}
