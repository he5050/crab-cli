/**
 * DeepWiki 工具类型定义模块
 *
 * 职责:
 *   - 定义 DeepWiki MCP API 相关的所有类型接口
 *   - 提供类型安全的数据结构定义
 *   - 统一 DeepWiki 工具的类型规范
 *
 * 模块功能:
 *   - DeepWikiStructureItem: 文档结构项接口
 *   - DeepWikiStructureResult: 结构查询结果接口
 *   - DeepWikiContentsResult: 内容读取结果接口
 *   - DeepWikiAskResult: 问答结果接口
 *   - DeepWikiFetchResult: 文档获取结果接口
 *   - DeepWikiSearchResult: 搜索结果接口
 *   - CrawlResult: 爬取结果接口
 *
 * 使用场景:
 *   - DeepWiki 客户端实现
 *   - DeepWiki 工具函数定义
 *   - 类型安全的 API 调用
 *
 * 边界:
 *   1. 仅包含类型定义，不包含实现逻辑
 *   2. 与 DeepWiki MCP API 结构保持一致
 *   3. 所有字段均为可选或必填明确标注
 *
 * 流程:
 *   1. 定义文档结构类型
 *   2. 定义查询结果类型
 *   3. 定义爬取和获取结果类型
 *   4. 定义搜索结果类型
 */

/** DeepWiki 文档结构项，表示目录树中的文件或文件夹 */
export interface DeepWikiStructureItem {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: DeepWikiStructureItem[];
}

/** DeepWiki 文档结构查询结果，包含状态和层级目录列表 */
export interface DeepWikiStructureResult {
  status: "ok" | "error";
  structure?: DeepWikiStructureItem[];
  error?: string;
}

/** DeepWiki 文档内容读取结果，包含 Markdown 内容和路径信息 */
export interface DeepWikiContentsResult {
  status: "ok" | "error";
  content?: string;
  path?: string;
  repoName?: string;
  error?: string;
}

/** DeepWiki 问答结果，包含 AI 回答和原始问题 */
export interface DeepWikiAskResult {
  status: "ok" | "error";
  answer?: string;
  question?: string;
  repoName?: string;
  error?: string;
}

/** MCP 读取文档结构 API 的响应类型 */
export interface McpReadWikiStructureResponse {
  structure: DeepWikiStructureItem[];
}

/** MCP 读取文档内容 API 的响应类型 */
export interface McpReadWikiContentsResponse {
  content: string;
  path: string;
  repoName: string;
}

/** MCP 问答 API 的响应类型 */
export interface McpAskQuestionResponse {
  answer: string;
  question: string;
  repoName: string;
}

/** 爬取结果 — html 为 Record<路径, 内容> */
export interface CrawlResult {
  html: Record<string, string>;
  urls: string[];
}

/** Deepwiki 页面获取工具的返回结果 */
export interface DeepWikiFetchResult {
  status: "ok" | "error";
  pages?: DeepWikiPage[];
  error?: string;
}

/** 已爬取/已获取的页面 */
export interface DeepWikiPage {
  path: string;
  markdown: string;
}

/** DeepWiki 搜索结果 */
export interface DeepWikiSearchResult {
  status: "ok" | "error";
  query?: string;
  totalSearchedPages?: number;
  matches?: DeepWikiSearchMatch[];
  error?: string;
}

/** 单条搜索匹配 */
export interface DeepWikiSearchMatch {
  title: string;
  url: string;
  path?: string;
  snippet: string;
  score?: number;
}
