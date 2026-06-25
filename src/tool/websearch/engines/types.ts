/**
 * 搜索引擎抽象接口 — 支持多搜索引擎和插件引擎。
 *
 *
 * 每个引擎封装搜索逻辑。crab-cli 的搜索引擎同时支持:
 *   - API 密钥模式(Tavily, Brave, Google)
 *   - HTTP 请求模式(DuckDuckGo)
 *   - 插件扩展(~/.crab/plugin/search_engines/)
 */

/** 搜索引擎标识符 */
export type SearchEngineId = string;

/** 搜索结果 */
export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
  content?: string;
  source?: string;
}

/**
 * 搜索引擎接口。
 * 所有搜索引擎(内置和插件)必须实现此接口。
 */
/** SearchEngine */
export interface SearchEngine {
  /** 稳定的引擎标识符 */
  readonly id: SearchEngineId;
  /** 人类可读名称 */
  readonly name: string;
  /** 是否启用(默认 true) */
  readonly enable?: boolean;

  /**
   * 执行搜索。
   * @param query - 搜索查询
   * @param maxResults - 最大结果数
   * @returns 搜索结果数组
   */
  search(query: string, maxResults: number): Promise<SearchResult[]>;
}

/**
 * API 密钥配置的搜索引擎基础类。
 * 子类只需实现 search 和配置读取逻辑。
 */
export abstract class ApiKeySearchEngine implements SearchEngine {
  abstract readonly id: SearchEngineId;
  abstract readonly name: string;
  readonly enable?: boolean = true;

  abstract search(query: string, maxResults: number): Promise<SearchResult[]>;

  /** 获取 API 密钥(子类可选覆盖) */
  protected getApiKey(): string | undefined {
    return undefined;
  }
}
