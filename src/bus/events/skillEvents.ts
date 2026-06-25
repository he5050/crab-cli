/**
 * Skill 事件 — Skill 执行完成 + 选择/创建/列表面板显示。
 *
 * 职责:定义 Skill 域的事件契约。
 */
import { defineEvent } from "../core";

export const SkillEvents = {
  /** Skill 执行完成 */
  SkillExecuted: defineEvent<{
    skillName: string;
    ok: boolean;
    promptLength: number;
  }>("skill.executed"),

  /** 显示 Skill 选择面板 */
  SkillPickerShow: defineEvent<Record<string, never>>("skill.picker.show"),

  /** 显示 Skill 创建面板 */
  SkillCreationShow: defineEvent<Record<string, never>>("skill.creation.show"),

  /** 显示 Skill 列表面板 */
  SkillListShow: defineEvent<Record<string, never>>("skill.list.show"),

  /** 显示 Profile 面板 */
  ProfilePanelShow: defineEvent<Record<string, never>>("profile.panel.show"),
} as const;
