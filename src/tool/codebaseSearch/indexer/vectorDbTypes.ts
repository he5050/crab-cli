/** 代码片段 */
export interface CodeChunk {
  /** 唯一 ID */
  id: string;
  /** 文件路径(绝对路径) */
  filePath: string;
  /** 起始行(从 1 开始) */
  startLine: number;
  /** 结束行 */
  endLine: number;
  /** 代码内容 */
  content: string;
  /** 语言 ID */
  languageId: string;
  /** 文件最后修改时间 */
  fileMtime: number;
  /** 文件内容 hash，用于 mtime 未变化时识别内容变更 */
  fileHash?: string;
  /** Embedding 向量(仅查询时填充) */
  embedding?: number[];
}

/** 搜索结果 */
export interface SearchResult {
  /** 代码片段 */
  chunk: CodeChunk;
  /** 相似度分数(0-1) */
  score: number;
}

/** 持久化存储的索引检查点数据结构 */
export interface StoredIndexCheckpoint {
  rootDir: string;
  checkpointJson: string;
  status: string;
  updatedAt: string;
}

/** 向量数据库配置 */
export interface VectorDbConfig {
  /** 数据库文件路径(默认 ~/.crab/crab-search.db) */
  dbPath?: string;
  /** 向量维度(默认 1536 for text-embedding-3-small) */
  dimensions?: number;
}

/** 向量搜索过滤选项 */
export interface VectorSearchOptions {
  /** 最大结果数 */
  limit?: number;
  /** 最低相似度阈值 */
  minScore?: number;
  /** 文件路径过滤 */
  filePathFilter?: string;
  /** 语言过滤 */
  languageFilter?: string;
}

/** 单文件的索引统计信息 */
export interface FileIndexStats {
  chunkCount: number;
  latestMtime: number;
  fileHash: string | null;
}

/** 向量数据库整体统计信息 */
export interface VectorDbStats {
  totalChunks: number;
  totalFiles: number;
  dbSizeBytes: number;
  embeddingDimensions: number;
}

/** 代码符号定义，包含名称、类型和位置信息 */
export interface CodeSymbol {
  id: string;
  name: string;
  kind: string;
  filePath: string;
  startLine: number;
  endLine: number;
  signature?: string;
  containerName?: string;
  languageId: string;
}

/** 已索引的代码符号，附加文件修改时间 */
export interface IndexedCodeSymbol extends CodeSymbol {
  fileMtime: number;
}

/** 符号搜索选项，扩展通用向量搜索 */
export interface SymbolSearchOptions extends VectorSearchOptions {
  /** 符号类型过滤 */
  kindFilter?: string;
}

/** 符号搜索结果，包含符号信息和相似度分数 */
export interface SymbolSearchResult {
  symbol: CodeSymbol;
  score: number;
}

/** 符号索引统计信息，按类型分组 */
export interface SymbolStats {
  totalSymbols: number;
  totalFiles: number;
  byKind: Record<string, number>;
}
