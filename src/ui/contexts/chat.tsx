/**
 * Chat Context
 *
 * 职责:
 *   - 创建/销毁 ConversationHandler 实例
 *   - 维护消息列表状态
 *   - 处理发送消息、流式输出、工具调用事件
 *   - 管理 Agent 切换和对话模式
 *
 * 模块功能:
 *   - 发送用户消息并接收 AI 回复
 *   - 流式文本和 reasoning 内容累积与展示
 *   - 工具调用状态跟踪和结果展示
 *   - 消息级 Undo/Redo 操作
 *   - Agent 切换和对话模式管理
 *   - 会话消息持久化
 *
 * 使用场景:
 *   - 用户与 AI 进行对话交互
 *   - 工具调用结果的实时展示
 *   - 多 Agent 协作场景
 *   - 对话历史管理和回溯
 *
 * 边界:
 *   1. UI 层的对话状态管理，不直接调用 LLM API
 *   2. 消息存储于内存，通过 session 模块持久化
 *   3. 流式输出使用批量合并优化性能
 *   4. 不支持离线消息队列
 *
 * 流程:
 *   1. 初始化时创建 ConversationHandler 并订阅事件
 *   2. 用户调用 send() 发送消息
 *   3. 追加用户消息到列表，调用 handler.sendMessage()
 *   4. 接收流式 chunk 事件，累积到缓冲区
 *   5. 定时 flush 缓冲区更新 UI
 *   6. 接收完成事件，组装最终消息并持久化
 *   7. 支持 Goal 自动续接(最多 10 次)
 */
import { createSignal, onCleanup } from "solid-js";
import { createSimpleContext } from "@/ui/contexts/helper";
import { ConversationHandler, type ConversationResult } from "@/conversation/core/conversationHandler";
import { useEventBus } from "@/ui/contexts/eventBus";
import { AppEvent } from "@bus";
import { createLogger } from "@/core/logging/logger";
import { getSessionStatus, setSessionStatus } from "@/session/state";
import { loadAgentState } from "@/agent/core/state";
import { getActiveAgent, getActiveAgentName, registerAllAgents, setActiveAgent as setAgentActive } from "@agent";
import { getEffectiveMode, getYoloOverlay, switchMode } from "@/agent/runtime/modeState";
import { type MessageUndoAPI, createMessageUndo } from "@/ui/hooks/useMessageUndo";
import { teamExecutor } from "@/agent/team";
import {
  addMessage,
  addTextMessage,
  chatMessageToParts,
  ensureSession,
  getSessionMessages,
  messageRecordsToModelMessages,
} from "@session";
import type { MessageFileReference } from "@session";
import {
  type ChatContextValue,
  type ChatMessage,
  type ChatMessagePart,
  type ChatProviderProps,
  type TextPart,
} from "./chatTypes";
import {
  appendMessage,
  buildChatRuntimeOverrides,
  loadPersistedChatMessages,
  mergeMetadata,
  nextId,
  normalizePartTime,
  stringifyForStorage,
} from "./chatHelpers";
import {
  type PersistedToolCall,
  buildRunningToolMessage,
  formatToolResultOutput,
  updateToolResultMessages,
} from "./chatToolEvents";
export type {
  ThinkingPart,
  TextPart,
  ToolStatus,
  ToolPart,
  ChatMessagePart,
  ChatMessage,
  ChatContextValue,
  ChatRuntimeOverrides,
} from "./chatTypes";
export { buildChatRuntimeOverrides } from "./chatHelpers";

const log = createLogger("chat");
const GOAL_AUTO_CONTINUATION_INPUT = "[系统自动续接] 继续推进当前目标。";
const MAX_GOAL_CONTINUATIONS = 50;

const chatContextDeps = {
  ConversationHandler,
  getSessionMessages,
};

export function __setChatContextDepsForTesting(overrides: Partial<typeof chatContextDeps>): void {
  Object.assign(chatContextDeps, overrides);
}

export function __resetChatContextDepsForTesting(): void {
  chatContextDeps.ConversationHandler = ConversationHandler;
  chatContextDeps.getSessionMessages = getSessionMessages;
}

const chatContext = createSimpleContext<ChatContextValue, ChatProviderProps>({
  init: (props): ChatContextValue => {
    const eventBus = useEventBus();
    const { config } = props;
    if (props.sessionId) {
      ensureSession(props.sessionId, {
        model: config.defaultProvider.model,
        projectDir: process.cwd(),
      });
    }

    // 初始化所有 Agent(幂等)
    registerAllAgents();
    const initialMode = process.env.CRAB_INITIAL_MODE;
    if (initialMode === "plan" || initialMode === "team" || initialMode === "simple" || initialMode === "security") {
      switchMode(initialMode, (msg) => eventBus.publish(AppEvent.Toast, { message: msg, variant: "info" }));
      delete process.env.CRAB_INITIAL_MODE;
    }
    if (process.env.CRAB_YOLO_MODE === "1" && !getYoloOverlay()) {
      switchMode("yolo", (msg) => eventBus.publish(AppEvent.Toast, { message: msg, variant: "info" }));
      delete process.env.CRAB_YOLO_MODE;
    }

    const [messages, setMessages] = createSignal<ChatMessage[]>(loadPersistedChatMessages(props.sessionId));
    const [loading, setLoading] = createSignal(false);

    // ─── 消息级 Undo/Redo ───
    const messageUndo: MessageUndoAPI = createMessageUndo(messages, setMessages);
    const [currentAgentName, setCurrentAgentName] = createSignal(getActiveAgentName());
    const [currentMode, setCurrentMode] = createSignal<string>(getEffectiveMode());
    const [currentYolo, setCurrentYolo] = createSignal<boolean>(getYoloOverlay());

    // 流式文本累积 — 用 string[] 避免 O(n²) 字符串拼接
    // 优化:维护 cachedJoined 避免每次 flush 重新 join 整个数组
    let streamingParts: string[] = [];
    let streamingJoinedLen = 0; // 已 join 的 streamingParts 长度
    const [streamingText, setStreamingText] = createSignal("");

    // 流式 reasoning 累积
    let reasoningBuffer: string[] = [];
    let reasoningFlushTimer: ReturnType<typeof setTimeout> | null = null;
    const [streamingReasoning, setStreamingReasoning] = createSignal("");
    const getRuntimeOverrides = () =>
      buildChatRuntimeOverrides(config, getActiveAgent(), getEffectiveMode(), getYoloOverlay());
    const getInitialMessages = () =>
      props.sessionId ? messageRecordsToModelMessages(chatContextDeps.getSessionMessages(props.sessionId)) : undefined;

    // 加载可恢复的 AgentState(用于崩溃恢复)
    const savedState = props.sessionId ? loadAgentState(props.sessionId) : null;

    // 创建 ConversationHandler(savedState 作为 fallback)
    const initialOverrides = getRuntimeOverrides();
    let activeAbortController: AbortController | null = null;

    let handler = new chatContextDeps.ConversationHandler(config, {
      allowedTools: savedState?.allowedTools ?? initialOverrides.allowedTools,
      initialMessages: getInitialMessages(),
      maxToolRounds: initialOverrides.maxToolRounds,
      mode: getEffectiveMode(),
      modelId: savedState?.modelId ?? initialOverrides.modelId,
      providerId: savedState?.providerId ?? initialOverrides.providerId,
      sessionId: props.sessionId,
      systemPrompt: savedState?.systemPrompt ?? initialOverrides.systemPrompt,
      temperature: savedState?.temperature ?? initialOverrides.temperature,
      topP: savedState?.topP ?? initialOverrides.topP,
    });

    // 恢复运行时状态(recentToolCalls, activeSkillContext, recoveredFrom)
    if (savedState) {
      handler.restoreState(savedState);
      log.info(`Agent 状态已恢复: ${props.sessionId}`);
    }

    // 自动批准 fs.read 权限
    handler.getPermissionManager().approve("fs.read", "**");

    // Agent 工具限制现在由 ConversationHandler 内部的 allowedTools 白名单执行

    // ─── 流式 chunk 批量合并 ───
    let chunkBuffer: string[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flushChunks = () => {
      flushTimer = null;
      if (chunkBuffer.length === 0) {
        return;
      }
      streamingParts.push(...chunkBuffer);
      chunkBuffer = [];
      // 增量 join:只 join 新增的部分，拼接到缓存的字符串末尾
      const newText = streamingParts.slice(streamingJoinedLen).join("");
      streamingJoinedLen = streamingParts.length;
      if (newText.length > 0) {
        setStreamingText((prev) => prev + newText);
      }
    };

    const flushReasoning = () => {
      reasoningFlushTimer = null;
      if (reasoningBuffer.length === 0) {
        return;
      }
      setStreamingReasoning((prev) => prev + reasoningBuffer.join(""));
      reasoningBuffer = [];
    };

    // ─── 订阅正文流式事件 ───
    // ConversationStreamToken 由 conversation/llmLoopAdapter 发布，
    // 替代原先未连通的 ChatChunk 事件。
    const unsubChunk = eventBus.subscribe(AppEvent.ConversationStreamToken, (evt) => {
      if (props.sessionId && evt.properties.sessionId && evt.properties.sessionId !== props.sessionId) {
        return;
      }
      chunkBuffer.push(evt.properties.content);
      if (flushTimer === null) {
        flushTimer = setTimeout(flushChunks, 16);
      }
    });

    // ─── 订阅 reasoning 流式事件 ───
    // ChatReasoning 由 conversation/llmLoopAdapter.onThinkingDelta 发布。
    const unsubReasoning = eventBus.subscribe(AppEvent.ChatReasoning, (evt) => {
      reasoningBuffer.push(evt.properties.chunk);
      if (reasoningFlushTimer === null) {
        reasoningFlushTimer = setTimeout(flushReasoning, 16);
      }
    });

    const unsubMessageSent = eventBus.subscribe(AppEvent.ConversationMessageSent, (evt) => {
      if (!props.sessionId || evt.properties.sessionId !== props.sessionId) {
        return;
      }
      if (evt.properties.role !== "user") {
        return;
      }
      addTextMessage(props.sessionId, "user", evt.properties.content);
    });

    const persistedToolCalls = new Map<string, PersistedToolCall>();
    const unsubConversationTool = eventBus.subscribe(AppEvent.ConversationToolCall, (evt) => {
      if (!props.sessionId || evt.properties.sessionId !== props.sessionId) {
        return;
      }
      const argsStr = stringifyForStorage(evt.properties.args);
      const startedAt =
        ((evt.properties.time as Record<string, unknown> | undefined)?.startedAt as number | undefined) ??
        evt.properties.startedAt ??
        Date.now();
      const time = normalizePartTime(evt.properties.time as Record<string, unknown> | undefined, startedAt);
      persistedToolCalls.set(evt.properties.callId, {
        args: argsStr,
        diagnostics: evt.properties.diagnostics as undefined[] | undefined,
        files: evt.properties.files as MessageFileReference[] | undefined,
        input: evt.properties.args,
        metadata: evt.properties.metadata,
        startedAt,
        subSessionId: evt.properties.subSessionId,
        time,
        tool: evt.properties.tool,
      });
      addMessage(props.sessionId, "assistant", [
        {
          callId: evt.properties.callId,
          content: argsStr,
          diagnostics: evt.properties.diagnostics as undefined[] | undefined,
          files: evt.properties.files as MessageFileReference[] | undefined,
          input: evt.properties.args,
          metadata: evt.properties.metadata,
          subSessionId: evt.properties.subSessionId,
          time,
          tool_name: evt.properties.tool,
          tool_use_id: evt.properties.callId,
          type: "tool_use",
        },
      ]);
    });

    // ─── 订阅工具调用 ───
    const unsubTool = eventBus.subscribe(AppEvent.ToolCall, (evt) => {
      const message = buildRunningToolMessage(
        { ...evt.properties, files: evt.properties.files as MessageFileReference[] | undefined } as any,
        evt.properties.callId || nextId(),
        (message) => log.debug(message),
      );
      setMessages((prev) => appendMessage(prev, message));
    });

    // ─── 订阅工具结果(用 callId 精确匹配，避免并发调用错配) ───
    const unsubResult = eventBus.subscribe(AppEvent.ToolResult, (evt) => {
      const { tool, success, result, truncated, outputPath, callId } = evt.properties;
      const persisted = callId ? persistedToolCalls.get(callId) : undefined;
      const evtTime = evt.properties.time as Record<string, unknown> | undefined;
      const endedAt = evt.properties.endedAt ?? (evtTime?.endedAt as number | undefined) ?? Date.now();
      const startedAt =
        evt.properties.startedAt ??
        (evtTime?.startedAt as number | undefined) ??
        persisted?.startedAt ??
        (persisted?.time?.startedAt as number | undefined);
      const resultTime = normalizePartTime(
        { ...(persisted?.time as Record<string, unknown> | undefined), ...evtTime },
        startedAt,
        endedAt,
        evt.properties.durationMs,
      );
      const metadata = mergeMetadata(persisted?.metadata, evt.properties.metadata);
      const files = (evt.properties.files ?? persisted?.files) as MessageFileReference[] | undefined;
      const diagnostics = evt.properties.diagnostics ?? persisted?.diagnostics;
      const subSessionId = evt.properties.subSessionId ?? persisted?.subSessionId;
      if (props.sessionId && callId) {
        addMessage(props.sessionId, "tool", [
          {
            callId,
            content: stringifyForStorage(result),
            diagnostics,
            files,
            metadata,
            outputPath,
            result,
            subSessionId,
            success,
            time: resultTime,
            tool_use_id: callId,
            truncated,
            type: "tool_result",
          },
        ]);
        persistedToolCalls.delete(callId);
      }
      const displayOutput = formatToolResultOutput(result, (message) => log.debug(message));
      setMessages((prev) =>
        updateToolResultMessages(prev, {
          callId,
          diagnostics,
          displayOutput,
          durationMs: evt.properties.durationMs,
          endedAt,
          fallbackId: nextId(),
          files,
          metadata: evt.properties.metadata,
          outputPath,
          persisted,
          resultTime,
          startedAt,
          subSessionId,
          success,
          time: evt.properties.time as any,
          tool,
          truncated,
        }),
      );
    });

    // ─── 订阅 MCP 工具列表变更 ───
    const unsubToolsChanged = eventBus.subscribe(AppEvent.ToolsListChanged, (evt) => {
      const { serverName, toolCount, added, removed } = evt.properties;
      const parts: string[] = [];
      if (added.length > 0) {
        parts.push(`+${added.join(", ")}`);
      }
      if (removed.length > 0) {
        parts.push(`-${removed.join(", ")}`);
      }
      const detail = parts.length > 0 ? ` (${parts.join(" ")})` : "";
      eventBus.publish(AppEvent.Toast, {
        message: `MCP ${serverName} 工具列表已更新: ${toolCount} 工具${detail}`,
        variant: "info",
      });
    });

    // ─── 订阅 Agent 切换事件(同步 mode 信号) ───
    const unsubAgentSelected = eventBus.subscribe(AppEvent.AgentSelected, () => {
      setCurrentAgentName(getActiveAgentName());
      setCurrentMode(getEffectiveMode());
      setCurrentYolo(getYoloOverlay());
    });

    // ─── 订阅日志(降级通知等) ───
    const unsubLog = eventBus.subscribe(AppEvent.Log, (evt) => {
      const { level, message } = evt.properties;
      if (level === "warn" || level === "error") {
        setMessages((prev) =>
          appendMessage(prev, {
            content: `[${level}] ${message}`,
            id: nextId(),
            isError: level === "error",
            role: "system",
          }),
        );
      }
    });

    // ─── 订阅对话中止事件 ───
    const unsubAborted = eventBus.subscribe(AppEvent.ConversationAborted, (evt) => {
      if (props.sessionId && evt.properties.sessionId !== props.sessionId) {
        return;
      }
      const reason = evt.properties.reason ?? "用户中止";
      setMessages((prev) =>
        appendMessage(prev, {
          content: `⏹ 对话已中止: ${reason}`,
          id: nextId(),
          role: "system",
        }),
      );
    });

    // ─── 订阅工具超时事件 ───
    const unsubToolTimeout = eventBus.subscribe(AppEvent.ToolTimeout, (evt) => {
      const { toolName, timeoutMs } = evt.properties;
      eventBus.publish(AppEvent.Toast, {
        message: `⚠ 工具 ${toolName} 执行超时 (${timeoutMs}ms)`,
        variant: "warning",
      });
    });

    // ─── 订阅 LLM 降级重试事件 ───
    const unsubLlmRetry = eventBus.subscribe(AppEvent.LlmRetry, (evt) => {
      eventBus.publish(AppEvent.Toast, {
        message: `🔄 LLM 降级重试: ${evt.properties.fallbackFrom} → ${evt.properties.fallbackTo} (${evt.properties.reason})`,
        variant: "warning",
      });
    });

    // /copy-last: copy last AI text to clipboard
    const unsubCopyLast = eventBus.subscribe(AppEvent.CopyLastMessage, async () => {
      const msgs = messages();
      for (let i = msgs.length - 1; i >= 0; i--) {
        const msg = msgs[i]!;
        if (msg.role === "assistant" && msg.parts) {
          const textParts = msg.parts.filter((p) => p.type === "text") as TextPart[];
          if (textParts.length > 0) {
            const text = textParts.map((p) => p.text).join("\n");
            try {
              const { writeClipboard } = await import("../../core/io/clipboard");
              const ok = await writeClipboard(text);
              if (ok) {
                eventBus.publish(AppEvent.Toast, { message: "已复制到剪贴板", variant: "success" });
              } else {
                eventBus.publish(AppEvent.Toast, { message: "未知错误", variant: "error" });
              }
            } catch {
              eventBus.publish(AppEvent.Toast, { message: "未知错误", variant: "error" });
            }
            return;
          }
        }
        if (msg.role === "assistant" && msg.content) {
          try {
            const { writeClipboard } = await import("../../core/io/clipboard");
            const ok = await writeClipboard(msg.content);
            if (ok) {
              eventBus.publish(AppEvent.Toast, { message: "已复制到剪贴板", variant: "success" });
            } else {
              eventBus.publish(AppEvent.Toast, { message: "未知错误", variant: "error" });
            }
          } catch {
            eventBus.publish(AppEvent.Toast, { message: "未知错误", variant: "error" });
          }
          return;
        }
      }
      eventBus.publish(AppEvent.Toast, { message: "无数据", variant: "info" });
    });

    onCleanup(() => {
      handler.destroy();
      unsubChunk();
      unsubReasoning();
      unsubMessageSent();
      unsubConversationTool();
      unsubTool();
      unsubResult();
      unsubToolsChanged();
      unsubAgentSelected();
      unsubLog();
      unsubAborted();
      unsubToolTimeout();
      unsubLlmRetry();
      unsubCopyLast();
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
      }
      if (reasoningFlushTimer !== null) {
        clearTimeout(reasoningFlushTimer);
      }
    });

    const send = async (content: string) => {
      if (!content.trim() || loading()) {
        return;
      }

      // Guard: cancel any pending flush from a previous interaction
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
        if (chunkBuffer.length > 0) {
          streamingParts.push(...chunkBuffer);
          chunkBuffer = [];
          setStreamingText(streamingParts.join(""));
        }
      }
      if (reasoningFlushTimer !== null) {
        clearTimeout(reasoningFlushTimer);
        reasoningFlushTimer = null;
        if (reasoningBuffer.length > 0) {
          setStreamingReasoning((prev) => prev + reasoningBuffer.join(""));
          reasoningBuffer = [];
        }
      }

      const startTime = Date.now();
      log.debug(`发送消息: ${content.trim().slice(0, 40)}...`);
      activeAbortController = new AbortController();
      handler.setAbortSignal(activeAbortController.signal);

      // 追加用户消息
      setMessages((prev) =>
        appendMessage(prev, {
          content: content.trim(),
          id: nextId(),
          role: "user",
        }),
      );

      setLoading(true);
      if (props.sessionId) {
        setSessionStatus(props.sessionId, "busy", "user_message");
      }
      streamingParts = [];
      streamingJoinedLen = 0;
      setStreamingText("");
      reasoningBuffer = [];
      setStreamingReasoning("");

      try {
        const flushPendingStreamBuffers = () => {
          if (flushTimer !== null) {
            clearTimeout(flushTimer);
            flushTimer = null;
          }
          if (chunkBuffer.length > 0) {
            streamingParts.push(...chunkBuffer);
            chunkBuffer = [];
            setStreamingText(streamingParts.join(""));
          }
          if (reasoningFlushTimer !== null) {
            clearTimeout(reasoningFlushTimer);
            reasoningFlushTimer = null;
          }
          if (reasoningBuffer.length > 0) {
            setStreamingReasoning((prev) => prev + reasoningBuffer.join(""));
            reasoningBuffer = [];
          }
        };

        const appendConversationResult = (result: ConversationResult) => {
          flushPendingStreamBuffers();

          const accumulated = streamingText();
          const finalText = result.text || accumulated;
          const finalReasoning = result.reasoning || streamingReasoning();

          if (result.text && accumulated && result.text !== accumulated) {
            log.warn(`流式文本与最终文本不一致: stream=${accumulated.length}chars, result=${result.text.length}chars`);
          }

          const parts: ChatMessagePart[] = [];
          if (finalReasoning) {
            parts.push({ text: finalReasoning, type: "thinking" });
          }
          if (finalText) {
            parts.push({ text: finalText, type: "text" });
          }

          if (!result.ok) {
            if (finalText) {
              const assistantMessage: ChatMessage = {
                content: finalText,
                id: nextId(),
                parts: parts.length > 0 ? parts : undefined,
                role: "assistant",
              };
              setMessages((prev) => appendMessage(prev, assistantMessage));
              if (props.sessionId) {
                addMessage(props.sessionId, "assistant", chatMessageToParts(assistantMessage));
              }
            }
            if (result.error) {
              const errorMessage: ChatMessage = {
                content: `⚠ ${result.error}`,
                id: nextId(),
                isError: true,
                role: "system",
              };
              setMessages((prev) => appendMessage(prev, errorMessage));
              if (props.sessionId) {
                addTextMessage(props.sessionId, "system", errorMessage.content);
              }
            }
          } else if (finalText) {
            const assistantMessage: ChatMessage = {
              content: finalText,
              id: nextId(),
              parts: parts.length > 0 ? parts : undefined,
              role: "assistant",
            };
            setMessages((prev) => appendMessage(prev, assistantMessage));
            if (props.sessionId) {
              addMessage(props.sessionId, "assistant", chatMessageToParts(assistantMessage));
            }
          } else {
            log.debug(`空回复: ok=${result.ok}, toolRounds=${result.toolRounds}`);
          }

          streamingParts = [];
          streamingJoinedLen = 0;
          setStreamingText("");
          reasoningBuffer = [];
          setStreamingReasoning("");

          return { finalReasoning, finalText };
        };

        let result: ConversationResult = await handler.sendMessage(content.trim());
        let lastRendered = appendConversationResult(result);
        let continuationCount = 0;

        while (result.ok && result.goalContinuation && continuationCount < MAX_GOAL_CONTINUATIONS) {
          continuationCount++;
          log.info(`Goal 自动续接 #${continuationCount}`);
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          result = await handler.sendMessage(GOAL_AUTO_CONTINUATION_INPUT);
          lastRendered = appendConversationResult(result);
        }

        if (result.goalContinuation && continuationCount >= MAX_GOAL_CONTINUATIONS) {
          log.warn(`Goal 自动续接达到安全上限 (${MAX_GOAL_CONTINUATIONS})，停止续接`);
        }

        const elapsed = Date.now() - startTime;
        log.debug(
          `对话完成: ${elapsed}ms, ok=${result.ok}, toolRounds=${result.toolRounds}, textLen=${lastRendered.finalText.length}, reasoningLen=${lastRendered.finalReasoning?.length ?? 0}`,
        );
      } catch (error) {
        const isAbort = error instanceof Error && error.name === "AbortError";

        if (isAbort) {
          // 中断: 保存部分流式文本为 interrupted 消息
          const partialText = streamingText();
          const partialReasoning = streamingReasoning();

          if (partialText || partialReasoning) {
            log.info(`用户中断: 保存部分回复 (text=${partialText.length}, reasoning=${partialReasoning.length})`);
            const parts: ChatMessagePart[] = [];
            if (partialReasoning) {
              parts.push({ text: partialReasoning, type: "thinking" });
            }
            if (partialText) {
              parts.push({ text: partialText, type: "text" });
            }
            const interruptedMsg: ChatMessage = {
              content: partialText || "",
              id: nextId(),
              interrupted: true,
              parts: parts.length > 0 ? parts : undefined,
              role: "assistant",
            };
            setMessages((prev) => appendMessage(prev, interruptedMsg));
            if (props.sessionId) {
              addMessage(props.sessionId, "assistant", chatMessageToParts(interruptedMsg));
            }
          }
        } else {
          log.error(`致命错误: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
          if (props.sessionId) {
            setSessionStatus(props.sessionId, "error", error instanceof Error ? error.message : String(error));
          }
          const fatalMessage: ChatMessage = {
            content: `✗ 致命错误: ${error instanceof Error ? error.message : String(error)}`,
            id: nextId(),
            isError: true,
            role: "system",
          };
          setMessages((prev) => appendMessage(prev, fatalMessage));
          if (props.sessionId) {
            addTextMessage(props.sessionId, "system", fatalMessage.content);
          }
        }
      } finally {
        setLoading(false);
        activeAbortController = null;
        handler.setAbortSignal(undefined);
        if (props.sessionId) {
          // Error 状态由 catch 设置，finally 仅重置 busy/retry → idle
          const status = getSessionStatus(props.sessionId);
          if (status === "busy" || status === "retry") {
            setSessionStatus(props.sessionId, "idle", "无头模式完成");
          }
        }
        streamingParts = [];
        streamingJoinedLen = 0;
        setStreamingText("");
        reasoningBuffer = [];
        setStreamingReasoning("");
      }
    };

    const interrupt = (): boolean => {
      if (!loading() || !activeAbortController || activeAbortController.signal.aborted) {
        return false;
      }
      activeAbortController.abort();
      return true;
    };

    const clear = () => {
      handler.clearHistory();
      setMessages([]);
      messageUndo.clearStacks();
    };

    /** 切换 Agent — 销毁旧 Handler，创建新 Handler */
    const switchAgent = (name: string): boolean => {
      if (loading()) {
        log.warn(`Agent 切换被拒绝: 对话正在进行中`);
        return false;
      }
      const success = setAgentActive(name);
      if (success) {
        setCurrentAgentName(name);
        setCurrentMode(getEffectiveMode());
        setCurrentYolo(getYoloOverlay());
        // 销毁旧 handler 并重建(使用新 Agent 的 prompt、steps 和工具白名单)
        handler.destroy();
        const overrides = getRuntimeOverrides();
        handler = new chatContextDeps.ConversationHandler(config, {
          allowedTools: overrides.allowedTools,
          initialMessages: getInitialMessages(),
          maxToolRounds: overrides.maxToolRounds,
          mode: getEffectiveMode(),
          modelId: overrides.modelId,
          providerId: overrides.providerId,
          sessionId: props.sessionId,
          systemPrompt: overrides.systemPrompt,
          temperature: overrides.temperature,
          topP: overrides.topP,
        });
        handler.getPermissionManager().approve("fs.read", "**");
        // 注入 App 配置到 Team 执行器(用于队友的 LLM 调用)
        if (name === "team-lead") {
          teamExecutor.setAppConfig(config);
        }
        log.info(`Agent 已切换: ${name}，Handler 已重建`);
      }
      return success;
    };

    /** 直接添加系统消息(不走 LLM，用于 Shell 模式等) */
    const addSystemMessage = (content: string) => {
      const systemMessage: ChatMessage = {
        content,
        id: nextId(),
        role: "system",
      };
      setMessages((prev) => appendMessage(prev, systemMessage));
      if (props.sessionId) {
        addTextMessage(props.sessionId, "system", content);
      }
    };

    return {
      addSystemMessage,
      agentInfo: () => getActiveAgent(),
      agentName: currentAgentName,
      canRedo: () => !loading() && messageUndo.canRedo(),
      canUndo: () => !loading() && messageUndo.canUndo(),
      clear,
      getConversationHistory: () => handler?.getMessages() ?? [],
      interrupt,
      loading,
      messages,
      mode: currentMode,
      redo: () => !loading() && messageUndo.redo(),
      send,
      streamingReasoning,
      streamingText,
      switchAgent,
      undo: () => !loading() && messageUndo.undo(),
      yoloOverlay: currentYolo,
    };
  },
  name: "Chat",
});

export const useChat = chatContext.use;
export const ChatProvider = chatContext.provider;
