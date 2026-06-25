/**
 * 对话导出器 — 支持 txt/md/html/json 格式
 *
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ─── 类型 ──────────────────────────────────────────────────

export type ExportFormat = "txt" | "md" | "html" | "json";

interface ExportMessage {
  role: string;
  content: string;
  timestamp?: number;
  reasoning?: string;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: string;
  imageCount?: number;
}

// ─── HTML 样式 ────────────────────────────────────────────────

const HTML_STYLE = `\
<style>
:root { --bg: #1e1e2e; --text: #cdd6f4; --user: #79c0ff; --assistant: #7ee787; --tool: #b0b0b0; --reasoning: #7c7ca0; --border: #333; --muted: #666; }
@media (prefers-color-scheme: light) { :root { --bg: #ffffff; --text: #333; --user: #0066cc; --assistant: #333; --tool: #666; --reasoning: #888; --border: #ddd; --muted: #999; } }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: "SF Mono", Menlo, monospace; background: var(--bg); color: var(--text); line-height: 1.6; padding: 2rem; max-width: 80ch; }
.header { text-align: center; padding-bottom: 1rem; border-bottom: 1px solid var(--border); margin-bottom: 2rem; }
.header h1 { font-size: 1.2rem; }
.message { margin-bottom: 1.5rem; padding: 0.75rem 1rem; border-radius: 6px; border: 1px solid var(--border); }
.message.user { background: rgba(121,192,255,0.08); }
.message.assistant { background: rgba(126,231,135,0.08); }
.role { font-weight: 600; font-size: 0.85rem; text-transform: uppercase; color: var(--muted); margin-bottom: 0.25rem; }
.content { white-space: pre-wrap; word-break: break-word; }
.reasoning { background: rgba(124,124,192,0.06); padding: 0.5rem; border-radius: 4px; margin-top: 0.5rem; font-size: 0.8rem; color: var(--reasoning); }
.tool { background: rgba(176,176,176,0.08); padding: 0.5rem; border-radius: 4px; margin-top: 0.5rem; font-size: 0.8rem; }
.tool-name { color: var(--tool); font-weight: 600; }
.footer { text-align: center; padding-top: 1rem; border-top: 1px solid var(--border); margin-top: 2rem; color: var(--muted); font-size: 0.75rem; }
</style>`;

// ─── 工具函数 ──────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatTime(ts?: number): string {
  if (!ts) return "";
  return new Date(ts).toLocaleString();
}

function tryPrettyJson(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}

// ─── 格式化器 ──────────────────────────────────────────────────

function formatAsText(messages: ExportMessage[]): string {
  const lines: string[] = [];
  lines.push("═".repeat(60));
  lines.push("  Crab CLI Conversation Export");
  lines.push(formatTime());
  lines.push("═".repeat(60));

  for (const msg of messages) {
    const ts = msg.timestamp ? ` [${formatTime(msg.timestamp)}]` : "";
    lines.push(`\n[${msg.role.toUpperCase()}]${ts}`);
    lines.push(msg.content);

    if (msg.reasoning) {
      lines.push("\n  [THINKING]");
      lines.push(msg.reasoning);
    }
    if (msg.toolName) {
      const args = typeof msg.toolArgs === "string" ? msg.toolArgs : tryPrettyJson(JSON.stringify(msg.toolArgs ?? ""));
      lines.push(`\n  [TOOL] ${msg.toolName}`);
      lines.push(`    args: ${args}`);
    }
    if (msg.toolResult) {
      const result = msg.toolResult.length > 2000 ? msg.toolResult.slice(0, 2000) + "…" : msg.toolResult;
      lines.push(`\n  [RESULT] ${result}`);
    }
  }

  lines.push("\n" + "═".repeat(60));
  return lines.join("\n");
}

function formatAsMarkdown(messages: ExportMessage[]): string {
  const lines: string[] = [];
  lines.push("# Crab CLI Conversation Export\n");

  const first = messages[0];
  if (first?.timestamp) {
    lines.push(`> Exported: ${formatTime(first.timestamp)}\n`);
  }

  for (const msg of messages) {
    const role = msg.role === "user" ? "👤 User" : msg.role === "assistant" ? "🤖 Crab" : msg.role;
    lines.push(`## ${role}\n`);
    lines.push(msg.content);

    if (msg.reasoning) {
      lines.push("<details><summary>💭 Thinking</summary>");
      lines.push("");
      lines.push(msg.reasoning);
      lines.push("</details>\n");
    }
    if (msg.toolName) {
      const args = typeof msg.toolArgs === "string" ? msg.toolArgs : tryPrettyJson(JSON.stringify(msg.toolArgs ?? ""));
      lines.push(`**Tool:** \`${msg.toolName}\``);
      lines.push(`**Args:** \`${args}\`\n`);
    }
    if (msg.toolResult) {
      const result = msg.toolResult.length > 3000 ? msg.toolResult.slice(0, 3000) + "…" : msg.toolResult;
      lines.push(`<details><summary>Result</summary>`);
      lines.push("```json");
      lines.push(result);
      lines.push("```\n");
      lines.push("</details>\n");
    }

    lines.push("---\n");
  }

  return lines.join("\n");
}

function formatAsHtml(messages: ExportMessage[]): string {
  const bodyParts: string[] = [];

  for (const msg of messages) {
    const roleClass = msg.role;
    let body = "";
    if (msg.reasoning) {
      body += `<div class="reasoning">${escapeHtml(msg.reasoning)}</div>`;
    }
    body += `<div class="content">${escapeHtml(msg.content)}</div>`;
    if (msg.toolName) {
      body += `<div class="tool"><span class="tool-name">${escapeHtml(msg.toolName)}</span></div>`;
    }
    if (msg.toolResult) {
      const result = msg.toolResult.length > 3000 ? msg.toolResult.slice(0, 3000) + "…" : msg.toolResult;
      body += `<div class="tool"><span class="tool-name">Result</span>: <code>${escapeHtml(result)}</code></div>`;
    }

    bodyParts.push(`	<div class="message ${roleClass}"><div class="role">${escapeHtml(msg.role)}</div>${body}</div>`);
  }

  const body = bodyParts.join("\n");
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Crab CLI Export</title>${HTML_STYLE}</head><body><div class="header"><h1>Crab CLI Conversation Export</h1></div><main>${body}</main><div class="footer">Exported by Crab CLI</div></body></html>`;
}

function formatAsJson(messages: ExportMessage[]): string {
  return JSON.stringify(messages, null, 2);
}

// ─── 公开 API ──────────────────────────────────────────────────

export function renderExport(messages: ExportMessage[], format: ExportFormat): string {
  switch (format) {
    case "md":
      return formatAsMarkdown(messages);
    case "html":
      return formatAsHtml(messages);
    case "json":
      return formatAsJson(messages);
    case "txt":
    default:
      return formatAsText(messages);
  }
}

/** 导出对话到文件 */
export function exportToFile(messages: ExportMessage[], filePath: string, format: ExportFormat = "md"): void {
  const content = renderExport(messages, format);
  const dir = filePath.substring(0, filePath.lastIndexOf("/")) || ".";
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, content, "utf-8");
}

/** 自动生成文件名（基于时间戳） */
export function autoExportPath(format: ExportFormat = "md"): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = join(homedir(), ".crab", "exports");
  return join(dir, `conversation-${ts}.${format}`);
}

/** 将 crab 消息格式转换为 ExportMessage */
export function toExportMessages(
  messages: Array<{ role: string; content: unknown; [key: string]: unknown }>,
): ExportMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    timestamp: typeof m.timestamp === "number" ? m.timestamp : Date.now(),
    toolName: typeof m.toolName === "string" ? m.toolName : undefined,
    toolArgs: m.toolArgs,
    toolResult: typeof m.toolResult === "string" ? m.toolResult : undefined,
  }));
}
