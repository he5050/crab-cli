/**
 * 请求执行器 — Route 系统的请求执行引擎。
 *
 * 职责:
 *   - 根据 Route 构建完整 HTTP 请求
 *   - 通过传输层发送请求
 *   - 解析响应并返回结构化结果
 *   - 支持流式和非流式响应
 *
 * 使用场景:
 *   - Route 系统中执行 LLM API 请求
 *   - Provider 适配层通过执行器发送请求
 *
 * 边界:
 *   1. 仅执行 Route 描述的请求，不做重试和降级
 *   2. 重试策略由上层 retry 模块处理
 *   3. 响应解析支持 JSON 和 SSE 流式格式
 */

import type { Route } from "./route";
import { buildAuthHeaders } from "./route";
import { buildUrl, mergeHeaders } from "./endpoint";
import type { TransportResponse } from "./transport";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("route:executor");

/** 执行结果 */
export interface ExecuteResult {
  /** HTTP 状态码 */
  status: number;
  /** 响应头 */
  headers: Record<string, string>;
  /** 响应体（JSON 解析后的对象或原始文本） */
  data: unknown;
  /** 原始响应体文本 */
  rawBody: string;
  /** 是否成功 */
  ok: boolean;
  /** 关联的 Route ID */
  routeId: string;
}

/** SSE 事件 */
export interface SseEvent {
  /** 事件类型 */
  event?: string;
  /** 事件数据 */
  data: string;
  /** 事件 ID */
  id?: string;
}

/**
 * 执行 Route 请求（非流式）。
 */
export async function executeRoute(route: Route, abortSignal?: AbortSignal): Promise<ExecuteResult> {
  const url = buildUrl(route.endpoint);
  const authHeaders = buildAuthHeaders(route.auth);
  const contentType = route.body.contentType ?? "application/json";

  const headers = mergeHeaders({ "Content-Type": contentType }, route.endpoint.headers, authHeaders);

  const body = JSON.stringify(route.body.json);

  log.debug(`执行 Route 请求: ${route.id} → ${url}`, {
    routeId: route.id,
    method: route.method,
    url,
  });

  const response = await route.transport.send({
    url,
    method: route.method ?? "POST",
    headers,
    body,
    abortSignal,
    timeoutMs: route.timeoutMs,
  });

  return parseResponse(response, route.id);
}

/**
 * 执行 Route 请求（流式 SSE）。
 * 返回异步生成器，逐个 yield SSE 事件。
 */
export async function* executeRouteStream(
  route: Route,
  abortSignal?: AbortSignal,
): AsyncGenerator<SseEvent | ExecuteResult> {
  const url = buildUrl(route.endpoint);
  const authHeaders = buildAuthHeaders(route.auth);
  const contentType = route.body.contentType ?? "application/json";

  const headers = mergeHeaders(
    { Accept: "text/event-stream", "Content-Type": contentType },
    route.endpoint.headers,
    authHeaders,
  );

  const body = JSON.stringify(route.body.json);

  log.debug(`执行 Route 流式请求: ${route.id} → ${url}`, {
    routeId: route.id,
    method: route.method,
    url,
  });

  const response = await route.transport.send({
    url,
    method: route.method ?? "POST",
    headers,
    body,
    abortSignal,
    timeoutMs: route.timeoutMs,
  });

  if (!response.ok) {
    yield parseResponse(response, route.id);
    return;
  }

  // 解析 SSE 流
  yield* parseSseStream(response.body, route.id);
}

/** 解析 HTTP 响应为 ExecuteResult */
function parseResponse(response: TransportResponse, routeId: string): ExecuteResult {
  let data: unknown = undefined;
  const rawBody = response.body;

  if (rawBody) {
    try {
      data = JSON.parse(rawBody);
    } catch {
      data = rawBody;
    }
  }

  return {
    data,
    headers: response.headers,
    ok: response.ok,
    rawBody,
    routeId,
    status: response.status,
  };
}

/** 解析 SSE 流文本为事件生成器 */
async function* parseSseStream(body: string, routeId: string): AsyncGenerator<SseEvent> {
  const lines = body.split("\n");
  let currentEvent: string | undefined;
  let currentData: string[] = [];
  let currentId: string | undefined;

  for (const line of lines) {
    if (line.startsWith(":")) {
      // 注释行，跳过
      continue;
    }

    if (line === "") {
      // 空行表示事件结束
      if (currentData.length > 0) {
        yield {
          data: currentData.join("\n"),
          ...(currentEvent !== undefined ? { event: currentEvent } : {}),
          ...(currentId !== undefined ? { id: currentId } : {}),
        };
      }
      currentEvent = undefined;
      currentData = [];
      currentId = undefined;
      continue;
    }

    if (line.startsWith("event:")) {
      currentEvent = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      currentData.push(line.slice(5).trim());
    } else if (line.startsWith("id:")) {
      currentId = line.slice(3).trim();
    }
  }

  // 处理流末尾可能残留的最后一个事件
  if (currentData.length > 0) {
    yield {
      data: currentData.join("\n"),
      ...(currentEvent !== undefined ? { event: currentEvent } : {}),
      ...(currentId !== undefined ? { id: currentId } : {}),
    };
  }

  log.debug(`SSE 流解析完成: ${routeId}`);
}
