// src/security/index.ts
// 安全模块统一导出入口

export { sanitizeClipboardText, inspectClipboardText } from "./clipboardSanitizer";
export type { ClipboardSanitizeResult } from "./clipboardSanitizer";

export {
  ReplayProtector,
  createReplayProtector,
  replayProtector,
  validateReplayProtectionConfig,
} from "./replayProtection";
export type { ReplayProtectionConfig, RequestContext, ValidationResult, ReplayAgentMessage } from "./replayProtection";

export { AuditLogger, createAuditLogger, getGlobalAuditLogger, waitForGlobalAuditLogger } from "./audit/auditLogger";
export type { AuditLogEntry, AuditQuery, AuditContext, AuditSubject, AuditResource } from "./audit/auditLogger";

export type { AuditLevel, AuditEventType } from "./audit/types";

export { createMemoryStore, createFileStore, validateAuditStoreConfig } from "./audit/auditStore";
export type { AuditStore, AuditStoreConfig } from "./audit/auditStore";

/** @internal — 审计日志签名/验证的低级函数，仅供 AuditLogger 内部使用 */
export { IntegrityError, canonicalJson, signEntry, verifyEntry, stampEntry } from "./audit/integrity";

export { exportAuditAsJson, exportAuditAsCsv } from "./audit/exporter";
export { JsonlPersister } from "./audit/jsonlPersister";
export type { JsonlPersisterOptions } from "./audit/jsonlPersister";
export { sanitizeAuditData } from "./audit/sanitize";
