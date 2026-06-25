/**
 * 工具 Diff 路由管理 — 构建和管理 diff 查看器的路由数据。
 *
 * 职责:
 *   - 从工具调用中提取 diff 数据
 *   - 从会话消息中收集所有 diff 来源
 *   - 管理 diff 缓存
 *   - 构建 diff 路由
 *
 * 模块功能:
 *   - ToolDiffRouteData: 工具 diff 路由数据
 *   - SessionDiffRouteData: 会话 diff 路由数据
 *   - SessionDiffCacheEntry: 缓存条目
 *   - buildToolDiffRouteData: 从工具调用构建 diff 数据
 *   - buildToolDiffRoute: 构建工具 diff 路由
 *   - buildSessionDiffRouteData: 从会话构建 diff 数据
 *   - buildSessionDiffRoute: 构建会话 diff 路由
 *   - getOrBuildSessionDiffCacheEntry: 获取或构建缓存条目
 *   - clearSessionDiffCache: 清理缓存
 *
 * 使用场景:
 *   - diff 查看器路由
 *   - 会话 diff 展示
 *   - diff 缓存管理
 *
 * 边界:
 *   1. 仅构建路由数据，不涉及 UI 渲染
 *   2. 依赖 pluginDiffModel 解析 diff
 *   3. 依赖 toolRenderSpec 提取工具 diff
 *   4. 缓存按 sessionId:updatedAt 键值管理
 *
 * 流程:
 *   1. 从消息中收集所有 diff 来源
 *   2. 解析 diff 并生成统计摘要
 *   3. 构建缓存条目
 *   4. 生成路由供 UI 使用
 */
import type { ChatMessage, ToolPart } from "@/ui/contexts/chat";
import type { Route } from "@/ui/contexts/route";
import { type MessageRecord, messagePartsToChatParts, messageRoleToChatRole } from "@/session";
import { type DiffSummary, parseDiffFiles, summarizeDiffFiles } from "@/ui/pages/pluginDiffModel";
import { getToolDiff, getToolFiles, getToolInput } from "./tools/toolRenderSpec";

export interface ToolDiffRouteData {
  diff: string;
  filename?: string;
  selectedFile?: string;
  source: "tool";
  tool: string;
  callId?: string;
}

export interface SessionDiffRouteData {
  diff: string;
  filename?: string;
  selectedFile?: string;
  source: "session";
  label: string;
  sources: (ToolDiffRouteData & { id: string; label: string })[];
}

export interface SessionDiffCacheEntry {
  key: string;
  sessionId: string;
  updatedAt?: number;
  routeData: SessionDiffRouteData;
  summary: DiffSummary;
  summaryText: string;
  sourceCount: number;
  createdAt: number;
}

export interface SessionDiffCacheInput {
  sessionId: string;
  updatedAt?: number;
  messages: readonly MessageRecord[];
}

const sessionDiffCache = new Map<string, SessionDiffCacheEntry>();

export function buildToolDiffRouteData(part: ToolPart): ToolDiffRouteData | undefined {
  const diff = getToolDiff(part);
  if (!diff?.trim()) {
    return undefined;
  }

  const files = getToolFiles(part);
  const input = getToolInput(part);
  const filename = firstString(files[0]?.path, input["filePath"], input["file_path"], input["path"]);

  return {
    diff,
    filename,
    selectedFile: filename,
    source: "tool",
    tool: part.tool,
    ...(part.callId ? { callId: part.callId } : {}),
  };
}

export function buildToolDiffRoute(part: ToolPart, returnRoute?: Route): Route | undefined {
  const data = buildToolDiffRouteData(part);
  if (!data) {
    return undefined;
  }
  return { data: { ...data }, id: "diff", type: "plugin", ...(returnRoute ? { returnRoute } : {}) };
}

export function buildSessionDiffRouteData(messages: ChatMessage[]): SessionDiffRouteData | undefined {
  const toolSources = collectToolDiffSources(messages);
  if (toolSources.length === 0) {
    return undefined;
  }

  const diff = toolSources
    .map((source) => source.diff.trim())
    .filter(Boolean)
    .join("\n");
  const first = toolSources[0];

  return {
    diff,
    filename: first?.filename,
    label: "session diff",
    selectedFile: first?.selectedFile,
    source: "session",
    sources: toolSources,
  };
}

export function buildSessionDiffRoute(messages: ChatMessage[], returnRoute?: Route): Route | undefined {
  const data = buildSessionDiffRouteData(messages);
  if (!data) {
    return undefined;
  }
  return { data: { ...data }, id: "diff", type: "plugin", ...(returnRoute ? { returnRoute } : {}) };
}

export function buildSessionDiffRouteDataFromRecords(
  messages: readonly MessageRecord[],
): SessionDiffRouteData | undefined {
  return buildSessionDiffRouteData(
    messages.map((message) => ({
      content: "",
      id: message.id,
      parts: messagePartsToChatParts(message.parts),
      role: messageRoleToChatRole(message.role),
    })),
  );
}

export function getSessionDiffCacheKey(sessionId: string, updatedAt?: number): string {
  return `${sessionId}:${updatedAt ?? "live"}`;
}

export function getCachedSessionDiff(sessionId: string, updatedAt?: number): SessionDiffCacheEntry | undefined {
  return sessionDiffCache.get(getSessionDiffCacheKey(sessionId, updatedAt));
}

export function clearSessionDiffCache(sessionId?: string): void {
  if (!sessionId) {
    sessionDiffCache.clear();
    return;
  }
  for (const key of sessionDiffCache.keys()) {
    if (key === sessionId || key.startsWith(`${sessionId}:`)) {
      sessionDiffCache.delete(key);
    }
  }
}

export function buildSessionDiffCacheEntry(input: SessionDiffCacheInput): SessionDiffCacheEntry | undefined {
  const routeData = buildSessionDiffRouteDataFromRecords(input.messages);
  if (!routeData) {
    return undefined;
  }
  const summary = summarizeDiffFiles(parseDiffFiles(routeData.diff));
  const fileCount = summary.files || 1;
  return {
    key: getSessionDiffCacheKey(input.sessionId, input.updatedAt),
    sessionId: input.sessionId,
    ...(input.updatedAt !== undefined ? { updatedAt: input.updatedAt } : {}),
    routeData,
    summary,
    summaryText: `${fileCount} file${fileCount > 1 ? "s" : ""} · +${summary.additions} -${summary.deletions}`,
    sourceCount: routeData.sources.length,
    createdAt: Date.now(),
  };
}

export function getOrBuildSessionDiffCacheEntry(input: SessionDiffCacheInput): SessionDiffCacheEntry | undefined {
  const key = getSessionDiffCacheKey(input.sessionId, input.updatedAt);
  const cached = sessionDiffCache.get(key);
  if (cached) {
    return cached;
  }

  const entry = buildSessionDiffCacheEntry(input);
  clearSessionDiffCache(input.sessionId);
  if (entry) {
    sessionDiffCache.set(key, entry);
  }
  return entry;
}

function collectToolDiffSources(messages: ChatMessage[]): (ToolDiffRouteData & { id: string; label: string })[] {
  const sources: (ToolDiffRouteData & { id: string; label: string })[] = [];

  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (part.type !== "tool") {
        continue;
      }
      const data = buildToolDiffRouteData(part);
      if (!data) {
        continue;
      }
      const index = sources.length + 1;
      sources.push({
        ...data,
        id: data.callId ?? `tool-${index}`,
        label: `${data.tool} diff${data.filename ? ` · ${data.filename}` : ""}`,
      });
    }
  }

  return sources;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}
