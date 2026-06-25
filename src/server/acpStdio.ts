/**
 * ACP Stdio 传输模块 — ACP Agent 标准输入输出通信桥接
 *
 * 职责:
 *   - 基于 @agentclientprotocol/sdk 实现标准 ACP Agent
 *   - 使用 stdin/stdout JSON-RPC 2.0 通信
 *   - 桥接 ConversationHandler 实现会话管理
 *
 * 模块功能:
 *   - startAcpStdio: 启动 ACP Stdio 服务，建立 JSON-RPC 连接
 *   - CrabCliAgent: 实现 acp.Agent 接口，处理会话生命周期
 *
 * 使用场景:
 *   - CLI 工具通过 stdio 与 ACP 兼容客户端通信
 *   - 外部工具通过标准协议调用 Agent 服务
 *
 * 边界:
 * 1. 仅支持 stdio 传输，不含 HTTP 服务端点
 * 2. 会话生命周期与 ConversationHandler 一致
 * 3. 当前为 MVP 实现，prompt 返回完整文本块
 *
 * 流程:
 * 1. 客户端通过 stdin 发送 JSON-RPC 请求
 * 2. Agent 处理请求并通过 stdout 返回响应
 * 3. 会话更新通过 session/update 通知实时推送
 */

import * as acp from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";
import { uuid } from "@/core/id";
import { createLogger } from "@/core/logging/logger";
import { createSessionError } from "@/core/errors/appError";
import { loadConfig } from "@/config";
import { ConversationHandler } from "@/conversation";
import { VERSION } from "@/config/version";
import { ensureMcpRuntimeStarted } from "@/mcp/manager/runtime";
import { initTaskRuntime } from "@/mission";
import type { AppConfigSchema } from "@/schema/config";
import { globalBus, type EventBus } from "@/bus";
import { AppEvent } from "@/bus";
import { type RuntimeEventInput, createRuntimeEvent, toAcpSessionUpdate } from "@/bus";
import { getSessionMessages, messageRecordsToModelMessages } from "@/session";

const log = createLogger("acp-stdio");

const acpStdioDeps = {
  ConversationHandler,
  ensureMcpRuntimeStarted,
  loadConfig,
};

export function __setAcpStdioDepsForTesting(overrides: Partial<typeof acpStdioDeps>): void {
  Object.assign(acpStdioDeps, overrides);
}

export function __resetAcpStdioDepsForTesting(): void {
  acpStdioDeps.loadConfig = loadConfig;
  acpStdioDeps.ConversationHandler = ConversationHandler;
  acpStdioDeps.ensureMcpRuntimeStarted = ensureMcpRuntimeStarted;
}

interface StdioSession {
  handler: ConversationHandler;
  abortController: AbortController;
  config: AppConfigSchema;
  sessionId: string;
}

/**
 * 启动 ACP Stdio 服务。
 * 使用 @agentclientprotocol/sdk 的 AgentSideConnection 处理 JSON-RPC 2.0 通信。
 */
export async function startAcpStdio(): Promise<void> {
  initTaskRuntime(process.cwd());
  await acpStdioDeps.ensureMcpRuntimeStarted();

  log.info("ACP Stdio 服务启动", { version: VERSION });

  const output = Writable.toWeb(process.stdout);
  const input = Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>;
  const stream = acp.ndJsonStream(output, input);

  const connection = new acp.AgentSideConnection((conn) => new CrabCliAgent(conn), stream);

  connection.signal.addEventListener("abort", () => {
    log.info("ACP 连接关闭，清理所有会话");
    for (const session of CrabCliAgent.sessions.values()) {
      session.abortController.abort();
    }
  });

  await connection.closed;
  log.info("ACP Stdio 服务已退出");
}

class CrabCliAgent implements acp.Agent {
  static sessions = new Map<string, StdioSession>();
  private connection: acp.AgentSideConnection;
  private readonly eventBus: EventBus;

  constructor(connection: acp.AgentSideConnection, eventBus: EventBus = globalBus) {
    this.connection = connection;
    this.eventBus = eventBus;
  }

  async initialize(_params: acp.InitializeRequest): Promise<acp.InitializeResponse> {
    return {
      agentCapabilities: {
        promptCapabilities: {},
        sessionCapabilities: {
          close: {},
        },
      },
      agentInfo: {
        name: "crab-cli",
        version: VERSION,
      },
      protocolVersion: acp.PROTOCOL_VERSION,
    };
  }

  async newSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    const config = await acpStdioDeps.loadConfig();
    const abortController = new AbortController();
    const sessionId = uuid();
    const handler = new acpStdioDeps.ConversationHandler(config, {
      abortSignal: abortController.signal,
      initialMessages: messageRecordsToModelMessages(getSessionMessages(sessionId)),
      sessionId,
    });

    CrabCliAgent.sessions.set(sessionId, { abortController, config, handler, sessionId });

    log.info(`ACP 会话创建: ${sessionId}`, { cwd: params.cwd });
    return { sessionId };
  }

  async closeSession(params: acp.CloseSessionRequest): Promise<acp.CloseSessionResponse | void> {
    const session = CrabCliAgent.sessions.get(params.sessionId);
    if (session) {
      session.abortController.abort();
      CrabCliAgent.sessions.delete(params.sessionId);
      log.info(`ACP 会话关闭: ${params.sessionId}`);
    }
    return {};
  }

  async authenticate(_params: acp.AuthenticateRequest): Promise<acp.AuthenticateResponse | void> {
    return {};
  }

  async ping(_params: Record<string, unknown>): Promise<{ ok: true }> {
    return { ok: true };
  }

  async loadSession(params: acp.LoadSessionRequest): Promise<acp.LoadSessionResponse> {
    const config = await acpStdioDeps.loadConfig();
    const abortController = new AbortController();
    const handler = new acpStdioDeps.ConversationHandler(config, {
      abortSignal: abortController.signal,
      initialMessages: messageRecordsToModelMessages(getSessionMessages(params.sessionId)),
      sessionId: params.sessionId,
    });

    CrabCliAgent.sessions.set(params.sessionId, {
      abortController,
      config,
      handler,
      sessionId: params.sessionId,
    });

    const loadedUpdate = toAcpSessionUpdate(
      createRuntimeEvent({
        sessionId: params.sessionId,
        type: "session.loaded",
      }),
    );
    if (loadedUpdate) {
      await this.connection.sessionUpdate(loadedUpdate);
    }
    log.info(`ACP 会话加载: ${params.sessionId}`, { cwd: params.cwd });
    return {};
  }

  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    const session = CrabCliAgent.sessions.get(params.sessionId);
    if (!session) {
      throw createSessionError("SESSION_NOT_FOUND", `Session ${params.sessionId} not found`);
    }

    const pendingRuntimeUpdates: Promise<void>[] = [];
    const forwardedToolCompletions = new Set<string>();
    const publishRuntimeUpdate = async (input: RuntimeEventInput) => {
      const update = toAcpSessionUpdate(createRuntimeEvent(input));
      if (update) {
        await this.connection.sessionUpdate(update);
      }
    };
    const queueRuntimeUpdate = (input: RuntimeEventInput) => {
      if (input.type === "tool.call.completed") {
        forwardedToolCompletions.add(input.toolCallId);
      }
      pendingRuntimeUpdates.push(publishRuntimeUpdate(input));
    };

    const queueMissingToolResultUpdatesFromHistory = () => {
      for (const item of this.eventBus.getHistory({ type: AppEvent.ToolResult.type })) {
        const props = item.payload.properties as {
          sessionId?: string;
          tool?: string;
          callId?: string;
          result?: unknown;
          success?: boolean;
        };
        if (props.sessionId !== params.sessionId || !props.callId || forwardedToolCompletions.has(props.callId)) {
          continue;
        }
        queueRuntimeUpdate({
          name: props.tool ?? "tool",
          result: props.result,
          sessionId: params.sessionId,
          success: props.success !== false,
          toolCallId: props.callId,
          type: "tool.call.completed",
        });
      }
    };

    const unsubscribers = [
      this.eventBus.subscribe(AppEvent.ConversationStreamToken, (evt) => {
        if (evt.properties.sessionId !== params.sessionId) {
          return;
        }
        queueRuntimeUpdate({
          messageId: params.sessionId,
          sessionId: params.sessionId,
          text: evt.properties.content,
          type: "assistant.delta",
        });
      }),
      this.eventBus.subscribe(AppEvent.ConversationToolCall, (evt) => {
        if (evt.properties.sessionId !== params.sessionId) {
          return;
        }
        queueRuntimeUpdate({
          input: evt.properties.args,
          name: evt.properties.tool,
          sessionId: params.sessionId,
          toolCallId: evt.properties.callId,
          type: "tool.call.started",
        });
      }),
      this.eventBus.subscribe(AppEvent.ToolResult, (evt) => {
        if (evt.properties.sessionId !== params.sessionId) {
          return;
        }
        queueRuntimeUpdate({
          name: evt.properties.tool,
          result: evt.properties.result,
          sessionId: params.sessionId,
          success: evt.properties.success,
          toolCallId: evt.properties.callId,
          type: "tool.call.completed",
        });
      }),
    ];

    try {
      const text = extractTextFromContentBlocks(params.prompt);

      await this.connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          content: { text: "Processing...", type: "text" },
          sessionUpdate: "agent_message_chunk",
        },
      });

      const result = await session.handler.sendMessage(text);

      await this.eventBus.flush();
      queueMissingToolResultUpdatesFromHistory();
      await Promise.all(pendingRuntimeUpdates);

      await this.connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          content: { text: result.text, type: "text" },
          sessionUpdate: "agent_message_chunk",
        },
      });

      return { stopReason: "end_turn" };
    } catch (error) {
      if (session.abortController.signal.aborted) {
        return { stopReason: "cancelled" };
      }
      throw error;
    } finally {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
      if (session.abortController.signal.aborted) {
        const abortController = new AbortController();
        session.abortController = abortController;
        session.handler = new acpStdioDeps.ConversationHandler(session.config, {
          abortSignal: abortController.signal,
          initialMessages: messageRecordsToModelMessages(getSessionMessages(session.sessionId)),
          sessionId: session.sessionId,
        });
      }
    }
  }

  async cancel(params: acp.CancelNotification): Promise<void> {
    const session = CrabCliAgent.sessions.get(params.sessionId);
    session?.abortController.abort();
  }
}

function extractTextFromContentBlocks(blocks: unknown[]): string {
  return blocks
    .map((block) => {
      if (
        block &&
        typeof block === "object" &&
        "type" in block &&
        (block as { type: string }).type === "text" &&
        "text" in block
      ) {
        return (block as { text: string }).text;
      }
      return JSON.stringify(block);
    })
    .join("\n");
}
