/**
 * 工具输出截断模块
 *
 * 职责:
 *   - 对工具执行结果进行长度限制
 *   - 超长输出写入临时文件并返回预览+文件路径提示
 *   - 支持 head/tail 两种截断方向
 *   - 提供流式大文件读取功能
 *
 * 模块功能:
 *   - truncateToolOutput: 截断工具输出
 *   - needsTruncation: 检查是否需要截断
 *   - getTruncateDefaults: 获取默认截断限制
 *   - cleanupTruncationFiles: 清理过期截断文件
 *   - streamReadTruncatedFile: 流式读取截断文件
 *   - countTruncatedFileLines: 统计文件行数
 *
 * 使用场景:
 *   - 工具输出超长时截断
 *   - 保留完整输出到文件供查阅
 *   - 控制 AI 上下文长度
 *   - 分页读取大文件内容
 *
 * 边界:
 *   1. 纯函数 + 文件写入，不涉及 UI 渲染
 *   2. MAX_LINES / MAX_BYTES 双重限制
 *   3. head / tail 两种截断方向
 *   4. 超长自动写文件，保留完整输出供后续查阅
 *   5. 截断文件保留 7 天
 *
 * 流程:
 *   1. 检查输出长度
 *   2. 超长时按方向截断
 *   3. 写入完整内容到临时文件
 *   4. 返回截断预览 + 文件路径
 */
import { createReadStream, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { createLogger } from "@/core/logging/logger";
import { getGlobalTmpDir } from "@/config";
import { ensureDir } from "@/tool/shared/fs";
import { prefixedId } from "@/core/id";

const log = createLogger("tool:truncate");

// ─── 默认限制 ──────────────────────────────────────────────

/** 默认最大行数 */
const DEFAULT_MAX_LINES = 2000;

/** 默认最大字节数 (50KB) */
const DEFAULT_MAX_BYTES = 50 * 1024;

/** 截断文件保留天数 */
const RETENTION_DAYS = 7;

/** 截断文件存放目录 */
const TRUNCATION_DIR = join(getGlobalTmpDir(), "tool-output");

// ─── 类型定义 ──────────────────────────────────────────────

/** 截断方向：从头截断或从尾截断 */
export type TruncateDirection = "head" | "tail";

/** 截断行为配置项 */
export interface TruncateOptions {
  /** 最大行数，默认 2000 */
  maxLines?: number;
  /** 最大字节数，默认 50KB */
  maxBytes?: number;
  /** 截断方向，默认 head */
  direction?: TruncateDirection;
}

/** 截断结果，包含内容以及是否截断的标记 */
export type TruncateResult =
  | { content: string; truncated: false }
  | { content: string; truncated: true; outputPath: string };

// ─── 文件管理 ──────────────────────────────────────────────

/** 确保截断目录存在 */
function ensureTruncationDir(): void {
  try {
    ensureDir(TRUNCATION_DIR);
  } catch (error) {
    log.debug(`创建截断目录失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** 生成唯一文件名 */
function generateFileName(): string {
  return `${prefixedId("tool")}.txt`;
}

/**
 * 将工具完整输出写入临时文件（供后续查阅）。
 *
 * 由 executor 在截断时统一调用，工具内部不应直接使用 truncateToolOutput。
 *
 * @param content - 完整的工具输出内容
 * @returns 文件路径，写入失败时返回 null
 */
/** writeToolOutputToFile 的实现 */
export function writeToolOutputToFile(content: string): string | null {
  try {
    ensureTruncationDir();
    const outputPath = join(TRUNCATION_DIR, generateFileName());
    writeFileSync(outputPath, content, "utf8");
    return outputPath;
  } catch (error) {
    log.warn(`写入截断文件失败: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** 清理过期的截断文件(超过 RETENTION_DAYS 的) */
export function cleanupTruncationFiles(): void {
  try {
    ensureTruncationDir();
    const entries = readdirSync(TRUNCATION_DIR);
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;

    for (const entry of entries) {
      if (!entry.startsWith("tool_")) {
        continue;
      }
      const filePath = join(TRUNCATION_DIR, entry);
      try {
        const stat = statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          unlinkSync(filePath);
          log.debug(`清理过期截断文件: ${entry}`);
        }
      } catch (error) {
        log.debug(`清理截断文件失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    log.warn(`清理截断文件失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ─── 核心截断逻辑 ──────────────────────────────────────────

/**
 * 对工具输出进行截断处理
 *
 * 如果输出在限制范围内，直接返回原文
 * 超出限制时，截取预览部分并将完整内容写入临时文件
 *
 * @param text - 工具输出原始文本
 * @param options - 截断配置
 * @returns 截断结果(含是否截断标记和可能的文件路径)
 */
/** truncateToolOutput 的实现 */
export function truncateToolOutput(text: string, options: TruncateOptions = {}): TruncateResult {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const direction = options.direction ?? "head";

  const lines = text.split("\n");
  const totalBytes = Buffer.byteLength(text, "utf8");

  // 在限制范围内 → 不截断
  if (lines.length <= maxLines && totalBytes <= maxBytes) {
    return { content: text, truncated: false };
  }

  // 超出限制 → 截断预览 + 写文件
  const out: string[] = [];
  let bytes = 0;
  let hitBytes = false;

  if (direction === "head") {
    for (let i = 0; i < lines.length && i < maxLines; i++) {
      const size = Buffer.byteLength(lines[i]!, "utf8") + (i > 0 ? 1 : 0);
      if (bytes + size > maxBytes) {
        hitBytes = true;
        break;
      }
      out.push(lines[i]!);
      bytes += size;
    }
  } else {
    // Tail: 从末尾取
    for (let i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
      const size = Buffer.byteLength(lines[i]!, "utf8") + (out.length > 0 ? 1 : 0);
      if (bytes + size > maxBytes) {
        hitBytes = true;
        break;
      }
      out.unshift(lines[i]!);
      bytes += size;
    }
  }

  const removed = hitBytes ? totalBytes - bytes : lines.length - out.length;
  const unit = hitBytes ? "bytes" : "lines";
  const preview = out.join("\n");

  // 写完整输出到文件
  let outputPath: string;
  try {
    ensureTruncationDir();
    outputPath = join(TRUNCATION_DIR, generateFileName());
    writeFileSync(outputPath, text, "utf8");
  } catch (error) {
    // 写入失败 → 仍返回预览，但标记路径不可用
    log.warn(`截断文件写入失败: ${error instanceof Error ? error.message : String(error)}`);
    outputPath = "(写入失败)";
  }

  const hint = `工具输出已截断。完整输出已保存到: ${outputPath}\n可使用 Read 工具查看完整内容(建议用 offset/limit 分段读取)。`;

  const content =
    direction === "head"
      ? `${preview}\n\n...${removed} ${unit} truncated...\n\n${hint}`
      : `...${removed} ${unit} truncated...\n\n${hint}\n\n${preview}`;

  return { content, outputPath, truncated: true };
}

/**
 * 检查文本是否需要截断(不执行截断)
 */
/** needsTruncation 的实现 */
export function needsTruncation(text: string, options: TruncateOptions = {}): boolean {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const lines = text.split("\n");
  const totalBytes = Buffer.byteLength(text, "utf8");
  return lines.length > maxLines || totalBytes > maxBytes;
}

/**
 * 获取当前截断限制
 */
/** getTruncateDefaults 的实现 */
export function getTruncateDefaults(): { maxLines: number; maxBytes: number } {
  return { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES };
}

// ─── 流式大文件读取 ──────────────────────────────────────────

/** 流式读取截断文件的分页选项 */
export interface StreamReadOptions {
  /** 起始行号(从 0 开始) */
  offset?: number;
  /** 最大读取行数 */
  limit?: number;
}

/** 流式读取结果 */
export interface StreamReadResult {
  /** 读取的内容 */
  content: string;
  /** 总行数(如果可用) */
  totalLines?: number;
  /** 是否已到达文件末尾 */
  eof: boolean;
  /** 实际读取的行数 */
  linesRead: number;
}

/**
 * 流式读取截断文件内容
 *
 * 优势:
 * - 避免一次性加载大文件到内存
 * - 支持分页读取，适合 UI 展示
 * - 使用 Node.js 流式 API，内存占用低
 *
 * @param filePath - 文件路径(通常是 truncateToolOutput 返回的 outputPath)
 * @param options - 读取选项
 * @returns 读取结果
 */
export async function streamReadTruncatedFile(
  filePath: string,
  options: StreamReadOptions = {},
): Promise<StreamReadResult> {
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 100; // 默认一次读取 100 行

  // 检查文件是否存在
  try {
    await statSync(filePath);
  } catch {
    log.warn(`截断文件不存在: ${filePath}`);
    return { content: "", eof: true, linesRead: 0 };
  }

  const lines: string[] = [];
  let currentLine = 0;
  let linesRead = 0;

  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = createInterface({ crlfDelay: Infinity, input: stream });

  try {
    for await (const line of rl) {
      if (currentLine >= offset && linesRead < limit) {
        lines.push(line);
        linesRead++;
      }
      currentLine++;

      // 达到限制时提前结束
      if (linesRead >= limit) {
        rl.close();
        stream.destroy();
        break;
      }
    }

    return {
      content: lines.join("\n"),
      eof: linesRead < limit,
      linesRead,
    };
  } catch (error) {
    log.error(`流式读取文件失败: ${filePath}`, { error: String(error) });
    return { content: lines.join("\n"), eof: false, linesRead };
  } finally {
    rl.close();
    stream.destroy();
  }
}

/**
 * 获取截断文件的行数统计
 * 使用流式读取避免大文件内存问题
 */
export async function countTruncatedFileLines(filePath: string): Promise<number> {
  try {
    await statSync(filePath);
  } catch {
    return 0;
  }

  let count = 0;
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = createInterface({ crlfDelay: Infinity, input: stream });

  try {
    for await (const _ of rl) {
      count++;
    }
    return count;
  } catch (error) {
    log.error(`统计文件行数失败: ${filePath}`, { error: String(error) });
    return count;
  } finally {
    rl.close();
    stream.destroy();
  }
}
