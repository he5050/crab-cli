/**
 * 角色提示词注入 — 在系统提示词构建时注入角色内容。
 *
 * 职责:
 *   - 获取当前活跃角色的内容和 Override 状态
 *   - 支持项目级 > 全局级优先级
 *   - 将 Override 状态交给 prompt builder 调整基础身份段
 *
 * 两种模式:
 *   - Append(默认):角色内容追加到系统提示词末尾(通过 customAppend)
 *   - Override:角色内容替换 basePrompt，保留 mode、工具、环境和动态提示
 */

import { type RoleLocation, listRoles, readRoleContent } from "./roleManager";

/** 角色注入结果 */
export interface RoleInjectionResult {
  /** 角色内容(为 null 表示没有活跃角色) */
  content: string | null;
  /** 是否为 Override 模式 */
  isOverride: boolean;
}

/**
 * 获取当前活跃角色内容。
 *
 * 查找优先级:项目级 > 全局级。
 * 如果两层都没有角色文件，返回 null。
 *
 * @param projectRoot 项目根目录
 */
export function getActiveRoleContent(projectRoot?: string): RoleInjectionResult {
  let content: string | null = null;
  let isOverride = false;

  // 检查项目级
  const projectRoles = listRoles("project", projectRoot);
  const projectActive = projectRoles.find((r) => r.isActive);
  if (projectActive) {
    content = readRoleContent(projectActive.id, "project", projectRoot);
    if (projectActive.isOverride) {
      isOverride = true;
    }
  }

  // 项目级无内容或无角色，回退到全局
  if (!content) {
    const globalRoles = listRoles("global", projectRoot);
    const globalActive = globalRoles.find((r) => r.isActive);
    if (globalActive) {
      content = readRoleContent(globalActive.id, "global", projectRoot);
      if (globalActive.isOverride) {
        isOverride = true;
      }
    }
  }

  // 空内容视为无角色
  if (content !== null && content.trim() === "") {
    content = null;
    isOverride = false;
  }

  return { content, isOverride };
}

/**
 * 判断指定位置是否有活跃的 Override 角色。
 */
export function hasOverrideRole(location: RoleLocation, projectRoot?: string): boolean {
  const roles = listRoles(location, projectRoot);
  const active = roles.find((r) => r.isActive);
  return active?.isOverride ?? false;
}

/**
 * 判断当前是否有任何 Override 角色生效(项目级 > 全局级)。
 */
export function hasActiveOverrideRole(projectRoot?: string): boolean {
  const result = getActiveRoleContent(projectRoot);
  return result.isOverride;
}
