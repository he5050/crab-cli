/**
 * 思维链提取器(Thinking Extractor)— 从多种推理格式中提取 thinking 内容。
 *
 * 职责:
 *   - 从多种 API 响应格式中提取思维链
 *   - 清理思维标签
 *
 * 模块功能:
 *   - cleanThinkingContent(): 清理思维标签(<think/>,<thinking/> 等)
 *   - extractThinkingContent(): 从多种来源提取思维链
 *   - extractReasoningAsThinking(): 从 reasoning 累积提取 thinking
 *
 * 使用场景:
 *   - 处理 Anthropic Extended Thinking
 *   - 处理 Responses API reasoning summary
 *   - 处理 DeepSeek R1 reasoning content
 *
 * 边界:
 * 1. 优先级:Anthropic > Responses API > DeepSeek R1
 * 2. 清理正则匹配 <think/>,</think/>,<thinking/>,</thinking>
 * 3. reasoning 内容可作为 thinking 处理
 *
 * 流程:
 * 1. 检查 thinking 字段(Anthropic Extended Thinking)
 * 2. 检查 reasoning.summary 数组(Responses API)
 * 3. 检查 reasoning_content(DeepSeek R1)
 */

/** Anthropic Extended Thinking 数据结构 */
export interface ThinkingData {
  type: "thinking";
  thinking: string;
  signature?: string;
}

/** Responses API reasoning 数据结构 */
export interface ReasoningData {
  summary?: { type: "summary_text"; text: string }[];
  content?: unknown;
  encrypted_content?: string;
}

/** 思维标签清理正则(匹配 <think/>,</think/>,<thinking/>,</thinking>) */
const THINKING_TAG_PATTERN = /\s*<\/?think(?:ing)?>\s*/gi;

/**
 * 清理思维标签。
 * 部分第三方 API(如 DeepSeek R1)在 reasoning content 中包含 <think/>,<thinking/> 标签，
 * 需要剥离。
 */
export function cleanThinkingContent(content: string): string {
  return content.replace(THINKING_TAG_PATTERN, "").trim();
}

/**
 * 从多种来源提取思维链内容。
 *
 * 优先级:
 *   1. Anthropic Extended Thinking → 直接使用 thinking 字段
 *   2. Responses API reasoning → 拼接 summary 数组
 *   3. DeepSeek R1 → 直接使用 reasoning_content
 *
 * @returns 清理后的思维链文本，或 undefined(无内容时)
 */
export function extractThinkingContent(
  thinking?: ThinkingData,
  reasoning?: ReasoningData,
  reasoningContent?: string,
): string | undefined {
  // 1. Anthropic Extended Thinking
  if (thinking?.thinking) {
    return cleanThinkingContent(thinking.thinking);
  }

  // 2. Responses API reasoning summary
  if (reasoning?.summary && reasoning.summary.length > 0) {
    const content = reasoning.summary.map((item) => item.text).join("\n");
    return cleanThinkingContent(content);
  }

  // 3. DeepSeek R1 reasoning content
  if (reasoningContent) {
    return cleanThinkingContent(reasoningContent);
  }

  return undefined;
}

/**
 * 从 LLM 流事件中提取 reasoning/thinking。
 *
 * crab-cli 的 LLM 流已将 reasoning_delta 和 text_delta 分离，
 * 此函数用于在流结束后，将累积的 reasoning 文本提取为 thinking。
 */
export function extractReasoningAsThinking(reasoningParts: string[]): string | undefined {
  if (reasoningParts.length === 0) {
    return undefined;
  }
  const content = reasoningParts.join("");
  if (!content.trim()) {
    return undefined;
  }
  return cleanThinkingContent(content);
}
