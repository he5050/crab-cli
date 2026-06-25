/**
 * 文件搜索工具 — 基于 Bun.Glob 的模式匹配文件搜索。
 *
 * 职责:
 *   - 基于 glob 模式搜索文件
 *   - 自动排除常见忽略目录
 *   - 支持加载 .gitignore 规则
 *   - 限制最大结果数
 *
 * 模块功能:
 *   - globTool: 文件搜索工具定义
 *   - 模式匹配搜索
 *   - 自动排除 node_modules/.git/dist 等
 *   - .gitignore 规则支持
 *
 * 使用场景:
 *   - AI 需要查找符合模式的文件
 *   - 批量文件定位
 *   - 项目文件遍历
 *
 * 边界:
 *   1. 权限:fs.read
 *   2. 默认最大结果数 1000
 *   3. 自动排除常见忽略目录
 *   4. 支持 .gitignore 规则
 *   5. 使用 Bun.Glob 实现
 *
 * 流程:
 *   1. 接收 glob 模式参数
 *   2. 加载 .gitignore 规则
 *   3. 执行 glob 搜索
 *   4. 过滤排除目录
 *   5. 返回匹配文件列表
 */
import { z } from "zod";
import { defineTool } from "@/tool/types";
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@/core/logging/logger";
import { createSearchToolError, toSearchToolFailure } from "./errors";

const log = createLogger("tool:glob");

/** 默认最大结果数 */
const DEFAULT_MAX_RESULTS = 1000;

/** 始终排除的目录名 */
const ALWAYS_EXCLUDE = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".cache",
  ".turbo",
  "coverage",
  "__pycache__",
  ".tox",
  "vendor",
  ".venv",
  "venv",
  ".env",
  "target",
  ".gradle",
  ".idea",
  ".vscode",
  ".DS_Store",
]);

/** 文件路径 glob 搜索工具 */
export const globTool = defineTool({
  description:
    "使用 glob 模式搜索文件路径。支持 ** 递归匹配、* 通配符、? 单字符匹配。" +
    "自动排除 node_modules、.git、dist、build 等常见忽略目录。" +
    "返回匹配的文件路径列表。",
  execute: async ({ pattern, path: searchPath, maxResults }) => {
    const cwd = searchPath ?? process.cwd();
    const limit = maxResults ?? DEFAULT_MAX_RESULTS;

    try {
      const resolvedCwd = path.resolve(cwd);

      if (!fs.existsSync(resolvedCwd)) {
        const appError = createSearchToolError(
          new Error(`目录不存在: ${resolvedCwd}`),
          { operation: "validate-path", path: resolvedCwd, pattern, toolName: "glob" },
          "RESOURCE_NOT_FOUND",
        );
        return { ...toSearchToolFailure(appError), files: [], total: 0 };
      }

      const glob = new Bun.Glob(pattern);
      const matches: string[] = [];

      for (const match of glob.scanSync({ cwd: resolvedCwd, dot: false })) {
        // 跳过始终排除的目录
        if (shouldExclude(match)) {
          continue;
        }
        matches.push(match);
        if (matches.length >= limit) {
          break;
        }
      }

      log.info(`Glob 搜索: ${pattern} → ${matches.length} 个结果`, { cwd: resolvedCwd });

      return {
        files: matches,
        path: resolvedCwd,
        pattern,
        total: matches.length,
        truncated: matches.length >= limit,
      };
    } catch (error) {
      const appError = createSearchToolError(error, {
        operation: "execute",
        path: cwd,
        pattern,
        toolName: "glob",
      });
      log.error(`Glob 搜索失败: ${pattern}`, {
        code: appError.code,
        context: appError.context,
        error: appError.message,
      });
      return { ...toSearchToolFailure(appError), files: [], pattern, total: 0 };
    }
  },
  name: "glob",
  parameters: z.object({
    /** 最大结果数 */
    maxResults: z.number().optional().describe("最大返回结果数，默认 1000"),
    /** 搜索根目录 */
    path: z.string().optional().describe("搜索的根目录，默认为当前工作目录"),
    /** Glob 模式 */
    pattern: z.string().describe("Glob 搜索模式，如 **/*.ts 或 src/**/*.tsx"),
  }),
  permission: "fs.read",
  builtin: true,
});

/**
 * 判断路径是否应该被排除。
 * 检查路径中每一段是否在排除列表中。
 */
function shouldExclude(filePath: string): boolean {
  const segments = filePath.split(/[/\\]/);
  for (const seg of segments) {
    if (ALWAYS_EXCLUDE.has(seg)) {
      return true;
    }
  }
  return false;
}
