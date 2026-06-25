/**
 * 文本搜索工具 — 基于 ripgrep 的文本搜索。
 *
 * 职责:
 *   - 搜索文件中的文本内容
 *   - 支持正则表达式
 *   - 提供上下文行
 *   - 多层级回退策略
 *
 * 模块功能:
 *   - grepTool: 文本搜索工具定义
 *   - 正则表达式搜索
 *   - 上下文行显示
 *   - 大小写敏感/不敏感选项
 *
 * 使用场景:
 *   - AI 需要搜索代码中的文本
 *   - 查找特定模式
 *   - 代码分析和定位
 *
 * 边界:
 *   1. 权限:fs.read
 *   2. 默认最大结果数 100
 *   3. 三层回退策略:
 *      - 优先使用系统 ripgrep (rg)
 *      - 回退到 Bun.spawn + grep
 *      - 最终使用纯 JS 实现
 *   4. 支持上下文行(beforeContext/afterContext)
 *
 * 流程:
 *   1. 接收搜索参数
 *   2. 尝试 ripgrep
 *   3. 失败时回退到 grep
 *   4. 最终回退到纯 JS
 *   5. 返回搜索结果
 */
import { z } from "zod";
import { defineTool } from "@/tool/types";
import { createLogger } from "@/core/logging/logger";
import { exec } from "@/bus";
import { escapeRegex } from "@/tool/shared";
import { createSearchToolError, toSearchToolFailure } from "./errors";

const log = createLogger("tool:grep");

/** 默认最大结果数 */
const DEFAULT_MAX_RESULTS = 100;

/** 文件内容文本搜索工具 */
export const grepTool = defineTool({
  description:
    "搜索文件中的文本内容。支持正则表达式和字面量搜索。" +
    "优先使用 ripgrep (rg)，回退到 grep，最终使用纯 JS 搜索。" +
    "返回匹配的文件名、行号和匹配内容。支持上下文行(beforeContext/afterContext)。",
  execute: async ({ pattern, path: searchPath, ignoreCase, maxResults, include, beforeContext, afterContext }) => {
    const cwd = searchPath ?? process.cwd();
    const caseInsensitive = ignoreCase ?? true;
    const limit = maxResults ?? DEFAULT_MAX_RESULTS;

    try {
      // 优先尝试 ripgrep
      const rgResult = await tryRipgrep(pattern, cwd, caseInsensitive, limit, include, beforeContext, afterContext);
      if (rgResult !== null) {
        return rgResult;
      }

      // 回退到 grep
      const grepResult = await tryGrep(pattern, cwd, caseInsensitive, limit, include, beforeContext, afterContext);
      if (grepResult !== null) {
        return grepResult;
      }

      // 最终回退到纯 JS
      return jsGrep(pattern, cwd, caseInsensitive, limit, include, beforeContext, afterContext);
    } catch (error) {
      const appError = createSearchToolError(error, {
        operation: "execute",
        path: cwd,
        pattern,
        toolName: "grep",
      });
      log.error(`搜索失败: ${pattern}`, { code: appError.code, context: appError.context, error: appError.message });
      return { ...toSearchToolFailure(appError), matches: [], pattern, total: 0 };
    }
  },
  name: "grep",
  parameters: z.object({
    /** 匹配行之后显示的上下文行数 */
    afterContext: z.number().optional().describe("匹配行之后显示的上下文行数"),
    /** 匹配行之前显示的上下文行数 */
    beforeContext: z.number().optional().describe("匹配行之前显示的上下文行数"),
    /** 是否大小写不敏感 */
    ignoreCase: z.boolean().optional().describe("是否忽略大小写，默认 true"),
    /** 包含的文件模式 */
    include: z.string().optional().describe("只搜索匹配此 glob 模式的文件，如 *.ts"),
    /** 最大结果数 */
    maxResults: z.number().optional().describe("最大返回结果数，默认 100"),
    /** 搜索路径(文件或目录) */
    path: z.string().optional().describe("搜索的文件或目录路径，默认为当前工作目录"),
    /** 搜索模式(支持正则表达式) */
    pattern: z.string().describe("要搜索的文本模式(支持正则表达式)"),
  }),
  permission: "fs.read",
  builtin: true,
});

/** 尝试使用 ripgrep */
async function tryRipgrep(
  pattern: string,
  cwd: string,
  ignoreCase: boolean,
  maxResults: number,
  include?: string,
  beforeContext?: number,
  afterContext?: number,
): Promise<Record<string, unknown> | null> {
  const args = ["--line-number", "--no-heading", "--color=never"];
  if (ignoreCase) {
    args.push("--ignore-case");
  }
  args.push("--max-count", String(maxResults));
  if (include) {
    args.push("--glob", include);
  }
  if (beforeContext) {
    args.push("--before-context", String(beforeContext));
  }
  if (afterContext) {
    args.push("--after-context", String(afterContext));
  }
  // 如果只有一个 context 参数，用 -C 统一处理
  if (beforeContext && !afterContext) {
    args.push("--after-context", String(beforeContext));
  }
  if (afterContext && !beforeContext) {
    args.push("--before-context", String(afterContext));
  }
  args.push("--", pattern, cwd);

  const result = await exec(["rg", ...args], { timeout: 10_000 });
  // Rg exit codes: 0=matches, 1=no matches, 2=error, -1=command not found
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    return null;
  }
  if (result.exitCode === 1) {
    return { engine: "ripgrep", matches: [], path: cwd, pattern, total: 0 };
  }

  const matches = parseGrepOutput(result.stdout, maxResults);
  return { engine: "ripgrep", matches, path: cwd, pattern, total: matches.length };
}

/** 尝试使用系统 grep */
async function tryGrep(
  pattern: string,
  cwd: string,
  ignoreCase: boolean,
  maxResults: number,
  include?: string,
  beforeContext?: number,
  afterContext?: number,
): Promise<Record<string, unknown> | null> {
  const args = ["-n", "--no-messages"];
  if (ignoreCase) {
    args.push("-i");
  }
  if (include) {
    args.push("--include", include);
  }
  const ctx = beforeContext ?? afterContext;
  if (ctx) {
    args.push("-C", String(ctx));
  }
  args.push("-r", "--", pattern, cwd);

  const result = await exec(["grep", ...args], { timeout: 10_000 });
  if (result.exitCode === 2) {
    return null;
  }
  if (result.exitCode === 1) {
    return { engine: "grep", matches: [], path: cwd, pattern, total: 0 };
  }

  const matches = parseGrepOutput(result.stdout, maxResults);
  return { engine: "grep", matches, path: cwd, pattern, total: matches.length };
}

/** 解析 grep/rg 输出为结构化匹配 */
function parseGrepOutput(output: string, maxResults: number): { file: string; line: number; text: string }[] {
  const matches: { file: string; line: number; text: string }[] = [];
  const lines = output.split("\n");

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    // 格式: file:line:text 或 file-line-text (rg with --no-heading)
    const match = line.match(/^(.+?)[:-](\d+)[:-](.*)$/);
    if (match) {
      matches.push({
        file: match[1]!,
        line: parseInt(match[2]!, 10),
        text: match[3]!,
      });
      if (matches.length >= maxResults) {
        break;
      }
    }
  }

  return matches;
}

/** 纯 JS grep 回退实现(支持上下文行) */
function jsGrep(
  pattern: string,
  cwd: string,
  ignoreCase: boolean,
  maxResults: number,
  include?: string,
  beforeContext?: number,
  afterContext?: number,
): Record<string, unknown> {
  const flags = ignoreCase ? "i" : "";
  // 转义用户输入中的正则特殊字符，防止 ReDoS 攻击
  const safe = escapeRegex(pattern);
  const regex = new RegExp(safe, flags);
  const matches: {
    file: string;
    line: number;
    text: string;
    contextBefore?: string[];
    contextAfter?: string[];
  }[] = [];
  const glob = include
    ? new Bun.Glob(include)
    : new Bun.Glob("**/*.{ts,tsx,js,jsx,json,md,txt,py,go,rs,yaml,yml,toml,cfg,conf}");

  try {
    for (const filePath of glob.scanSync({ cwd, dot: false })) {
      if (matches.length >= maxResults) {
        break;
      }
      if (filePath.includes("node_modules") || filePath.includes(".git")) {
        continue;
      }

      const fullPath = pathModule.resolve(cwd, filePath);
      try {
        const content = fsModule.readFileSync(fullPath, "utf8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
          if (regex.test(lines[i]!)) {
            const match: (typeof matches)[number] = { file: filePath, line: i + 1, text: lines[i]! };

            // 上下文行
            if (beforeContext) {
              const beforeStart = Math.max(0, i - beforeContext);
              match.contextBefore = lines.slice(beforeStart, i);
            }
            if (afterContext) {
              const afterEnd = Math.min(lines.length, i + 1 + afterContext);
              match.contextAfter = lines.slice(i + 1, afterEnd);
            }

            matches.push(match);
          }
        }
      } catch (error) {
        const appError = createSearchToolError(error, {
          operation: "read-file",
          path: fullPath,
          pattern,
          toolName: "grep",
        });
        log.debug("跳过不可读文件", { code: appError.code, error: appError.message, path: fullPath });
        // 跳过不可读的文件
      }
    }
  } catch (error) {
    const appError = createSearchToolError(error, {
      operation: "js-search",
      path: cwd,
      pattern,
      toolName: "grep",
    });
    return { ...toSearchToolFailure(appError), engine: "js", matches: [], path: cwd, pattern, total: 0 };
  }

  return { engine: "js", matches, path: cwd, pattern, total: matches.length };
}

// 延迟导入避免循环
import fsModule from "node:fs";
import pathModule from "node:path";
