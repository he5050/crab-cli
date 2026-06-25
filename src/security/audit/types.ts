/**
 * 审计日志公共类型 — 集中管理审计模块共享的类型定义。
 *
 * 说明:
 *   - AuditLevel 和 AuditEventType 是审计日志的核心枚举类型，
 *     被 auditLogger、auditStore 及外部消费者共同引用
 *   - 其余接口（AuditSubject、AuditResource 等）仅在 auditLogger 内部使用，
 *     保留在 auditLogger.ts 中避免不必要的依赖扩散
 */

/** 审计级别 */
export type AuditLevel = "info" | "warning" | "error" | "critical";

/** 审计事件类型 */
export type AuditEventType =
  | "authentication"
  | "authorization"
  | "data_access"
  | "data_modification"
  | "config_change"
  | "security_event"
  | "system";
