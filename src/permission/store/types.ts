/**
 * 审批存储类型定义 — 接口与数据结构。
 *
 * 职责:
 *   - 定义审批存储的接口（依赖倒置）
 *   - 定义审批记录的数据结构
 *
 * 边界:
 *   - 仅定义类型，不包含任何实现逻辑
 *   - 实现由 approvalStore.ts（SQLite）提供
 */

/** 审批存储接口 — 允许替换底层实现（如内存存储用于测试） */
export interface IApprovalRepository {
  saveApproval(record: Omit<ApprovalRecord, "id">): void;
  /** 精确匹配: permission + pattern 完全一致时返回 */
  getApproval(permission: string, pattern: string): ApprovalRecord | null;
  /** 通配符匹配: permission 一致 + pattern 使用通配符匹配时返回最新的匹配记录 */
  findApproval(permission: string, pattern: string): ApprovalRecord | null;
  deleteApproval(id: string): void;
  getAllApprovals(sessionId?: string): ApprovalRecord[];
  clearAllApprovals(): void;
  cleanExpired(): number;
}

/** 审批记录 */
export interface ApprovalRecord {
  id: string;
  permission: string;
  pattern: string;
  sessionId: string;
  decision: "allow" | "deny";
  timestamp: number;
  expiresAt: number | null;
}
