/**
 * 会话导出器 — 将会话导出为 Markdown、JSON、TXT 或 HTML。
 *
 * 职责:
 *   - 格式化会话数据
 *   - 输出为 Markdown 或 JSON 文件
 *   - 支持多种导出格式
 *
 * 模块功能:
 *   - exportSession:导出会话为指定格式
 *   - serializeSessionAsMarkdown:将会话序列化为 Markdown
 *   - serializeSessionAsJson:将会话序列化为 JSON
 *   - serializeSessionAsText:将会话序列化为纯文本
 *   - serializeSessionAsHtml:将会话序列化为 HTML
 *
 * 使用场景:
 *   - 导出会话历史备份
 *   - 分享会话内容
 *   - 迁移会话数据
 *
 * 边界:
 *   1. 仅导出逻辑，不涉及 UI
 *   2. 支持 Markdown、JSON、TXT、HTML 四种格式
 *   3. 导出文件包含完整会话历史
 *   4. 不包含会话检查点数据
 *
 * 流程:
 *   1. 获取会话信息和消息历史
 *   2. 根据格式选择序列化方式
 *   3. 写入到指定文件路径
 *   4. 返回导出结果
 */
import { createLogger } from "@/core/logging/logger";
import { getSession } from "../core/session";
import { type MessageRecord, getSessionMessages } from "../core/message";
import { writeFileSync } from "node:fs";
import { escapeHtml } from "@/tool/shared/html";

const log = createLogger("session:exporter");

/** 导出格式。`md` 是 `markdown` 的兼容别名。 */
export type ExportFormat = "markdown" | "md" | "json" | "txt" | "html";
export type NormalizedExportFormat = "markdown" | "json" | "txt" | "html";

/** 导出结果 */
export interface ExportResult {
  /** 导出文件路径 */
  path: string;
  /** 导出格式 */
  format: NormalizedExportFormat;
  /** 导出的消息数量 */
  messageCount: number;
  /** 文件大小(字节) */
  size: number;
}

export function serializeSessionAsMarkdown(title: string, messages: MessageRecord[]): string {
  return formatAsMarkdown(title, messages);
}

export function serializeSessionAsJson(title: string, sessionId: string, messages: MessageRecord[]): string {
  return formatAsJson(title, sessionId, messages);
}

export function serializeSessionAsText(title: string, messages: MessageRecord[]): string {
  return formatAsText(title, messages);
}

export function serializeSessionAsHtml(title: string, messages: MessageRecord[]): string {
  return formatAsHtml(title, messages);
}

/**
 * 导出会话为指定格式。
 */
export function exportSession(sessionId: string, outputPath: string, format: ExportFormat): ExportResult | null {
  const normalizedFormat = normalizeExportFormat(format);
  if (!normalizedFormat) {
    log.warn(`导出失败:不支持的格式 ${String(format)}`);
    return null;
  }

  const session = getSession(sessionId);
  if (!session) {
    log.warn(`导出失败:会话不存在 ${sessionId}`);
    return null;
  }

  const msgs = getSessionMessages(sessionId);
  if (msgs.length === 0) {
    log.warn(`导出失败:会话无消息 ${sessionId}`);
    return null;
  }

  let content: string;
  const title = session.title || `会话 ${session.id.slice(4, 8)}`;

  if (normalizedFormat === "markdown") {
    content = serializeSessionAsMarkdown(title, msgs);
  } else if (normalizedFormat === "json") {
    content = serializeSessionAsJson(session.title || "", session.id, msgs);
  } else if (normalizedFormat === "txt") {
    content = serializeSessionAsText(title, msgs);
  } else {
    content = serializeSessionAsHtml(title, msgs);
  }

  writeFileSync(outputPath, content, "utf8");
  const size = Buffer.byteLength(content, "utf8");

  log.info(`会话已导出: ${outputPath} (${normalizedFormat}, ${msgs.length} 条消息, ${size} 字节)`);

  return {
    format: normalizedFormat,
    messageCount: msgs.length,
    path: outputPath,
    size,
  };
}

function normalizeExportFormat(format: string): NormalizedExportFormat | null {
  if (format === "md") {
    return "markdown";
  }
  if (format === "markdown" || format === "json" || format === "txt" || format === "html") {
    return format;
  }
  return null;
}

/**
 * 格式化为 Markdown。
 */
function formatAsMarkdown(title: string, messages: MessageRecord[]): string {
  const lines: string[] = [];

  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`> 导出时间: ${new Date().toLocaleString("zh-CN")}`);
  lines.push("");

  for (const msg of messages) {
    const time = new Date(msg.createdAt).toLocaleString("zh-CN");
    const roleLabel = {
      assistant: "助手",
      system: "系统",
      tool: "工具",
      user: "用户",
    }[msg.role];

    lines.push(`## ${roleLabel} (${time})`);
    lines.push("");

    for (const part of msg.parts) {
      if (part.type === "text") {
        lines.push(part.content);
        lines.push("");
      } else if (part.type === "tool_use") {
        lines.push(`**工具调用**: \`${part.tool_name}\``);
        lines.push("```");
        lines.push(part.content);
        lines.push("```");
        lines.push("");
      } else if (part.type === "tool_result") {
        lines.push(`**工具结果**:`);
        lines.push("```");
        lines.push(part.content);
        lines.push("```");
        lines.push("");
      } else if (part.type === "thinking") {
        lines.push(`<details>`);
        lines.push(`<summary>思考过程</summary>`);
        lines.push("");
        lines.push(part.content);
        lines.push("");
        lines.push(`</details>`);
        lines.push("");
      }
    }

    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

function roleLabel(role: MessageRecord["role"]): string {
  return {
    assistant: "助手",
    system: "系统",
    tool: "工具",
    user: "用户",
  }[role];
}

function formatPartAsText(part: MessageRecord["parts"][number]): string {
  if (part.type === "text") {
    return part.content;
  }
  if (part.type === "tool_use") {
    return `[工具调用: ${part.tool_name}]\n${part.content}`;
  }
  if (part.type === "tool_result") {
    return `[工具结果]\n${part.content}`;
  }
  if (part.type === "thinking") {
    return `[思考过程]\n${part.content}`;
  }
  return "";
}

/**
 * 格式化为纯文本。
 */
function formatAsText(title: string, messages: MessageRecord[]): string {
  const lines: string[] = [];

  lines.push(`Title: ${title}`);
  lines.push(`Exported At: ${new Date().toISOString()}`);
  lines.push("");

  for (const msg of messages) {
    const time = new Date(msg.createdAt).toISOString();
    lines.push(`## ${roleLabel(msg.role)} (${time})`);
    lines.push("");
    for (const part of msg.parts) {
      const content = formatPartAsText(part);
      if (content) {
        lines.push(content);
        lines.push("");
      }
    }
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * 格式化为 HTML。
 */
function formatAsHtml(title: string, messages: MessageRecord[]): string {
  const body = messages
    .map((msg) => {
      const time = new Date(msg.createdAt).toISOString();
      const parts = msg.parts
        .map((part) => {
          if (part.type === "tool_use") {
            return `<section class="part tool-use"><h3>工具调用: ${escapeHtml(part.tool_name)}</h3><pre>${escapeHtml(part.content)}</pre></section>`;
          }
          if (part.type === "tool_result") {
            return `<section class="part tool-result"><h3>工具结果</h3><pre>${escapeHtml(part.content)}</pre></section>`;
          }
          if (part.type === "thinking") {
            return `<section class="part thinking"><h3>思考过程</h3><pre>${escapeHtml(part.content)}</pre></section>`;
          }
          return `<section class="part text"><pre>${escapeHtml(part.content)}</pre></section>`;
        })
        .join("\n");

      return `<article data-role="${msg.role}">
  <h2>${roleLabel(msg.role)} <time datetime="${time}">${time}</time></h2>
  ${parts}
</article>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p>Exported At: ${new Date().toISOString()}</p>
  ${body}
</body>
</html>`;
}

/**
 * 格式化为 JSON。
 */
function formatAsJson(title: string, sessionId: string, messages: MessageRecord[]): string {
  return JSON.stringify(
    {
      exportedAt: Date.now(),
      messageCount: messages.length,
      messages: messages.map((msg) => ({
        createdAt: msg.createdAt,
        id: msg.id,
        parts: msg.parts,
        role: msg.role,
      })),
      sessionId,
      title,
    },
    null,
    2,
  );
}
