/**
 * 向后兼容存根 — 实际实现已移至 permission/core/permissionsConfig.ts。
 * 保留此文件以兼容外部直接导入 @/config/features/permissionsConfig 的代码。
 *
 * @deprecated 请改为从 @/permission 导入，或直接从 permission/core/permissionsConfig 导入。
 */
export {
  DEFAULT_PERMISSIONS,
  getDefaultPermissions,
  getHardDenyPermissions,
  getDefaultPermissionsWithoutHardDeny,
  filterRulesByPermission,
} from "../../permission/core/permissionsConfig";
export type { PermissionRule } from "@/schema/permission";
