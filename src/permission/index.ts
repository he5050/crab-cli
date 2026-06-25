/**
 * 权限模块统一出入口 — 值导出。
 *
 * 子模块:
 *   - core: 通配符匹配 + 权限规则评估
 *   - manager: PermissionManager 权限管理器
 *   - store: 审批持久化 + 跨进程桥接
 *   - security: 敏感命令检测
 *   - ui: 权限弹窗激活状态
 */

// ── Type re-exports (统一通过 types.ts) ──────────────────────
export type * from "./types";

// ── Core (wildcard + evaluate) ────────────────────────────────
export { wildcardMatch } from "./core/wildcard";
export { evaluate, evaluateBatch } from "./core/evaluate";

// ── Manager ───────────────────────────────────────────────────
export { PermissionManager } from "./manager/permission";
export type { PermissionCheckResultItem } from "./manager/permission";

// ── Store ─────────────────────────────────────────────────────
export {
  saveApproval,
  getApproval,
  findApproval,
  deleteApproval,
  getAllApprovals,
  clearAllApprovals,
  cleanExpired,
  createSqliteApprovalRepository,
} from "./store/approvalStore";
export type { IApprovalRepository } from "./store/approvalStore";
export {
  listPendingExternalPermissionRequests,
  resolveExternalPermissionRequest,
  resolveExternalPermissionRequestForSession,
  submitExternalPermissionRequest,
} from "./store/approvalBridge";

// ── Security ──────────────────────────────────────────────────
export {
  isDangerousCommand,
  isSelfDestructiveCommand,
  truncateOutput,
  PRESET_SENSITIVE_COMMANDS,
  loadSensitiveCommands,
  saveSensitiveCommands,
  getAllSensitiveCommands,
  addSensitiveCommand,
  removeSensitiveCommand,
  toggleSensitiveCommand,
  resetSensitiveCommands,
  isSensitiveCommand,
  checkSensitiveCommand,
  createFileSensitiveCommandConfigStore,
} from "./security/sensitiveCommand";
export type { ISensitiveCommandConfigStore } from "./security/sensitiveCommand";

// ── UI ────────────────────────────────────────────────────────
export {
  permissionActive,
  currentPermissionRequest,
  setPermissionActive,
  setCurrentPermissionRequest,
  buildPermissionRequestSnapshot,
  buildPermissionBlockedFeedback,
} from "./ui/permissionState";

// ── 配置（权限默认规则集 — 已内聚到 core/） ──────────────────
export {
  DEFAULT_PERMISSIONS,
  getDefaultPermissions,
  getHardDenyPermissions,
  getDefaultPermissionsWithoutHardDeny,
  filterRulesByPermission,
} from "./core/permissionsConfig";
