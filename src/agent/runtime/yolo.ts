/**
 * YOLO 模式子代理透传 — 将主会话的 auto-approve 状态透传给子代理。
 *
 * 职责:
 *   - 检测主会话的 YOLO/auto-approve 状态
 *   - 为子代理生成透传的权限配置
 *   - 子代理工具执行时自动跳过确认
 *   - 支持子代理工具调用的自动批准决策
 *
 * 模块功能:
 *   - isYoloPassthroughActive: 检查主会话是否处于 auto-approve 模式
 *   - getYoloPassthroughRuleset: 为子代理生成 YOLO 透传的权限配置
 *   - shouldAutoApproveSubAgentTool: 判断子代理的工具调用是否应自动批准
 *
 * 使用场景:
 *   - 主会话开启 YOLO 模式时，子代理自动继承透传权限
 *   - 子代理执行工具调用时的权限判断
 *   - 批量任务执行时减少人工确认
 *
 * 边界:
 *   1. 仅检测主会话的 YOLO 状态，不管理子代理独立配置
 *   2. 透传权限仅影响工具调用的自动批准，不扩展工具白名单
 *   3. 子代理自身的 autoApprove 设置优先级高于透传
 *
 * 流程:
 *   1. 通过 getYoloOverlay() 检测主会话 YOLO 状态
 *   2. 子代理创建时调用 getYoloPassthroughRuleset() 获取权限规则
 *   3. 子代理执行工具时调用 shouldAutoApproveSubAgentTool() 判断
 *   4. 返回 true 则跳过用户确认直接执行
 */
import { createLogger } from "@/core/logging/logger";
import { getYoloOverlay } from "@/agent/runtime/modeState";
import type { PermissionRuleset } from "@/schema/permission";
import { SUBAGENT_DENIED_TOOL_SET } from "@/agent/subagent/deniedTools";

const log = createLogger("agent:yolo-passthrough");

/** 即使在 YOLO 模式下也禁止自动批准的高风险工具（在子代理禁止列表基础上扩展） */
const YOLO_DANGEROUS_TOOLS = new Set([...SUBAGENT_DENIED_TOOL_SET, "filesystem-delete", "file-delete"]);

/**
 * 检查主会话是否处于 auto-approve 模式。
 * 当主会话处于 YOLO 模式时，子代理也应自动批准工具调用。
 */
export function isYoloPassthroughActive(): boolean {
  const yolo = getYoloOverlay();
  if (yolo) {
    log.debug("YOLO 透传激活，子代理将自动批准工具调用");
  }
  return yolo;
}

/**
 * 为子代理生成 YOLO 透传的权限配置。
 *
 * 状态: 暂未在生产代码中使用(index.ts 仅转发导出, sessionSubagent 未消费).
 *      保留为 API 形态, 以便未来 ConversationHandler 增加 ruleset 透传参数时直接启用.
 *
 * 语义: 当主会话处于 YOLO 模式时, 返回"全部允许"的通配规则集.
 * 注意: pattern="*" + permission="*" + action="allow" 才是真正"宽松";
 *      之前实现错误地返回空数组(等同全部拒绝)，已修复.
 *
 * @returns YOLO 激活时返回通配 allow 规则集；未激活时返回 null
 */
export function getYoloPassthroughRuleset(): PermissionRuleset | null {
  if (!isYoloPassthroughActive()) {
    return null;
  }

  log.info("为子代理生成 YOLO 透传权限规则(全部允许)");
  return [
    {
      action: "allow",
      pattern: "*",
      permission: "*",
    },
  ];
}

/**
 * 判断子代理的工具调用是否应自动批准。
 *
 * @param toolName - 工具名
 * @param autoApprove - 子代理自身的 autoApprove 设置
 * @returns 是否应自动批准
 */
export function shouldAutoApproveSubAgentTool(toolName: string, autoApprove?: boolean): boolean {
  // 子代理自身已设为 auto-approve
  if (autoApprove) {
    return true;
  }

  // 主会话 YOLO 透传
  if (isYoloPassthroughActive()) {
    if (YOLO_DANGEROUS_TOOLS.has(toolName)) {
      log.warn(`YOLO 透传: 拒绝自动批准高风险工具 ${toolName}`);
      return false;
    }
    log.debug(`YOLO 透传: 自动批准子代理工具 ${toolName}`);
    return true;
  }

  return false;
}
