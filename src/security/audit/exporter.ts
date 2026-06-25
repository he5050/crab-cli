/**
 * 审计日志导出工具 — JSON/CSV 格式导出。
 *
 * 职责:
 *   - 将审计日志条目导出为 JSON 字符串（格式化）
 *   - 将审计日志条目导出为 CSV 字符串
 *
 * 边界:
 *   1. CSV 中 action 字段的双引号按 RFC 4180 转义
 *   2. CSV 使用逗号分隔符
 */
import type { AuditLogEntry } from "./auditLogger";

/**
 * 将审计日志条目导出为格式化 JSON 字符串
 */
export function exportAuditAsJson(entries: AuditLogEntry[]): string {
  return JSON.stringify(entries, null, 2);
}

/**
 * 将审计日志条目导出为 CSV 字符串
 */
export function exportAuditAsCsv(entries: AuditLogEntry[]): string {
  const headers = ["id", "timestamp", "app", "eventType", "level", "action", "userId", "resourceType"];
  const rows = entries.map((e) =>
    [
      e.id,
      new Date(e.timestamp).toISOString(),
      e.app,
      e.eventType,
      e.level,
      `"${e.action.replace(/"/g, '""')}"`,
      e.subject?.userId ?? "",
      e.resource?.type ?? "",
    ].join(","),
  );
  return [headers.join(","), ...rows].join("\n");
}
