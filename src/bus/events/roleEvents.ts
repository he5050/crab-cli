/**
 * 角色相关事件 — 角色切换变更、角色选择器显示。
 *
 * 职责:定义角色域的事件契约。
 */
import { defineEvent } from "../core";

export const RoleEvents = {
  /** 角色切换变更 */
  RoleChanged: defineEvent<{
    roleId: string | null;
    roleName: string | null;
    previousRoleId: string | null;
  }>("role.changed"),

  /** 显示角色选择器 */
  RolePickerShow: defineEvent<Record<string, never>>("role.picker.show"),
} as const;
