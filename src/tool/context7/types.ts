/**
 * Context7 工具类型定义模块
 *
 * 职责:
 *   - 定义 Context7 MCP API 相关的所有类型接口
 *   - 提供类型安全的数据结构定义
 *   - 统一 Context7 工具的类型规范
 *
 * 模块功能:
 *   - Context7Library: 库信息接口
 *   - Context7ResolveResult: 库 ID 解析结果接口
 *   - Context7DocFragment: 文档片段接口
 *   - Context7DocsResult: 文档查询结果接口
 *   - McpResolveLibraryIdResponse: MCP 解析响应接口
 *   - McpQueryDocsResponse: MCP 查询响应接口
 *
 * 使用场景:
 *   - Context7 客户端实现
 *   - Context7 工具函数定义
 *   - 类型安全的 API 调用
 *
 * 边界:
 *   1. 仅包含类型定义，不包含实现逻辑
 *   2. 与 Context7 MCP API 结构保持一致
 *   3. 所有字段均为可选或必填明确标注
 *
 * 流程:
 *   1. 定义库信息类型
 *   2. 定义解析结果类型
 *   3. 定义文档片段类型
 *   4. 定义查询结果类型
 *   5. 定义 MCP 响应类型
 */

/** Context7 库信息，包含库 ID、名称、版本和描述 */
export interface Context7Library {
  libraryId: string;
  name: string;
  version?: string;
  description?: string;
}

/** Context7 库 ID 解析结果，包含解析状态和候选库列表 */
export interface Context7ResolveResult {
  status: "ok" | "error";
  libraryId?: string;
  libraries?: Context7Library[];
  error?: string;
}

/** Context7 文档片段，包含标题、内容和可选的代码与链接 */
export interface Context7DocFragment {
  title: string;
  content: string;
  code?: string;
  url?: string;
}

/** Context7 文档查询结果，包含状态和匹配的文档片段列表 */
export interface Context7DocsResult {
  status: "ok" | "error";
  fragments?: Context7DocFragment[];
  libraryId?: string;
  query?: string;
  error?: string;
}

/** MCP 解析库 ID API 的响应类型 */
export interface McpResolveLibraryIdResponse {
  libraryId: string;
  libraries?: Context7Library[];
}

/** MCP 查询文档 API 的响应类型 */
export interface McpQueryDocsResponse {
  fragments: Context7DocFragment[];
  libraryId: string;
  query: string;
}
