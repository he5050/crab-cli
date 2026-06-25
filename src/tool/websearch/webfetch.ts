/**
 * 网页抓取工具 — 抓取 URL 内容并转为 Markdown。
 *
 * 职责:
 *   - 抓取 URL 内容
 *   - HTML 自动转 Markdown
 *   - 支持纯文本、JSON 格式
 *   - 控制响应大小和超时
 *
 * 模块功能:
 *   - webFetchTool: 网页抓取工具定义
 *   - HTML 转 Markdown
 *   - 支持 GET/POST 方法
 *   - 自定义请求头
 *
 * 使用场景:
 *   - AI 需要获取网页内容
 *   - 抓取 API 响应
 *   - 获取文档页面
 *   - 不适合搜索(搜索用 websearch)
 *
 * 边界:
 *   1. 权限:websearch
 *   2. 最大响应大小 1MB
 *   3. 默认超时 10 秒
 *   4. 支持 HTML、纯文本、JSON
 *   5. HTML 自动提取正文
 *
 * 流程:
 *   1. 接收 URL 和参数
 *   2. 发送 HTTP 请求
 *   3. 接收响应内容
 *   4. 根据格式处理内容
 *   5. 返回处理后的内容
 */
import { z } from "zod";
import { defineTool } from "@/tool/types";
import { createLogger } from "@/core/logging/logger";
import { stripHtmlTags } from "@/tool/shared";

const log = createLogger("tool:webfetch");

/** 最大响应大小(1MB) */
const MAX_RESPONSE_SIZE = 1_000_000;

/** POST 请求体最大大小(512KB)，防止 AI 向外部服务发送超大请求 */
const MAX_REQUEST_BODY_SIZE = 512_000;

/** 默认超时(10 秒) */
const DEFAULT_TIMEOUT = 10_000;

/** 安全敏感头部，禁止通过自定义 headers 覆盖 */
const BLOCKED_HEADERS = new Set([
  "host",
  "authorization",
  "origin",
  "referer",
  "cookie",
  "set-cookie",
  "connection",
  "content-length",
  "content-encoding",
  "transfer-encoding",
  "proxy-authorization",
  "proxy-connection",
]);

/**
 * 校验 fetch 目标 URL 是否安全（防范 SSRF 攻击）。
 *
 * 拒绝的地址段:
 *   - 回环地址: 127.0.0.0/8, ::1
 *   - 链路本地: 169.254.0.0/16
 *   - 私有网段: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 *   - 云元数据: 169.254.169.254
 *   - 非公网协议: 仅允许 http: 和 https:
 *
 * @throws Error 校验失败时抛出异常
 */
/** validateFetchUrl 的实现 */
export function validateFetchUrl(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`无效的 URL: ${rawUrl}`);
  }

  // 仅允许 http 和 https 协议
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`请求目标地址不在允许范围内: ${rawUrl}（仅允许 http/https 协议）`);
  }

  const hostname = parsed.hostname.toLowerCase();

  // IPv6 回环地址
  if (hostname === "::1" || hostname === "[::1]") {
    throw new Error(`请求目标地址不在允许范围内: ${rawUrl}`);
  }

  // IPv4 各类保留地址段校验
  if (isPrivateOrReservedIp(hostname)) {
    throw new Error(`请求目标地址不在允许范围内: ${rawUrl}`);
  }
}

/**
 * 判断 IP 是否属于私有/保留地址段。
 * 支持纯 IPv4 地址和 IPv4 映射的 IPv6 格式 (::ffff:x.x.x.x)。
 */
/** isPrivateOrReservedIp 的实现 */
export function isPrivateOrReservedIp(hostname: string): boolean {
  // 提取纯 IPv4 部分（处理 ::ffff:x.x.x.x 格式）
  const ipv4 = hostname.startsWith("::ffff:") ? hostname.slice(7) : hostname;

  // 如果不是 IP 地址（包含域名），则放行
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ipv4)) {
    return false;
  }

  const parts = ipv4.split(".").map(Number);
  if (parts.some((p) => p < 0 || p > 255 || isNaN(p))) {
    return false;
  }

  const [a = 0, b = 0, _c = 0, _d = 0] = parts;

  // 127.0.0.0/8 — 回环地址
  if (a === 127) return true;

  // 10.0.0.0/8 — A 类私有地址
  if (a === 10) return true;

  // 172.16.0.0/12 — B 类私有地址
  if (a === 172 && b >= 16 && b <= 31) return true;

  // 192.168.0.0/16 — C 类私有地址
  if (a === 192 && b === 168) return true;

  // 169.254.0.0/16 — 链路本地地址（含云元数据 169.254.169.254）
  if (a === 169 && b === 254) return true;

  // 0.0.0.0/8 — 当前网络
  if (a === 0) return true;

  // 224.0.0.0/4 — 组播地址
  if (a >= 224 && a <= 239) return true;

  return false;
}

/**
 * 过滤自定义请求头，移除安全敏感头部。
 * 返回过滤后的 headers 对象。
 */
/** sanitizeHeaders 的实现 */
export function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!BLOCKED_HEADERS.has(key.toLowerCase())) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/** 网页抓取工具：抓取网页内容并转为 Markdown */
export const webFetchTool = defineTool({
  description:
    "抓取网页内容。支持 HTML(自动转 Markdown)、纯文本、JSON。" +
    "用于获取网页、API 响应、文档页面的内容。" +
    "不适合搜索，搜索请使用 websearch 工具。",
  execute: async ({ url, method, headers, body, timeout, format }) => {
    // SSRF 防护：校验目标 URL
    try {
      validateFetchUrl(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`SSRF 校验拒绝: ${url}`, { reason: msg });
      return { success: false, url, error: msg };
    }

    const effectiveTimeout = timeout ?? DEFAULT_TIMEOUT;
    const effectiveFormat = format ?? "auto";

    try {
      log.info(`抓取: ${url}`);
      const effectiveMethod = method ?? "GET";

      // 过滤安全敏感头部
      const safeHeaders = headers ? sanitizeHeaders(headers) : {};

      const fetchOptions: RequestInit = {
        headers: {
          Accept: "text/html,application/json,text/plain,*/*",
          "User-Agent": "CrabCLI/0.5.0 (AI Assistant)",
          ...safeHeaders,
        },
        method: effectiveMethod,
        signal: AbortSignal.timeout(effectiveTimeout),
      };

      if (body && effectiveMethod === "POST") {
        // P2-8: POST 请求体大小限制，防止 DoS
        if (body.length > MAX_REQUEST_BODY_SIZE) {
          return {
            error: `POST 请求体过大: ${body.length} 字节，最大允许 ${MAX_REQUEST_BODY_SIZE} 字节`,
            success: false,
            url,
          };
        }
        fetchOptions.body = body;
      }

      const response = await fetch(url, fetchOptions);

      if (!response.ok) {
        return {
          success: false,
          url,
          ...(response.url !== url && { finalUrl: response.url }),
          statusCode: response.status,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const contentType = response.headers.get("content-type") ?? "";
      const finalUrl = response.url !== url ? response.url : undefined;
      const content = await response.text();

      if (content.length > MAX_RESPONSE_SIZE) {
        const truncated = content.slice(0, MAX_RESPONSE_SIZE);
        return {
          success: true,
          url,
          ...(finalUrl && { finalUrl }),
          contentType,
          statusCode: response.status,
          content: processContent(truncated, contentType, effectiveFormat),
          truncated: true,
          totalSize: content.length,
        };
      }

      return {
        success: true,
        url,
        ...(finalUrl && { finalUrl }),
        contentType,
        statusCode: response.status,
        content: processContent(content, contentType, effectiveFormat),
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error(`抓取失败: ${url}`, { error: msg });
      return { error: msg, success: false, url };
    }
  },
  name: "webfetch",
  parameters: z.object({
    /** 请求体(POST 时使用) */
    body: z.string().optional().describe("请求体(POST 时使用)"),
    /** 提取模式:auto(自动检测)、text(纯文本)、json(JSON) */
    format: z.enum(["auto", "text", "json"]).optional().describe("内容格式:auto(自动检测)、text(纯文本)、json(JSON)"),
    /** 请求头 */
    headers: z.record(z.string(), z.string()).optional().describe("自定义请求头"),
    /** 请求方法 */
    method: z.enum(["GET", "POST"]).optional().describe("HTTP 方法，默认 GET"),
    /** 超时时间(毫秒) */
    timeout: z.number().optional().describe("超时时间(毫秒)，默认 10000"),
    /** 要抓取的 URL */
    url: z.string().describe("要抓取的 URL"),
  }),
  permission: "websearch",
  builtin: true,
});

/** 根据内容类型处理响应内容 */
function processContent(content: string, contentType: string, format: string): string {
  // 强制指定格式
  if (format === "json") {
    try {
      return JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      return content;
    }
  }

  if (format === "text") {
    return content;
  }

  // Auto 模式:根据 content-type 检测
  if (contentType.includes("application/json")) {
    try {
      return JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      return content;
    }
  }

  if (contentType.includes("text/html")) {
    return htmlToMarkdown(content);
  }

  // 纯文本或其他
  return content;
}

/** 简易 HTML → Markdown 转换 */
function htmlToMarkdown(html: string): string {
  let text = html;

  // 移除 script/style
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, "");
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, "");
  text = text.replace(/<header[\s\S]*?<\/header>/gi, "");

  // 提取 <title>
  const titleMatch = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1]?.trim();

  // 提取 <meta description>
  const descMatch = text.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*?)["']/i);
  const description = descMatch?.[1]?.trim();

  // 尝试提取 <main> 或 <article>
  const mainMatch = text.match(/<(?:main|article)[^>]*>([\s\S]*?)<\/(?:main|article)>/i);
  let bodyContent = mainMatch?.[1] ?? text;

  // 标题
  for (let i = 1; i <= 6; i++) {
    const re = new RegExp(`<h${i}[^>]*>([\\s\\S]*?)</h${i}>`, "gi");
    bodyContent = bodyContent.replace(re, (_, content) => {
      const clean = stripHtmlTags(content).trim();
      return `\n${"#".repeat(i)} ${clean}\n`;
    });
  }

  // 段落
  bodyContent = bodyContent.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, c) => `\n${stripHtmlTags(c).trim()}\n`);

  // 链接
  bodyContent = bodyContent.replace(
    /<a[^>]*href=["']([^"']*?)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_, href, text) => `[${stripHtmlTags(text).trim()}](${href})`,
  );

  // 代码块
  bodyContent = bodyContent.replace(
    /<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi,
    (_, code) => `\n\`\`\`\n${stripHtmlTags(code).trim()}\n\`\`\`\n`,
  );

  // 行内代码
  bodyContent = bodyContent.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, code) => `\`${stripHtmlTags(code)}\``);

  // 列表
  bodyContent = bodyContent.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, c) => `- ${stripHtmlTags(c).trim()}`);

  // 加粗/斜体
  bodyContent = bodyContent.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, "**$2**");
  bodyContent = bodyContent.replace(/<(em|i)[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, "*$2*");

  // 移除所有剩余标签
  let result = stripHtmlTags(bodyContent);

  // 清理多余空白
  result = result.replace(/\n{3,}/g, "\n\n").trim();

  // 加上前缀信息
  const parts: string[] = [];
  if (title) {
    parts.push(`# ${title}`);
  }
  if (description) {
    parts.push(`> ${description}\n`);
  }
  parts.push(result);

  // 截断统一由 executor truncateByTokenLimit 处理
  return parts.join("\n\n");
}
