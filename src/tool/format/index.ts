/**
 * 代码格式化工具 — 格式化代码文件。
 *
 * 职责:
 *   - 格式化 TypeScript/JavaScript 代码
 *   - 格式化 JSON 文件
 *   - 格式化 CSS/HTML
 *   - 格式化 Markdown
 *
 * 模块功能:
 *   - formatTool: 代码格式化工具定义
 *   - JSON 格式化(JSON.stringify)
 *   - 基本缩进修正
 *   - 换行符统一
 *
 * 使用场景:
 *   - AI 需要格式化代码文件
 *   - 统一代码风格
 *   - 修复缩进问题
 *   - 格式化配置文件
 *
 * 边界:
 *   1. 支持 TypeScript, JavaScript, JSON, CSS, Markdown, HTML
 *   2. JSON 使用 JSON.stringify 格式化
 *   3. TS/JS/CSS/HTML 使用基本缩进修正
 *   4. 支持单文件格式化
 *   5. 格式化失败时返回错误信息
 *
 * 流程:
 *   1. 接收文件路径
 *   2. 读取文件内容
 *   3. 根据文件类型选择格式化器
 *   4. 执行格式化
 *   5. 写入文件或返回结果
 */
import { z } from "zod";
import { createLogger } from "@/core/logging/logger";
import { defineTool } from "@/tool/types";
import { recordFileMutation } from "@/tool/rollback";

const log = createLogger("tool:format");

// ─── 参数 Schema ───────────────────────────────────────────

const FormatParams = z.object({
  path: z.string().describe("要格式化的文件路径"),
  write: z.boolean().default(true).describe("是否直接写入文件(false 则仅返回格式化结果)"),
});

type FormatParamsType = z.infer<typeof FormatParams>;

// ─── 格式化器 ──────────────────────────────────────────────

function formatJson(content: string): string {
  return `${JSON.stringify(JSON.parse(content), null, 2)}\n`;
}

function formatMarkdown(content: string): string {
  // 基本 Markdown 格式化:统一换行符，去除尾部空白
  return `${content
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, "  ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
}

function detectIndent(content: string): string {
  const lines = content.split("\n");
  for (const line of lines) {
    const match = line.match(/^(\s+)\S/);
    if (match) {
      return match[1]!.includes("\t") ? "\t" : "  ";
    }
  }
  return "  ";
}

function basicFormat(content: string): string {
  // 基本的代码格式化:统一换行符，保持缩进
  const indent = detectIndent(content);
  return `${content
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, indent)
    .replace(/[ \t]+$/gm, "")
    .trimEnd()}\n`;
}

function formatByExtension(content: string, filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();

  switch (ext) {
    case "json": {
      return formatJson(content);
    }
    case "md":
    case "markdown": {
      return formatMarkdown(content);
    }
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "css":
    case "html":
    case "htm":
    case "yaml":
    case "yml":
    case "xml":
    case "svg": {
      return basicFormat(content);
    }
    default: {
      return basicFormat(content);
    }
  }
}

// ─── 工具实现 ──────────────────────────────────────────────

async function execute(params: FormatParamsType): Promise<{ success: boolean; message?: string; error?: string }> {
  const filePath = params.path;
  const { write } = params;

  try {
    const file = Bun.file(filePath);
    const exists = await file.exists();
    if (!exists) {
      return { error: `文件不存在: ${filePath}`, success: false };
    }

    const content = await file.text();
    const formatted = formatByExtension(content, filePath);

    if (!write) {
      const diff = formatted.length - content.length;
      return {
        message: `格式化预览 (${diff >= 0 ? "+" : ""}${diff} 字符):\n${formatted.slice(0, 2000)}${formatted.length > 2000 ? "\n...(截断)" : ""}`,
        success: true,
      };
    }

    const before = content;
    await Bun.write(filePath, formatted);
    try {
      recordFileMutation({
        after: formatted,
        before,
        filePath,
        projectDir: process.cwd(),
        reason: `format: ${content.length} → ${formatted.length} 字符`,
      });
    } catch {
      /* rollback不可用时静默跳过 */
    }
    const diff = formatted.length - content.length;
    log.info(`格式化完成: ${filePath} (${diff >= 0 ? "+" : ""}${diff} 字符)`);
    return {
      message: `已格式化: ${filePath} (${content.length} → ${formatted.length} 字符, ${diff >= 0 ? "+" : ""}${diff})`,
      success: true,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error(`格式化失败: ${filePath} — ${msg}`);
    return { error: `格式化失败: ${msg}`, success: false };
  }
}

// ─── 导出工具定义 ──────────────────────────────────────────

/** 代码格式化工具：支持 TypeScript/JavaScript/JSON/CSS/Markdown/HTML */
export const formatTool = defineTool({
  description: "格式化代码文件，支持 TypeScript/JavaScript/JSON/CSS/Markdown/HTML",
  execute,
  name: "format",
  parameters: FormatParams,
  permission: "format",
  builtin: true,
});

export default formatTool;
