/**
 * Roles 模块 — Markdown 角色文件管理系统。
 *
 * 功能:
 *   - 角色文件的 CRUD(ROLE.md / ROLE-<hash>.md)
 *   - 全局/项目两种作用域
 *   - Override 模式(角色替换基础身份提示，保留运行时提示段)
 *   - 子代理角色绑定(ROLE-<agentName>.md)
 *   - 系统提示词注入
 */

// 角色文件管理
export {
  type RoleLocation,
  type RoleItem,
  getRoleFilePath,
  getRoleDirectory,
  checkRoleExists,
  createRoleFile,
  createInactiveRole,
  deleteRoleFile,
  deleteRole,
  readRoleContent,
  readActiveRoleContent,
  listRoles,
  listAllRoles,
  switchActiveRole,
  toggleRoleOverride,
  ensureDefaultRole,
} from "./roleManager";

// 子代理角色绑定
export { loadSubAgentCustomRole, listAvailableSubAgentRoles } from "./roleSubagent";

// 提示词注入
export { type RoleInjectionResult, getActiveRoleContent, hasOverrideRole, hasActiveOverrideRole } from "./roleInjector";
