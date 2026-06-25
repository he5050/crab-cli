/**
 * MCP 相关事件 — 服务器运行时状态与工具列表变更。
 *
 * 职责:定义 MCP 协议层向上暴露的事件。
 * 边界:McpServerStatusItem 由 src/mcp/types.ts 定义,本文件仅引用。
 */
import { defineEvent } from "../core";
import type { McpServerStatusItem } from "@/mcp/types";

export const McpEvents = {
  /** MCP 运行时状态更新 */
  McpStatusUpdated: defineEvent<{
    servers: McpServerStatusItem[];
    builtinGroups: McpServerStatusItem[];
  }>("mcp.status.updated"),

  /** MCP 工具列表变更通知(tools/list_changed) */
  ToolsListChanged: defineEvent<{
    serverName: string;
    toolCount: number;
    added: string[];
    removed: string[];
  }>("mcp.tools.list.changed"),
} as const;
