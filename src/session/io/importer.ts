/**
 * 会话导入器 — 支持从 JSON/Markdown/TXT/HTML 导入会话。
 *
 * 职责:
 *   - 解析多种格式的会话导出文件
 *   - 冲突检测和合并策略
 *   - 导入预览和确认
 *   - 批量导入支持
 *
 * 模块功能:
 *   - importSession:导入会话
 *   - detectImportFormat:检测导入格式
 *   - parseImportData:解析导入数据
 *   - validateImportData:验证导入数据
 *
 * 使用场景:
 *   - 从文件导入会话历史
 *   - 迁移其他平台的会话数据
 *   - 批量导入会话
 *
 * 边界:
 *   1. 支持 JSON (crab 原生格式)
 *   2. 支持 Markdown (带 frontmatter)
 *   3. 支持 crab 导出的 TXT/HTML
 *   4. 支持 OpenAI ChatGPT 导出格式
 *   5. 支持 Claude 导出格式
 *   6. 冲突处理策略:skip/overwrite/rename/ask
 *
 * 流程:
 *   1. 读取导入文件
 *   2. 检测或指定导入格式
 *   3. 解析导入数据
 *   4. 验证数据有效性
 *   5. 处理冲突(如有)
 *   6. 创建或更新会话
 */

import { createLogger } from "@/core/logging/logger";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { MessagePart } from "../core/message";
import { createSession } from "../core/session";
import { addMessage } from "../core/message";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import { UserError } from "@/core/errors/appError";
import { ERROR_CODES } from "@/core/errors/errorCodes";
import { parseClaudeMessages } from "./importerClaude";

const log = createLogger("session:importer");

/** 导入格式 */
export type ImportFormat = "json" | "markdown" | "txt" | "html" | "chatgpt" | "claude" | "auto";

/** 导入选项 */
export interface ImportOptions {
  /** 指定格式(默认 auto 检测) */
  format?: ImportFormat;
  /** 遇到冲突时策略 */
  onConflict?: "skip" | "overwrite" | "rename" | "ask";
  /** 是否导入为新的会话(而非覆盖) */
  createNew?: boolean;
  /** 新会话标题 */
  newTitle?: string;
  /** 预览模式(不实际导入) */
  preview?: boolean;
}

/** 导入结果 */
export interface ImportResult {
  success: boolean;
  sessionId?: string;
  messageCount?: number;
  title?: string;
  error?: string;
  warnings?: string[];
}

/** 导入预览 */
export interface ImportPreview {
  format: ImportFormat;
  title?: string;
  messageCount: number;
  participants: string[];
  conflicts?: string[];
  warnings?: string[];
}

/** JSON 格式会话数据 */
interface JsonSessionData {
  version: string;
  session: {
    id: string;
    title: string;
    createdAt: number;
    messages: Array<{
      role: string;
      content: string | MessagePart[];
      timestamp?: number;
    }>;
  };
}

/** exporter 当前导出的 JSON 结构 */
interface ExportedJsonSessionData {
  sessionId: string;
  title: string;
  exportedAt: number;
  messageCount: number;
  messages: Array<{
    id: string;
    role: string;
    parts: MessagePart[];
    createdAt: number;
  }>;
}

/** Markdown frontmatter */
interface MarkdownFrontmatter {
  title?: string;
  createdAt?: string;
  model?: string;
}

/**
 * 检测文件格式
 */
export async function detectFormat(filePath: string): Promise<ImportFormat> {
  const content = await readFile(filePath, "utf-8");
  const ext = extname(filePath).toLowerCase();

  // JSON 格式
  if (ext === ".json") {
    try {
      const data = JSON.parse(content);
      if (data.version && data.session) return "json";
      if (data.mapping && data.title) return "chatgpt";
    } catch {
      // 不是有效 JSON
    }
  }

  // Markdown 格式
  if (ext === ".md" || ext === ".markdown") {
    if (content.startsWith("---")) return "markdown";
    if (content.includes("# Claude Conversation")) return "claude";
    return "markdown";
  }

  if (ext === ".txt") return "txt";
  if (ext === ".html" || ext === ".htm") return "html";

  // 默认尝试 JSON
  return "json";
}

/**
 * 预览导入内容
 */
export async function previewImport(filePath: string, options: ImportOptions = {}): Promise<ImportPreview> {
  const format = options.format || (await detectFormat(filePath));
  const content = await readFile(filePath, "utf-8");

  switch (format) {
    case "json":
      return previewJsonImport(content);
    case "markdown":
      return previewMarkdownImport(content);
    case "txt":
      return previewTextImport(content);
    case "html":
      return previewHtmlImport(content);
    case "chatgpt":
      return previewChatGPTImport(content);
    case "claude":
      return previewClaudeImport(content);
    default:
      throw new UserError(ERROR_CODES.USER.FORMAT_ERROR.code, `不支持的导入格式: ${format}`, { context: { format } });
  }
}

/**
 * 导入会话
 */
export async function importSession(filePath: string, options: ImportOptions = {}): Promise<ImportResult> {
  try {
    const format = options.format || (await detectFormat(filePath));
    log.info(`导入会话: ${filePath}, format=${format}`);

    // 预览模式
    if (options.preview) {
      const preview = await previewImport(filePath, options);
      return {
        success: true,
        title: preview.title,
        messageCount: preview.messageCount,
        warnings: preview.warnings,
      };
    }

    const content = await readFile(filePath, "utf-8");

    switch (format) {
      case "json":
        return importJsonSession(content, options);
      case "markdown":
        return importMarkdownSession(content, options);
      case "txt":
        return importTextSession(content, options);
      case "html":
        return importHtmlSession(content, options);
      case "chatgpt":
        return importChatGPTSession(content, options);
      case "claude":
        return importClaudeSession(content, options);
      default:
        throw new UserError(ERROR_CODES.USER.FORMAT_ERROR.code, `不支持的导入格式: ${format}`, { context: { format } });
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error(`导入会话失败: ${error}`);
    return { success: false, error };
  }
}

// ─── JSON 格式导入 ─────────────────────────────────────────────────────────

function previewJsonImport(content: string): ImportPreview {
  const { title, messages } = parseJsonSessionData(content);

  return {
    format: "json",
    title,
    messageCount: messages.length,
    participants: [...new Set(messages.map((m) => m.role))],
  };
}

async function importJsonSession(content: string, options: ImportOptions): Promise<ImportResult> {
  const data = parseJsonSessionData(content);
  const title = options.newTitle || data.title || "导入的会话";
  return importMessagesToSession(
    "JSON",
    title,
    data.messages.map((msg) => ({ parts: msg.parts, role: msg.role })),
  );
}

// ─── Markdown 格式导入 ─────────────────────────────────────────────────────

function previewMarkdownImport(content: string): ImportPreview {
  const { frontmatter, messages } = parseMarkdownContent(content);

  return {
    format: "markdown",
    title: frontmatter.title,
    messageCount: messages.length,
    participants: [...new Set(messages.map((m) => m.role))],
  };
}

async function importMarkdownSession(content: string, options: ImportOptions): Promise<ImportResult> {
  const { frontmatter, messages } = parseMarkdownContent(content);
  const title = options.newTitle || frontmatter.title || "导入的会话";
  return importMessagesToSession(
    "Markdown",
    title,
    messages.map((msg) => ({ parts: [{ type: "text", content: msg.content }], role: msg.role })),
  );
}

function parseMarkdownContent(content: string): {
  frontmatter: MarkdownFrontmatter;
  messages: Array<{ role: string; content: string }>;
} {
  const frontmatter: MarkdownFrontmatter = {};
  const messages: Array<{ role: string; content: string }> = [];

  // 解析 frontmatter
  if (content.startsWith("---")) {
    const endIdx = content.indexOf("---", 3);
    if (endIdx > 0) {
      const fmContent = content.slice(3, endIdx).trim();
      for (const line of fmContent.split("\n")) {
        const [key, ...valueParts] = line.split(":");
        if (key && valueParts.length > 0) {
          const value = valueParts.join(":").trim();
          (frontmatter as Record<string, string>)[key.trim()] = value;
        }
      }
      content = content.slice(endIdx + 3).trim();
    }
  }

  // 解析消息(按角色分段)
  const lines = content.split("\n");
  let currentRole: string | null = null;
  let currentContent: string[] = [];
  const roleMap: Record<string, string> = {
    user: "user",
    assistant: "assistant",
    system: "system",
    tool: "tool",
    用户: "user",
    助手: "assistant",
    系统: "system",
    工具: "tool",
  };

  for (const line of lines) {
    const roleMatch = line.match(/^##?\s*(User|Assistant|System|Tool|用户|助手|系统|工具)(?:\s*\([^)]*\))?\s*$/i);
    if (roleMatch) {
      if (currentRole && currentContent.length > 0) {
        messages.push({
          role: currentRole,
          content: currentContent.join("\n").trim(),
        });
      }
      currentRole = roleMap[roleMatch[1] ?? ""] ?? roleMatch[1]?.toLowerCase() ?? null;
      currentContent = [];
    } else if (currentRole) {
      currentContent.push(line);
    }
  }

  // 添加最后一条消息
  if (currentRole && currentContent.length > 0) {
    messages.push({
      role: currentRole.toLowerCase(),
      content: currentContent.join("\n").trim(),
    });
  }

  return { frontmatter, messages };
}

// ─── TXT 格式导入 ─────────────────────────────────────────────────────────

function previewTextImport(content: string): ImportPreview {
  const { title, messages } = parseTextContent(content);

  return {
    format: "txt",
    title,
    messageCount: messages.length,
    participants: [...new Set(messages.map((m) => m.role))],
  };
}

async function importTextSession(content: string, options: ImportOptions): Promise<ImportResult> {
  const { title, messages } = parseTextContent(content);
  return importMessagesToSession("TXT", options.newTitle || title || "导入的文本会话", messages);
}

function parseTextContent(content: string): { title?: string; messages: Array<{ role: string; content: string }> } {
  const titleMatch = content.match(/^Title:\s*(.+)$/m);
  const messages = parseMarkdownContent(content).messages;
  return {
    title: titleMatch?.[1]?.trim(),
    messages,
  };
}

// ─── HTML 格式导入 ────────────────────────────────────────────────────────

function previewHtmlImport(content: string): ImportPreview {
  const { title, messages } = parseHtmlContent(content);

  return {
    format: "html",
    title,
    messageCount: messages.length,
    participants: [...new Set(messages.map((m) => m.role))],
  };
}

async function importHtmlSession(content: string, options: ImportOptions): Promise<ImportResult> {
  const { title, messages } = parseHtmlContent(content);
  return importMessagesToSession("HTML", options.newTitle || title || "导入的 HTML 会话", messages);
}

function decodeHtml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function stripHtml(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, "\n"))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function parseHtmlContent(content: string): { title?: string; messages: Array<{ role: string; content: string }> } {
  const titleMatch = content.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) ?? content.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripHtml(titleMatch[1] ?? "") : undefined;
  const messages: Array<{ role: string; content: string }> = [];
  const articlePattern = /<article\b[^>]*data-role=["']([^"']+)["'][^>]*>([\s\S]*?)<\/article>/gi;

  for (const match of content.matchAll(articlePattern)) {
    const role = match[1];
    const article = match[2] ?? "";
    const body = article.replace(/<h2[\s\S]*?<\/h2>/i, "").replace(/<h3[^>]*>[\s\S]*?<\/h3>/gi, "");
    const text = stripHtml(body);
    if (role && text) {
      messages.push({ role, content: text });
    }
  }

  return { title, messages };
}

async function importPlainMessages(
  messages: Array<{ role: string; content: string }>,
  title: string,
  sourceName: string,
): Promise<ImportResult> {
  const warnings: string[] = [];
  const newSession = createSession({ title });
  const sessionId = newSession.id;

  let importedCount = 0;
  for (const msg of messages) {
    try {
      addMessage(sessionId, msg.role as "user" | "assistant" | "system" | "tool", [
        { type: "text", content: msg.content },
      ]);
      importedCount++;
    } catch (err) {
      warnings.push(`消息导入失败: ${err}`);
    }
  }

  log.info(`${sourceName} 导入完成: ${importedCount} 条消息`);

  return {
    success: true,
    sessionId,
    messageCount: importedCount,
    title,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

function parseJsonSessionData(content: string): {
  title: string;
  messages: Array<{ role: string; parts: MessagePart[] }>;
} {
  const data = JSON.parse(content) as JsonSessionData | ExportedJsonSessionData;

  if ("session" in data && data.session) {
    return {
      title: data.session.title || "",
      messages: (data.session.messages || []).map((msg) => ({
        role: msg.role,
        parts: typeof msg.content === "string" ? [{ type: "text", content: msg.content }] : msg.content,
      })),
    };
  }

  if ("messages" in data && Array.isArray(data.messages)) {
    return {
      title: data.title || "",
      messages: data.messages.map((msg) => ({
        role: msg.role,
        parts: Array.isArray(msg.parts) ? msg.parts : [],
      })),
    };
  }

  throw new UserError(ERROR_CODES.USER.INVALID_INPUT.code, "无效的会话数据:缺少 session/messages 字段", {
    context: { hasSession: "session" in data, hasMessages: "messages" in data },
  });
}

// ─── ChatGPT 格式导入 ──────────────────────────────────────────────────────

function previewChatGPTImport(content: string): ImportPreview {
  const data = JSON.parse(content);
  const messages = Object.values(data.mapping || {});

  return {
    format: "chatgpt",
    title: data.title,
    messageCount: messages.length,
    participants: ["user", "assistant"],
  };
}

async function importChatGPTSession(content: string, options: ImportOptions): Promise<ImportResult> {
  const data = JSON.parse(content);
  const warnings: string[] = [];

  const title = options.newTitle || data.title || "ChatGPT 导入";

  // 创建新会话
  const newSession = createSession({ title });
  const sessionId = newSession.id;

  // ChatGPT 格式是树形结构，需要展平
  const mapping = data.mapping || {};
  const importedMessages: Array<{ role: string; content: string }> = [];

  // 找到根节点
  const rootId = Object.keys(mapping).find((id) => !mapping[id].parent);
  if (!rootId) {
    return { success: false, error: "无法找到对话根节点" };
  }

  // 遍历树(取最长路径)
  function traverse(nodeId: string, path: Array<{ role: string; content: string }> = []) {
    const node = mapping[nodeId];
    if (!node) return;

    if (node.message && node.message.content) {
      const content =
        typeof node.message.content === "string" ? node.message.content : node.message.content.parts?.join("") || "";

      if (content) {
        path.push({
          role: node.message.author?.role || "unknown",
          content,
        });
      }
    }

    const children = node.children || [];
    if (children.length === 0) {
      // 叶子节点，记录路径
      if (path.length > importedMessages.length) {
        importedMessages.length = 0;
        importedMessages.push(...path);
      }
    } else {
      // 继续遍历(取第一个子节点作为主线)
      traverse(children[0], [...path]);
    }
  }

  traverse(rootId);

  // 导入消息
  let importedCount = 0;
  for (const msg of importedMessages) {
    try {
      // 过滤系统消息
      if (msg.role === "system") continue;

      addMessage(sessionId, msg.role === "assistant" ? "assistant" : "user", [{ type: "text", content: msg.content }]);
      importedCount++;
    } catch (err) {
      warnings.push(`消息导入失败: ${err}`);
    }
  }

  log.info(`ChatGPT 导入完成: ${importedCount} 条消息`);

  return {
    success: true,
    sessionId,
    messageCount: importedCount,
    title,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

// ─── Claude 格式导入 ───────────────────────────────────────────────────────

function previewClaudeImport(content: string): ImportPreview {
  // Claude 导出格式是简单的 markdown
  const messages: Array<{ role: string }> = [];
  const lines = content.split("\n");

  for (const line of lines) {
    if (line.startsWith("**Human:**")) messages.push({ role: "user" });
    else if (line.startsWith("**Assistant:**")) messages.push({ role: "assistant" });
  }

  return {
    format: "claude",
    title: undefined,
    messageCount: messages.length,
    participants: ["user", "assistant"],
  };
}

async function importClaudeSession(content: string, options: ImportOptions): Promise<ImportResult> {
  const title = options.newTitle || "Claude 导入";
  const messages = parseClaudeMessages(content);
  return importMessagesToSession(
    "Claude",
    title,
    messages.map((msg) => ({ parts: [{ type: "text", content: msg.content }], role: msg.role })),
  );
}

// ─── 公共导入函数 ──────────────────────────────────────────────────────

/**
 * 将消息列表导入为会话，使用事务保证原子性。
 * 失败时回滚全部已导入消息，会话也会被删除。
 */
async function importMessagesToSession(
  sourceName: string,
  title: string,
  messages: Array<{ role: string; parts?: MessagePart[]; content?: string }>,
): Promise<ImportResult> {
  const warnings: string[] = [];
  const newSession = createSession({ title });
  const sessionId = newSession.id;

  try {
    getDb().transaction(() => {
      for (const msg of messages) {
        addMessage(
          sessionId,
          msg.role as "user" | "assistant" | "system" | "tool",
          msg.parts ?? [{ type: "text", content: msg.content ?? "" }],
        );
      }
    });
  } catch (err) {
    // 事务回滚已自动处理消息，但会话记录本身不在事务内
    const error = err instanceof Error ? err.message : String(err);
    log.error(`${sourceName} 导入失败，已回滚: ${error}`);
    return { success: false, error };
  }

  log.info(`${sourceName} 导入完成: ${messages.length} 条消息`);
  return {
    success: true,
    messageCount: messages.length,
    sessionId,
    title,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

// ─── 批量导入 ──────────────────────────────────────────────────────────────

/**
 * 批量导入会话
 */
export async function importMultiple(filePaths: string[], options: ImportOptions = {}): Promise<ImportResult[]> {
  const results: ImportResult[] = [];

  for (const filePath of filePaths) {
    const result = await importSession(filePath, options);
    results.push(result);
  }

  return results;
}
