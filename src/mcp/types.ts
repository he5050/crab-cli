/**
 * MCP 模块域类型 — 集中存放 MCP 协议层相关的领域类型定义。
 *
 * 设计目标:
 *   - 解除 `src/bus/events` 对 MCP 模块的深层依赖
 *   - 事件层只通过 type-only import 引用具体形状,避免循环依赖
 */

/** MCP 服务器运行时状态条目 */
export interface McpServerStatusItem {
  name: string;
  state: "connected" | "connecting" | "disconnected" | "error" | "disabled";
  toolCount: number;
  type: "stdio" | "sse" | "http";
  enabled: boolean;
  source: "global" | "project";
  configPath: string;
  error?: string;
  disabledTools: string[];
  toolNames: string[];
  supportsOAuth: boolean;
  authStatus: "unsupported" | "not_authenticated" | "authenticated" | "expired";
  connectDurationMs?: number;
  tag: "builtin" | "external";
}
