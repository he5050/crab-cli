/**
 * ACE 增强搜索工具 — 基于 SQLite 符号索引 + ctags + 语义向量的多源融合搜索。
 *
 * 职责:
 *   - 提供独立的 ace-enhanced-search 工具
 *   - 多源搜索融合(索引 > ctags > 语义 > grep)
 *   - 智能排序和去重
 *   - 搜索来源统计
 *
 * 与 codebase-search 的区别:
 *   - codebase-search 的 ace 模式:每次从头解析文件(慢)
 *   - ace-enhanced-search:优先使用 SQLite 索引(快)，按需补充其他源
 *   - ace-enhanced-search 返回排名分数和搜索来源统计
 */
import { z } from "zod";
import { defineTool } from "@/tool/types";
import { enhancedSearch } from "./enhancedSearchEngine";

/** 增强型代码搜索工具，融合 SQLite 索引、ctags、语义向量和 grep 多源搜索 */
export const aceEnhancedSearchTool = defineTool({
  description:
    "增强型代码搜索，融合 SQLite 符号索引、ctags 解析、语义向量搜索和 grep 文本搜索。" +
    "优先使用索引(毫秒级)，按需回退到其他搜索源。返回带排名分数和搜索来源统计。" +
    "适合精确符号定位、跨文件引用查找、语义代码搜索。自动排除 node_modules/.git/dist 等。",
  execute: async ({ query, path: searchPath, include, exclude, maxResults, enableSemantic, symbolType, language }) =>
    enhancedSearch({
      cwd: searchPath,
      enableSemantic,
      exclude,
      include,
      language,
      maxResults,
      query,
      symbolType,
    }),
  name: "ace-enhanced-search",
  parameters: z.object({
    enableSemantic: z.boolean().optional().describe("是否启用语义向量搜索(需 embedding 服务)，默认 false"),
    exclude: z.array(z.string()).optional().describe("额外排除的目录"),
    include: z.string().optional().describe("文件类型过滤，如 *.ts"),
    language: z.string().optional().describe("语言过滤:typescript/javascript/python/go/rust 等"),
    maxResults: z.number().optional().describe("最大返回结果数，默认 50"),
    path: z.string().optional().describe("搜索根路径(默认当前工作目录)"),
    query: z.string().describe("搜索查询(符号名、文本、路径片段等)"),
    symbolType: z.string().optional().describe("符号类型过滤:function/class/interface/method/variable/enum 等"),
  }),
  permission: "fs.read",
  builtin: true,
});

export type { EnhancedSearchParams } from "./enhancedSearchEngine";
