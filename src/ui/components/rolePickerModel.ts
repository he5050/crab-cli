/**
 * Role Picker 业务模型 — 加载/应用 ROLE.md 角色文件。
 *
 * 职责:
 *   - 枚举可用 Role
 *   - 应用 Role 时构造注入文本并发布事件
 *
 * 边界:
 *   1. Role 只负责 ROLE.md prompt 注入，不涉及 Agent 工具/模型/执行
 */
import { AppEvent } from "@/bus";
import { globalBus, type EventBus } from "@/bus";
import { type RoleItem, type RoleLocation, createRoleFile, listAllRoles, switchActiveRole } from "@/agent/roles";

export type RolePickerAction = { type: "switch"; role: RoleItem } | { type: "create"; location: RoleLocation };

export interface RolePickerOption {
  title: string;
  description?: string;
  category?: string;
  value: RolePickerAction;
  current?: boolean;
  disabled?: boolean;
  keywords?: string[];
  marker?: string;
  meta?: string;
}

export interface RolePickerBuildOptions {
  projectRoot?: string;
  includeGlobal?: boolean;
  includeCreateActions?: boolean;
}

export interface RolePickerApplyResult {
  success: boolean;
  roleId: string | null;
  roleName: string | null;
  previousRoleId: string | null;
  location?: RoleLocation;
  error?: string;
}

export function getEffectiveActiveRole(roles: RoleItem[]): RoleItem | undefined {
  return (
    roles.find((role) => role.location === "project" && role.isActive) ??
    roles.find((role) => role.location === "global" && role.isActive)
  );
}

export function buildRolePickerOptions(options: RolePickerBuildOptions = {}): RolePickerOption[] {
  const projectRoot = options.projectRoot ?? process.cwd();
  const includeGlobal = options.includeGlobal ?? true;
  const includeCreateActions = options.includeCreateActions ?? true;
  const roles = listAllRoles(projectRoot).filter((role) => includeGlobal || role.location === "project");
  const effectiveActive = getEffectiveActiveRole(roles);
  const hasProjectRole = roles.some((role) => role.location === "project");

  const roleOptions = roles.map((role): RolePickerOption => {
    const isEffectiveActive = effectiveActive?.id === role.id && effectiveActive.location === role.location;
    const shadowedByProject = role.location === "global" && hasProjectRole;
    return {
      category: role.location === "project" ? "Project ROLE.md" : "Global ROLE.md",
      current: isEffectiveActive,
      description: formatRoleDescription(role, shadowedByProject),
      disabled: shadowedByProject,
      keywords: [role.id, role.name, role.filename, role.location, role.path, role.isOverride ? "override" : "append"],
      marker: isEffectiveActive ? symDot : role.isOverride ? symExclaim : undefined,
      meta: [role.id, role.isOverride ? "override" : "append", shadowedByProject ? "shadowed" : ""]
        .filter(Boolean)
        .join(" · "),
      title: formatRoleTitle(role),
      value: { role, type: "switch" },
    };
  });

  if (!includeCreateActions) {
    return roleOptions;
  }

  return [
    ...roleOptions,
    {
      category: "Actions",
      description: "在当前项目 .crab/ROLE.md 创建 prompt role",
      keywords: ["create", "project", "role", "ROLE.md"],
      title: "创建项目 ROLE.md",
      value: { location: "project", type: "create" },
    },
    {
      category: "Actions",
      description: "在 ~/.crab/ROLE.md 创建全局 prompt role",
      keywords: ["create", "global", "role", "ROLE.md"],
      title: "创建全局 ROLE.md",
      value: { location: "global", type: "create" },
    },
  ];
}

export async function applyRolePickerAction(
  action: RolePickerAction,
  projectRoot?: string,
  eventBus: EventBus = globalBus,
): Promise<RolePickerApplyResult> {
  const previousRoleId = getEffectiveActiveRole(listAllRoles(projectRoot))?.id ?? null;

  if (action.type === "create") {
    const created = await createRoleFile(action.location, projectRoot);
    if (!created.success) {
      return {
        error: created.error,
        location: action.location,
        previousRoleId,
        roleId: null,
        roleName: null,
        success: false,
      };
    }
    const nextRole = getEffectiveActiveRole(listAllRoles(projectRoot));
    publishRoleChanged(nextRole?.id ?? null, nextRole?.name ?? null, previousRoleId, eventBus);
    return {
      location: action.location,
      previousRoleId,
      roleId: nextRole?.id ?? null,
      roleName: nextRole?.name ?? null,
      success: true,
    };
  }

  const switched = await switchActiveRole(action.role.id, action.role.location, projectRoot);
  if (!switched.success) {
    return {
      error: switched.error,
      location: action.role.location,
      previousRoleId,
      roleId: action.role.id,
      roleName: action.role.name,
      success: false,
    };
  }

  const nextRole = getEffectiveActiveRole(listAllRoles(projectRoot));
  publishRoleChanged(nextRole?.id ?? action.role.id, nextRole?.name ?? action.role.name, previousRoleId, eventBus);
  return {
    location: action.role.location,
    previousRoleId,
    roleId: nextRole?.id ?? action.role.id,
    roleName: nextRole?.name ?? action.role.name,
    success: true,
  };
}

function publishRoleChanged(
  roleId: string | null,
  roleName: string | null,
  previousRoleId: string | null,
  eventBus: EventBus = globalBus,
): void {
  eventBus.publish(AppEvent.RoleChanged, {
    previousRoleId,
    roleId,
    roleName,
  });
}

function formatRoleTitle(role: RoleItem): string {
  if (role.filename === "ROLE.md") {
    return `${role.location} / ROLE.md`;
  }
  return `${role.location} / ${role.filename}`;
}

function formatRoleDescription(role: RoleItem, shadowedByProject: boolean): string {
  const mode = role.isOverride ? "Override: 替换基础身份提示" : "Append: 追加到系统提示词";
  const status = role.isActive ? "active" : "inactive";
  const shadow = shadowedByProject ? "；当前被项目级 ROLE.md 覆盖" : "";
  return `${status}；${mode}${shadow}`;
}

import { symDot, symExclaim } from "@/core/icons/icon";
