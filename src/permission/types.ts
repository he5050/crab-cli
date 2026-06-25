/**
 * 权限模块统一出入口 — 类型导出。
 */

// ── Core ───────────────────────────────────────────────────────
export type { EvaluateResult } from "./core/evaluate";

// ── Manager ───────────────────────────────────────────────────
export type { PermissionAskInput } from "./manager/permission";
export type { ApprovalAction } from "@/schema/permission";

// ── Store ─────────────────────────────────────────────────────
export type { ApprovalRecord } from "./store/types";
export type { ExternalPermissionRequest, RemotePermissionResolveResult } from "./store/approvalBridge";

// ── Security ──────────────────────────────────────────────────
export type {
  SensitiveCommand,
  SensitiveCommandScope,
  SensitiveCommandsConfig,
  SelfDestructiveResult,
  SensitiveCheckResult,
  SensitiveCommandResult,
} from "./security/sensitiveCommand";

// ── UI ────────────────────────────────────────────────────────
export type {
  PermissionRiskLevel,
  PermissionRequestSnapshot,
  PermissionBlockedFeedbackModel,
} from "./ui/permissionState";
