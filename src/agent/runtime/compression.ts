/**
 * 上下文压缩感知 — 子代理感知主会话压缩状态。
 *
 * 职责:
 *   - 追踪主会话的压缩事件
 *   - 子代理执行期间检测压缩发生
 *   - 压缩完成后自动注入 continuation 提示
 *   - 维护最近压缩事件的历史记录
 *
 * 模块功能:
 *   - CompressionEvent: 压缩事件接口
 *   - checkCompressionSince: 检查自指定时间以来是否有压缩发生
 *   - buildCompressionContinuationPrompt: 生成压缩感知 continuation 提示
 *   - getLastCompressionTime: 获取最近压缩时间戳
 *
 * 使用场景:
 *   - 子代理需要感知主会话的上下文压缩
 *   - 压缩后向子代理注入上下文连续性提示
 *   - Agent 会话构建运行时增强信息
 *
 * 边界:
 *   1. 仅维护内存中的压缩事件记录(最近 10 条)，不持久化
 *   2. 通过 EventBus 监听 CompressCompleted 事件
 *   3. 仅追踪主会话(sessionId 固定为 "main")
 *   4. 不负责实际的压缩操作，仅感知和响应
 *
 * 流程:
 *   1. 监听 EventBus 的 CompressCompleted 事件
 *   2. 将压缩事件记录到 recentCompressions 数组
 *   3. 子代理执行前调用 checkCompressionSince() 检查压缩
 *   4. 如有压缩，调用 buildCompressionContinuationPrompt() 生成提示
 *   5. 将提示注入到子代理的系统提示词中
 */
import { createLogger } from "@/core/logging/logger";
import { iconWarning } from "@/core/icons/icon";
import { subscribeAgentEvents } from "@/agent/core/agentEvents";

const log = createLogger("agent:compression-awareness");

interface CompressionEvent {
  sessionId: string;
  timestamp: number;
  originalMessageCount: number;
  compressedMessageCount: number;
}

const recentCompressions: CompressionEvent[] = [];
let unsubscribeCompressionEvents: (() => void) | null = null;

function ensureCompressionSubscription(): void {
  if (unsubscribeCompressionEvents) {
    return;
  }

  // 监听压缩事件
  unsubscribeCompressionEvents = subscribeAgentEvents({
    onCompressCompleted: (props) => {
      const record: CompressionEvent = {
        compressedMessageCount: props.tokensAfter ?? 0,
        originalMessageCount: props.tokensBefore ?? 0,
        sessionId: "main",
        timestamp: Date.now(),
      };
      recentCompressions.push(record);
      log.info(`检测到压缩事件: ${record.originalMessageCount} → ${record.compressedMessageCount}`);

      // 只保留最近 10 条
      while (recentCompressions.length > 10) {
        recentCompressions.shift();
      }
    },
  });
}

/**
 * 检查自指定时间以来是否有压缩发生。
 * @param sinceTimestamp - 上次检查的时间戳
 * @returns 如果有压缩发生，返回最新的压缩事件；否则返回 null
 */
export function checkCompressionSince(sinceTimestamp: number): CompressionEvent | null {
  ensureCompressionSubscription();

  for (let i = recentCompressions.length - 1; i >= 0; i--) {
    if (recentCompressions[i]!.timestamp > sinceTimestamp) {
      return recentCompressions[i]!;
    }
  }
  return null;
}

/**
 * 生成压缩感知 continuation 提示。
 * 当检测到主会话被压缩时，为子代理注入此提示以保持上下文连续性。
 */
export function buildCompressionContinuationPrompt(lastKnownTimestamp: number): string | null {
  const compression = checkCompressionSince(lastKnownTimestamp);
  if (!compression) {
    return null;
  }

  return [
    `${iconWarning} 主会话发生了上下文压缩 (${compression.originalMessageCount} → ${compression.compressedMessageCount} 条消息)。`,
    `部分历史消息已被摘要替代。`,
    `如果需要之前对话中的细节，请重新描述你的需求。`,
  ].join("\n");
}

/**
 * 获取最近压缩时间戳。
 */
export function getLastCompressionTime(): number | null {
  ensureCompressionSubscription();

  if (recentCompressions.length === 0) {
    return null;
  }
  return recentCompressions[recentCompressions.length - 1]!.timestamp;
}
