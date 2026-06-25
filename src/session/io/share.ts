/**
 * 会话分享 — 将会话导出为可分享的 JSON/Markdown/TXT/HTML 文件。
 *
 * 职责:
 *   - 导出会话为 JSON / Markdown / TXT / HTML 格式
 *   - 保存到 ~/.crab/shares/ 目录
 *   - 生成可访问的本地分享链接
 *
 * 模块功能:
 *   - shareSession:分享会话
 *   - getShareData:获取分享数据
 *   - listShares:列出所有分享
 *   - deleteShare:删除分享
 *
 * 使用场景:
 *   - 导出会话分享给他人
 *   - 生成可访问的本地分享链接
 *   - 管理分享记录
 *
 * 边界:
 *   1. 分享文件存储在 ~/.crab/shares/ 目录
 *   2. 支持 JSON、Markdown、TXT、HTML 四种格式
 *   3. 自动生成唯一分享 ID
 *   4. 包含会话元数据
 *
 * 流程:
 *   1. 调用 shareSession 创建分享
 *   2. 生成分享文件到指定目录
 *   3. 返回分享结果(ID、路径等)
 *   4. 使用 listShares 管理分享记录
 */
import path from "node:path";
import fs from "node:fs/promises";
import { getDataDir } from "@/config";
import { createLogger } from "@/core/logging/logger";
import {
  type NormalizedExportFormat,
  serializeSessionAsHtml,
  serializeSessionAsJson,
  serializeSessionAsMarkdown,
  serializeSessionAsText,
} from "./exporter";
import type { MessageRecord, MessageRole } from "../core/message";
import { createId } from "@/core/identity";

const log = createLogger("session:share");

// ─── 类型 ─────────────────────────────────────────────────

export interface ShareMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

export interface ShareData {
  id: string;
  title: string;
  createdAt: number;
  exportedAt: number;
  messages: ShareMessage[];
  metadata?: {
    model?: string;
    provider?: string;
    messageCount?: number;
  };
}

export interface ShareResult {
  id: string;
  format: NormalizedExportFormat;
  path: string;
  size: number;
}

type ShareMessageInput = ShareMessage | MessageRecord;
type ShareFormat = NormalizedExportFormat | "md";

// ─── 辅助函数 ──────────────────────────────────────────────

function getSharesDir(): string {
  return path.join(getDataDir(), "shares");
}

import { prefixedId } from "@/core/id";

/** 分享 ID 生成 */
function generateShareId(): string {
  return prefixedId("share");
}

async function ensureSharesDir(): Promise<void> {
  await fs.mkdir(getSharesDir(), { recursive: true });
}

// ─── 导出 JSON ─────────────────────────────────────────────

function normalizeMessages(messages: ShareMessageInput[], shareId: string): MessageRecord[] {
  return messages.map((message, index) => {
    if ("parts" in message) {
      return message;
    }

    return {
      createdAt: message.timestamp,
      id: `${shareId}_msg_${index}`,
      parts: [{ content: message.content, type: "text" }],
      role: message.role as MessageRole,
      sessionId: shareId,
    };
  });
}

export async function exportSessionAsJson(
  messages: ShareMessageInput[],
  metadata?: ShareData["metadata"],
): Promise<ShareResult> {
  const id = generateShareId();
  const title = `会话 ${new Date().toLocaleString("zh-CN")}`;
  const normalized = normalizeMessages(messages, id);

  await ensureSharesDir();
  const filePath = path.join(getSharesDir(), `${id}.json`);
  const content = serializeSessionAsJson(title, id, normalized);
  // 将 metadata 写入 JSON，供后续解析使用
  const enriched = JSON.parse(content) as Record<string, unknown>;
  if (metadata) {
    enriched.metadata = metadata;
  }
  await fs.writeFile(filePath, JSON.stringify(enriched, null, 2), "utf8");

  log.info(`会话已导出为 JSON: ${filePath}`);
  return { format: "json", id, path: filePath, size: Buffer.byteLength(JSON.stringify(enriched), "utf8") };
}

// ─── 导出 Markdown ──────────────────────────────────────────

export async function exportSessionAsMarkdown(
  messages: ShareMessageInput[],
  metadata?: ShareData["metadata"],
): Promise<ShareResult> {
  const id = generateShareId();
  const title = `会话 ${new Date().toLocaleString("zh-CN")}`;
  const normalized = normalizeMessages(messages, id);

  await ensureSharesDir();
  const filePath = path.join(getSharesDir(), `${id}.md`);
  const content = serializeSessionAsMarkdown(title, normalized);
  await fs.writeFile(filePath, content, "utf8");

  log.info(`会话已导出为 Markdown: ${filePath}`);
  return { format: "markdown", id, path: filePath, size: content.length };
}

// ─── 导出 TXT ───────────────────────────────────────────────

export async function exportSessionAsText(
  messages: ShareMessageInput[],
  metadata?: ShareData["metadata"],
): Promise<ShareResult> {
  const id = generateShareId();
  const title = `会话 ${new Date().toLocaleString("zh-CN")}`;
  const normalized = normalizeMessages(messages, id);

  await ensureSharesDir();
  const filePath = path.join(getSharesDir(), `${id}.txt`);
  const content = serializeSessionAsText(title, normalized);
  await fs.writeFile(filePath, content, "utf8");

  log.info(`会话已导出为 TXT: ${filePath}`);
  return { format: "txt", id, path: filePath, size: content.length };
}

// ─── 导出 HTML ──────────────────────────────────────────────

export async function exportSessionAsHtml(
  messages: ShareMessageInput[],
  metadata?: ShareData["metadata"],
): Promise<ShareResult> {
  const id = generateShareId();
  const title = `会话 ${new Date().toLocaleString("zh-CN")}`;
  const normalized = normalizeMessages(messages, id);

  await ensureSharesDir();
  const filePath = path.join(getSharesDir(), `${id}.html`);
  const content = serializeSessionAsHtml(title, normalized);
  await fs.writeFile(filePath, content, "utf8");

  log.info(`会话已导出为 HTML: ${filePath}`);
  return { format: "html", id, path: filePath, size: content.length };
}

// ─── 主入口 ────────────────────────────────────────────────

export async function shareSession(
  messages: ShareMessageInput[],
  options?: {
    format?: ShareFormat;
    metadata?: ShareData["metadata"];
  },
): Promise<ShareResult> {
  const format = options?.format === "md" ? "markdown" : (options?.format ?? "markdown");

  if (format === "json") {
    return exportSessionAsJson(messages, options?.metadata);
  }
  if (format === "txt") {
    return exportSessionAsText(messages, options?.metadata);
  }
  if (format === "html") {
    return exportSessionAsHtml(messages, options?.metadata);
  }
  return exportSessionAsMarkdown(messages, options?.metadata);
}

// ─── 列出分享 ──────────────────────────────────────────────

export async function listShares(): Promise<{ id: string; format: string; path: string; size: number }[]> {
  const dir = getSharesDir();
  try {
    await fs.access(dir);
  } catch {
    return [];
  }

  const files = await fs.readdir(dir);
  const results: { id: string; format: string; path: string; size: number }[] = [];

  for (const file of files) {
    if (!file.endsWith(".json") && !file.endsWith(".md") && !file.endsWith(".txt") && !file.endsWith(".html")) {
      continue;
    }
    const filePath = path.join(dir, file);
    const stat = await fs.stat(filePath);
    const format = file.endsWith(".json")
      ? "json"
      : file.endsWith(".txt")
        ? "txt"
        : file.endsWith(".html")
          ? "html"
          : "markdown";
    results.push({
      format,
      id: file.replace(/\.(json|md|txt|html)$/, ""),
      path: filePath,
      size: stat.size,
    });
  }

  return results.toSorted((a, b) => b.path.localeCompare(a.path));
}
