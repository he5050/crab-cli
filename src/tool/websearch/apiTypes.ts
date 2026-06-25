/**
 * 网页搜索 API 类型定义 — 各搜索引擎的请求/响应类型。
 *
 * 职责:
 *   - 定义本地 SearchResult（snippet 为 required）
 *   - 定义 Tavily / Brave / Google 的 API 响应类型
 *   - 定义缓存条目类型
 *
 * 注意:
 *   - 本模块的 SearchResult.snippet 是 required (string)，
 *     与 engines/types.ts 中的 snippet?: string 不同。
 *     前者用于 index.ts 内部统一处理，后者用于注册表引擎接口。
 */

/** 搜索结果条目（本地版本，snippet 为必填） */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  /** 可选:页面内容摘要(Tavily answer 模式) */
  content?: string;
}

/** Tavily API 响应中的单条结果 */
export interface TavilyResult {
  content?: string;
  raw_content?: string;
  snippet?: string;
  title?: string;
  url?: string;
}

/** Tavily API 响应 */
export interface TavilyResponse {
  answer?: string;
  results?: TavilyResult[];
}

/** Brave API 响应中的单条结果 */
export interface BraveResult {
  description?: string;
  title?: string;
  url?: string;
}

/** Brave API 响应 */
export interface BraveResponse {
  web?: { results?: BraveResult[] };
}

/** Google Custom Search 响应中的单条结果 */
export interface GoogleResult {
  link?: string;
  snippet?: string;
  title?: string;
}

/** Google Custom Search 响应 */
export interface GoogleResponse {
  items?: GoogleResult[];
}

/** 缓存条目 */
export interface CacheEntry {
  results: Record<string, unknown>;
  timestamp: number;
}
