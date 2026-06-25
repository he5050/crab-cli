/**
 * Attention 系统 — 对话页中的关注点提示与提醒。
 *
 * 职责:
 *   - 追踪对话中的关键关注点(Attention Point)
 *   - 在对话流中插入提醒标签
 *   - 提供 Attention 状态查询
 *   - 管理关注点的生命周期(添加、解除、清除)
 *
 * 模块功能:
 *   - AttentionPoint: 关注点接口定义
 *   - addAttention: 添加关注点
 *   - dismissAttention: 解除关注点
 *   - clearDismissed: 清除所有已解除的关注点
 *   - activePoints: 获取活跃关注点(未解除)
 *   - highestLevel: 获取最高级别
 *   - formatAttentionPrompt: 格式化 Attention 为提示词文本
 *
 * 使用场景:
 *   - 对话中标记需要关注的重要信息
 *   - 提醒 Agent 注意特定问题或约束
 *   - 在系统提示词中注入关注点提醒
 *   - UI 中显示关注状态指示器
 *
 * 边界:
 *   1. 仅维护内存中的关注点状态，不持久化
 *   2. 使用 SolidJS 信号管理响应式状态
 *   3. 关注点级别分为 info/warning/critical 三级
 *   4. 格式化输出用于注入到系统提示词
 *
 * 流程:
 *   1. 通过 addAttention() 添加新的关注点
 *   2. 通过 dismissAttention() 解除已处理的关注点
 *   3. 通过 clearDismissed() 清理已解除的关注点
 *   4. 通过 formatAttentionPrompt() 生成提示词文本
 *   5. 将提示词注入到 Agent 的系统提示词中
 */
import { createMemo, createSignal } from "solid-js";
import { createLogger } from "@/core/logging/logger";
import { iconError, iconLsp, iconWarning } from "@/core/icons/icon";

const log = createLogger("agent:attention");

// ─── 类型 ─────────────────────────────────────────────────

export interface AttentionPoint {
  id: string;
  label: string;
  description?: string;
  level: "info" | "warning" | "critical";
  createdAt: number;
  source: "user" | "system" | "agent";
  dismissed: boolean;
}

// ─── 信号状态 ──────────────────────────────────────────────

const [points, setPoints] = createSignal<AttentionPoint[]>([]);
const [enabled, setEnabled] = createSignal(true);

/** 获取当前所有关注点(只读副本) */
export function getPoints(): AttentionPoint[] {
  return points();
}

/** 检查 Attention 系统是否启用 */
export function isEnabled(): boolean {
  return enabled();
}

/** 启用 Attention 系统 */
export function enableAttention(): void {
  setEnabled(true);
}

/** 禁用 Attention 系统 */
export function disableAttention(): void {
  setEnabled(false);
}

/** 重置所有关注点(仅测试/初始化使用) */
export function resetAttention(): void {
  setPoints([]);
  setEnabled(true);
  nextId = 1;
}

// ─── 操作 ──────────────────────────────────────────────────

let nextId = 1;

/** 添加关注点 */
export function addAttention(
  label: string,
  options?: {
    description?: string;
    level?: AttentionPoint["level"];
    source?: AttentionPoint["source"];
  },
): AttentionPoint {
  const point: AttentionPoint = {
    createdAt: Date.now(),
    description: options?.description,
    dismissed: false,
    id: `attn_${nextId++}`,
    label,
    level: options?.level ?? "info",
    source: options?.source ?? "system",
  };
  setPoints((prev) => [...prev, point]);
  log.info(`Attention 添加: [${point.level}] ${label}`);
  return point;
}

/** 解除关注点 */
export function dismissAttention(id: string): void {
  setPoints((prev) => prev.map((p) => (p.id === id ? { ...p, dismissed: true } : p)));
}

/** 清除所有已解除的关注点 */
export function clearDismissed(): void {
  setPoints((prev) => prev.filter((p) => !p.dismissed));
}

/** 获取活跃关注点(未解除) */
export const activePoints = createMemo(() => points().filter((p) => !p.dismissed));

/** 获取最高级别 */
export const highestLevel = createMemo((): AttentionPoint["level"] | null => {
  const active = activePoints();
  if (active.length === 0) {
    return null;
  }
  const levels: Record<AttentionPoint["level"], number> = { critical: 2, info: 0, warning: 1 };
  const top = active.reduce((a, b) => (levels[a.level] >= levels[b.level] ? a : b));
  return top.level;
});

/** 格式化 Attention 为提示词文本 */
export function formatAttentionPrompt(): string {
  const active = activePoints();
  if (active.length === 0 || !enabled()) {
    return "";
  }

  const lines = ["## 当前关注点"];
  for (const p of active) {
    const icon = p.level === "critical" ? iconError : p.level === "warning" ? iconWarning : iconLsp;
    lines.push(`- ${icon} ${p.label}${p.description ? `: ${p.description}` : ""}`);
  }
  lines.push("");
  lines.push("请在回复中注意这些关注点，并尽可能解决相关问题。");
  return lines.join("\n");
}
