/**
 * Context7 工具模块
 *
 * 职责:
 *   - 提供通过官方 Context7 MCP API 访问技术文档的能力
 *   - 导出 Context7 相关工具和类型
 *   - 管理 Context7 工具的生命周期
 *
 * 模块功能:
 *   - context7ResolveLibraryIdTool: 将库名解析为 Context7 兼容的 libraryId
 *   - context7QueryDocsTool: 使用 libraryId 获取精准文档片段
 *   - resolveLibraryId: 库 ID 解析函数
 *   - queryLibraryDocs: 文档查询函数
 *   - closeClient: 关闭 MCP 客户端连接
 *
 * 使用场景:
 *   - 需要获取技术文档时
 *   - 查询库的使用文档
 *   - 获取代码示例和 API 参考
 *
 * 边界:
 *   1. 依赖 Context7 MCP API 服务
 *   2. 需要网络连接
 *   3. 服务端点: https://mcp.context7.com/mcpContext7
 *   4. 支持主流技术库的文档查询
 *
 * 流程:
 *   1. 调用 resolve-library-id 获取 libraryId(如 npm:react)
 *   2. 调用 query-docs 获取具体问题的文档片段
 *   3. 返回结构化的文档内容
 */
/** Context7 工具模块 — 通过官方 MCP API 访问技术文档 */
export { context7ResolveLibraryIdTool } from "./resolve";
export { context7QueryDocsTool } from "./query";
export { resolveLibraryId, queryLibraryDocs, closeClient } from "./client";
export type { Context7Library, Context7ResolveResult, Context7DocFragment, Context7DocsResult } from "./types";
