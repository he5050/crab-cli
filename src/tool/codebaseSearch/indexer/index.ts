/**
 * Search 模块入口
 *
 * 职责:
 *   - 提供搜索模块的统一导出接口
 *   - 整合向量数据库、代码库索引器、文件监控器和混合搜索服务
 *   - 管理模块间的依赖关系和类型导出
 *
 * 模块功能:
 *   - VectorDb: 向量数据库类，存储代码片段及其 Embedding 向量
 *   - cosineSimilarity: 余弦相似度计算函数
 *   - CodebaseIndexer: 代码库索引器类，实现代码分块和索引
 *   - FileWatcher: 文件监控器类，监控文件变更并触发重新索引
 *   - HybridSearchService: 混合搜索服务类，统一 LSP 和向量搜索
 *
 * 使用场景:
 *   - 代码库语义搜索
 *   - 基于 Embedding 的相似代码查找
 *   - 文件变更实时监控
 *   - 结合 LSP 和向量搜索的混合搜索
 *
 * 边界:
 *   1. 仅导出类型和类，不包含具体实现逻辑
 *   2. 依赖具体子模块的实现
 *   3. 需要 Embedding 服务支持才能使用语义搜索
 *   4. 模块初始化顺序:VectorDb → CodebaseIndexer → FileWatcher → HybridSearchService
 *
 * 流程:
 *   1. 导入并重新导出各子模块的类和类型
 *   2. 使用 CodebaseIndexer 索引代码库
 *   3. 代码分块并生成 Embedding，存储到 VectorDb
 *   4. 使用 HybridSearchService 执行搜索
 *   5. FileWatcher 监控文件变更并更新索引
 */
export { VectorDb, cosineSimilarity, type CodeChunk, type SearchResult, type VectorDbConfig } from "./vectorDb";

export { CodebaseIndexer, type IndexProgress, type IndexerConfig } from "./codebaseIndexer";

export { FileWatcher, type FileChangeEvent, type FileChangeCallback, type FileWatcherConfig } from "./fileWatcher";

export { HybridSearchService, type HybridSearchResult, type HybridSearchOptions } from "./hybridSearch";
