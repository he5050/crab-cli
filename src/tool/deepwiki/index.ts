/**
 * DeepWiki 工具模块
 *
 * 职责:
 *   - 提供通过官方 DeepWiki MCP API 访问 GitHub 仓库文档的能力
 *   - 导出 DeepWiki 相关工具和类型
 *   - 管理 DeepWiki 工具的生命周期
 *
 * 模块功能:
 *   - deepwikiReadStructureTool: 获取文档目录结构
 *   - deepwikiReadContentsTool: 读取指定路径的文档内容
 *   - deepwikiAskQuestionTool: 基于文档回答问题
 *   - deepwikiFetchTool: 获取并转换文档为 Markdown
 *   - deepwikiSearchTool: 在文档中搜索内容
 *
 * 使用场景:
 *   - 获取 GitHub 仓库的文档结构
 *   - 读取特定文档内容
 *   - 基于文档回答问题
 *   - 搜索文档内容
 *
 * 边界:
 *   1. 依赖 DeepWiki MCP API 服务
 *   2. 需要网络连接
 *   3. 服务端点: https://mcp.deepwiki.com/api/mcp
 *   4. 仅支持 GitHub 仓库文档
 *
 * 流程:
 *   1. 调用 structure 获取文档目录结构
 *   2. 调用 contents 读取指定路径文档
 *   3. 调用 ask 基于文档回答问题
 *   4. 返回结构化的文档内容或答案
 */
/** DeepWiki 工具模块 — 通过官方 MCP API 访问 GitHub 仓库文档 */
export { deepwikiReadStructureTool } from "./structure";
export { deepwikiReadContentsTool } from "./contents";
export { deepwikiAskQuestionTool } from "./ask";
export { deepwikiFetchTool } from "./fetch";
export { deepwikiSearchTool } from "./search";
export { readWikiStructure, readWikiContents, askQuestion, normalizeRepoName, closeClient } from "./client";
export type {
  DeepWikiStructureItem,
  DeepWikiStructureResult,
  DeepWikiContentsResult,
  DeepWikiAskResult,
} from "./types";
