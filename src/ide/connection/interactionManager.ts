/**
 * IDE 远程交互代理 — 将 IDE 交互请求代理到 crab-cli 处理
 *
 * 职责:
 *   - 接收来自 IDE 的交互请求(diff 审查、代码导航等)
 *   - 代理到对应的工具或处理器
 *   - 收集结果并返回给 IDE
 *   - 管理交互超时和错误处理
 *
 * 模块功能:
 *   - InteractionRequest: 交互请求接口
 *   - InteractionResponse: 交互响应接口
 *   - wireInteractionManager: 将 interactionManager 接线到 wsServer 事件
 *   - registerInteractionHandler: 注册交互处理器
 *   - sendToIDE: 向指定 IDE 客户端发送交互请求
 *   - handleIDERequest: 处理来自 IDE 的交互请求
 *   - broadcastToIDE: 向所有已连接的 IDE 客户端广播交互请求
 *
 * 使用场景:
 *   - VSCode 扩展触发 diff 审查
 *   - 代码定义跳转
 *   - 引用查找
 *   - 符号列表获取
 *
 * 边界:
 * 1. 依赖 wsServer 事件系统
 * 2. 交互请求默认超时 10 秒
 * 3. 需要先注册处理器才能处理对应类型的请求
 *
 * 流程:
 * 1. 调用 wireInteractionManager 建立事件连接
 * 2. 注册交互处理器(registerInteractionHandler)
 * 3. 接收 IDE 请求并路由到对应处理器
 * 4. 返回结果给 IDE 客户端
 */

import { createLogger } from "@/core/logging/logger";
import { createIdeError, toIdeLogPayload } from "@/ide/errors";
import { ideWsServer } from "./wsServer";

const log = createLogger("ide:interaction");

/** 交互请求 */
export interface InteractionRequest {
  /** 交互类型 */
  type: "showDiff" | "closeDiff" | "showGitDiff" | "aceGoToDefinition" | "aceFindReferences" | "aceGetSymbols";
  /** 关联的客户端 ID */
  clientId: string;
  /** 请求参数 */
  params: Record<string, unknown>;
}

/** 交互响应 */
export interface InteractionResponse {
  success: boolean;
  error?: string;
  errorCode?: string;
  data?: unknown;
}

/** 交互处理器 */
type InteractionHandler = (params: Record<string, unknown>) => Promise<unknown>;

const HANDLERS = new Map<string, InteractionHandler>();

/** 是否已接线到 wsServer 事件 */
let wired = false;

/**
 * 将 interactionManager 接线到 wsServer 事件。
 * 调用一次即可，重复调用无副作用。
 */
export function wireInteractionManager(): void {
  if (wired) {
    return;
  }
  wired = true;

  ideWsServer.on<{ clientId: string; type: string; params: Record<string, unknown>; requestId?: string | number }>(
    "interaction-request",
    async ({ clientId, type, params, requestId }) => {
      const response = await handleIDERequest({ clientId, params, type: type as InteractionRequest["type"] });
      // 如果是请求(有 requestId)，返回结果
      if (requestId !== undefined) {
        ideWsServer.sendNotification(clientId, "interaction/response", {
          requestId,
          ...response,
        });
      }
    },
  );

  log.info("interactionManager 已接线到 wsServer");
}

/**
 * 注册交互处理器。
 */
export function registerInteractionHandler(type: string, handler: InteractionHandler): void {
  HANDLERS.set(type, handler);
  log.debug(`已注册交互处理器: ${type}`);
}

export function unregisterInteractionHandler(type: string): void {
  HANDLERS.delete(type);
}

export function _testClearHandlers(): void {
  HANDLERS.clear();
}

/**
 * 向指定 IDE 客户端发送交互请求。
 */
export async function sendToIDE(
  clientId: string,
  type: string,
  params: Record<string, unknown>,
): Promise<InteractionResponse> {
  try {
    const result = await ideWsServer.sendRequest(clientId, type, params, 10_000);
    if (result.data === null) {
      const reasonMsg =
        result.reason === "timeout" ? "请求超时" : result.reason === "disconnected" ? "客户端未连接" : "发送失败";
      const error = createIdeError(
        new Error(`发送失败:${reasonMsg}`),
        {
          clientId,
          operation: "sendToIDE",
          requestType: type,
        },
        "client_missing",
      );
      return { error: error.message, errorCode: error.code, success: false };
    }
    return { data: result.data, success: true };
  } catch (err) {
    const error = createIdeError(
      err,
      {
        clientId,
        operation: "sendToIDE",
        requestType: type,
      },
      "handler",
    );
    log.warn(`IDE 请求发送失败: ${type}`, toIdeLogPayload(error));
    return { error: error.message, errorCode: error.code, success: false };
  }
}

/**
 * 处理来自 IDE 的交互请求。
 * 通过 wsServer 事件系统接收，路由到对应处理器。
 */
export async function handleIDERequest(request: InteractionRequest): Promise<InteractionResponse> {
  const { type, params } = request;

  const handler = HANDLERS.get(type);
  if (!handler) {
    const error = createIdeError(
      new Error(`未支持的交互类型: ${type}`),
      {
        clientId: request.clientId,
        operation: "handleIDERequest",
        requestType: type,
      },
      "unsupported_request",
    );
    log.warn(`未找到交互处理器: ${type}`, toIdeLogPayload(error));
    return { error: error.message, errorCode: error.code, success: false };
  }

  try {
    const result = await handler(params);
    return { data: result, success: true };
  } catch (err) {
    const error = createIdeError(
      err,
      {
        clientId: request.clientId,
        operation: "handleIDERequest",
        requestType: type,
      },
      "handler",
    );
    log.error(`交互处理失败: ${type}`, toIdeLogPayload(error));
    return { error: error.message, errorCode: error.code, success: false };
  }
}

/**
 * 向所有已连接的 IDE 客户端广播交互请求。
 */
export async function broadcastToIDE(
  type: string,
  params: Record<string, unknown>,
): Promise<{ clientId: string; response: InteractionResponse }[]> {
  const clients = ideWsServer.getClients();
  const results: { clientId: string; response: InteractionResponse }[] = [];

  for (const client of clients) {
    const response = await sendToIDE(client.id, type, params);
    results.push({ clientId: client.id, response });
  }

  return results;
}
