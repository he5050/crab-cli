/**
 * SSE 兼容性处理 — 对第三方兼容 API 的 SSE 流进行归一化。
 *
 * 职责:
 *   - normalizeOpenAICompatibleBaseURL: 自动补 /v1 路径
 *   - normalizeOpenAICompatibleChatChunk: 补齐缺失的 choice/tool_call index
 *   - processOpenAICompatibleSseBlock: 在 SSE 块级别执行归一化
 *   - wrapOpenAICompatibleChatFetch: 包装 fetch，对 /chat/completions SSE 流做实时归一化
 */

import { createLogger } from "@/core/logging/logger";

const log = createLogger("sseCompat");

// 配置常量
const MAX_SSE_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB 最大缓冲区

function normalizeOpenAICompatibleChatChunk(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    return payload;
  }
  const raw = payload as Record<string, unknown>;
  if (!Array.isArray(raw.choices)) {
    return payload;
  }

  let changed = false;
  const choices = raw.choices.map((choice, choiceIndex) => {
    if (!choice || typeof choice !== "object") {
      return choice;
    }
    let nextChoice = choice as Record<string, unknown>;

    if (nextChoice.index == null) {
      nextChoice = { ...nextChoice, index: choiceIndex };
      changed = true;
    }

    const { delta } = nextChoice;
    if (!delta || typeof delta !== "object") {
      return nextChoice;
    }
    let nextDelta = delta as Record<string, unknown>;
    for (const key of ["role", "content", "reasoning_content", "reasoning_details", "tool_calls"]) {
      if (nextDelta[key] === null) {
        nextDelta = { ...nextDelta };
        delete nextDelta[key];
        changed = true;
      }
    }

    if (nextDelta !== delta) {
      nextChoice = {
        ...nextChoice,
        delta: nextDelta,
      };
    }

    const toolCalls = nextDelta.tool_calls;
    if (!Array.isArray(toolCalls)) {
      return nextChoice;
    }

    let toolCallsChanged = false;
    const normalizedToolCalls = toolCalls.map((toolCall, toolCallIndex) => {
      if (!toolCall || typeof toolCall !== "object") {
        return toolCall;
      }
      const nextToolCall = toolCall as Record<string, unknown>;
      if (nextToolCall.index != null) {
        return toolCall;
      }
      toolCallsChanged = true;
      changed = true;
      return { ...nextToolCall, index: toolCallIndex };
    });

    if (!toolCallsChanged) {
      return nextChoice;
    }
    return {
      ...nextChoice,
      delta: {
        ...nextDelta,
        tool_calls: normalizedToolCalls,
      },
    };
  });

  return changed ? { ...raw, choices } : payload;
}

function processOpenAICompatibleSseBlock(block: string): string {
  const lines = block.split("\n");
  let changed = false;
  const normalizedLines = lines.map((line) => {
    if (!line.startsWith("data:")) {
      return line;
    }
    const payload = line.slice(5).trimStart();
    if (!payload || payload === "[DONE]") {
      return line;
    }

    try {
      const parsed = JSON.parse(payload);
      const normalized = normalizeOpenAICompatibleChatChunk(parsed);
      if (normalized === parsed) {
        return line;
      }
      changed = true;
      return `data: ${JSON.stringify(normalized)}`;
    } catch {
      return line;
    }
  });

  return changed ? normalizedLines.join("\n") : block;
}

function wrapOpenAICompatibleChatFetch(baseFetch: typeof fetch = globalThis.fetch): typeof fetch {
  const wrapped = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const response = await baseFetch(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const contentType = response.headers.get("content-type") ?? "";

    if (!url.includes("/chat/completions") || !contentType.includes("text/event-stream") || !response.body) {
      return response;
    }

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";
    let totalBufferSize = 0;
    const body = response.body;

    const transformed = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }

            const decoded = decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
            buffer += decoded;
            totalBufferSize += value.length;

            // 检查缓冲区大小限制，溢出时终止流防止数据损坏
            if (totalBufferSize > MAX_SSE_BUFFER_SIZE) {
              log.error(`SSE 缓冲区溢出 (${totalBufferSize} bytes > ${MAX_SSE_BUFFER_SIZE})，终止流`, {
                eventType: "sse.buffer-overflow",
                totalBufferSize,
                maxBufferSize: MAX_SSE_BUFFER_SIZE,
              });
              throw new Error(
                `SSE buffer overflow: ${totalBufferSize} bytes exceeded ${MAX_SSE_BUFFER_SIZE} bytes limit`,
              );
            }

            // 提取完整的 SSE 块（以 \n\n 分隔）
            let separatorIndex = buffer.indexOf("\n\n");
            while (separatorIndex >= 0) {
              const block = buffer.slice(0, separatorIndex);
              buffer = buffer.slice(separatorIndex + 2);
              totalBufferSize -= block.length + 2;
              controller.enqueue(encoder.encode(`${processOpenAICompatibleSseBlock(block)}\n\n`));
              separatorIndex = buffer.indexOf("\n\n");
            }
          }

          // 流结束：flush decoder 内部残余
          const tail = decoder.decode();
          if (tail) {
            buffer += tail;
          }
          // 将残余 buffer（可能是不完整事件）作为最后一个块发出
          if (buffer.length > 0) {
            controller.enqueue(encoder.encode(processOpenAICompatibleSseBlock(buffer)));
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        } finally {
          reader.releaseLock();
        }
      },
    });

    return new Response(transformed, {
      headers: new Headers(response.headers),
      status: response.status,
      statusText: response.statusText,
    });
  };

  // 类型窄化：部分 fetch 实现携带 preconnect 方法（如 Node.js undici）
  type FetchWithPreconnect = typeof fetch & { preconnect?: (url: string) => void };
  const extendedFetch = baseFetch as FetchWithPreconnect;

  return Object.assign(wrapped, {
    preconnect: extendedFetch.preconnect?.bind(baseFetch),
  }) as typeof fetch;
}

function normalizeOpenAICompatibleBaseURL(baseURL: string | undefined): string | undefined {
  if (!baseURL) {
    return undefined;
  }
  const trimmed = baseURL.replace(/\/+$/, "");

  try {
    const parsed = new URL(trimmed);
    if (parsed.pathname === "" || parsed.pathname === "/") {
      parsed.pathname = "/v1";
      return parsed.toString().replace(/\/$/, "");
    }
  } catch {
    return trimmed;
  }

  return trimmed;
}

export const _sseCompat = {
  normalizeOpenAICompatibleBaseURL,
  normalizeOpenAICompatibleChatChunk,
  processOpenAICompatibleSseBlock,
  wrapOpenAICompatibleChatFetch,
};
