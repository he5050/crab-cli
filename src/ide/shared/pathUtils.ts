/**
 * IDE 共享路径/常量工具 — 跨模块复用。
 */

import path from "node:path";
import { getGlobalTmpDir } from "@/config";

/** IDE 端口信息文件路径 */
export const IDE_PORTS_FILE = path.join(getGlobalTmpDir(), "ide", "crab-ide-ports.json");

/** IDE WebSocket token 文件路径 */
export const WS_TOKEN_FILE = path.join(getGlobalTmpDir(), "ide", "crab-ide-ws-token.json");

// ─── 路径规范化 ────────────────────────────────────────────────

/** 路径规范化(跨平台一致比较): 反斜杠→正斜杠, Windows 盘符小写。 */
export function normalizePath(filePath: string): string {
  let normalized = filePath.replace(/\\/g, "/");
  if (/^[A-Z]:/.test(normalized)) {
    normalized = normalized.charAt(0).toLowerCase() + normalized.slice(1);
  }
  return normalized;
}

// ─── IDE CLI 命令映射 ──────────────────────────────────────────

/** IDE 命令行工具名称映射 */
export const IDE_CLI_COMMANDS: Record<string, string> = {
  Cursor: "cursor",
  VSCode: "code",
  "VSCode Insiders": "code-insiders",
};
