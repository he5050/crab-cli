/**
 * ACE Code Search 常量配置 — 系统运行参数和阈值定义
 *
 * 职责:
 *   - 定义索引缓存、批处理、文件大小等运行时参数
 *   - 提供排除模式(目录、扩展名)的配置
 *   - 设置内存管理和性能调优的阈值
 *
 * 模块功能:
 *   - INDEX_CACHE_DURATION: 索引缓存持续时间(1 分钟)
 *   - BATCH_SIZE: 并发文件处理批大小
 *   - BINARY_EXTENSIONS: 二进制文件扩展名集合
 *   - GREP_EXCLUDE_DIRS: grep 搜索排除目录列表
 *   - RECENT_FILE_THRESHOLD: 最近文件阈值(24 小时)
 *   - MAX_INDEXED_FILES: 最大索引文件数
 *   - MAX_SYMBOLS_PER_FILE: 每个文件最大符号数
 *   - LARGE_FILE_THRESHOLD: 大文件阈值(1MB)
 *   - TEXT_SEARCH_TIMEOUT_MS: 文本搜索超时(30 秒)
 *   - MAX_REGEX_COMPLEXITY_SCORE: 正则复杂度最大分数(ReDoS 防护)
 *   - MAX_CONTENT_CACHE_BYTES: 文件内容缓存最大字节数(50MB)
 *   - MEMORY_PRESSURE_THRESHOLD_BYTES: 内存压力阈值(512MB RSS)
 *
 * 使用场景:
 *   - ACE 代码搜索服务的性能调优
 *   - 资源使用限制和缓存管理
 *   - 搜索策略的参数配置
 *
 * 边界:
 * 1. 所有阈值都经过平衡以保证性能和资源使用
 * 2. 内存阈值用于触发缓存清理
 * 3. 大文件使用流式读取以避免内存溢出
 * 4. ReDoS 防护限制正则复杂度
 *
 * 流程:
 * 1. 服务初始化时加载常量配置
 * 2. 根据常量值设置缓存大小和超时时间
 * 3. 监控资源使用并根据阈值触发清理
 */

/** 索引缓存持续时间(1 分钟) */
export const INDEX_CACHE_DURATION = 60_000;

/** 并发文件处理批大小 */
export const BATCH_SIZE = 10;

/** 二进制文件扩展名(跳过文本搜索) */
export const BINARY_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
  ".ico",
  ".svg",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".rar",
  ".7z",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".mp3",
  ".mp4",
  ".avi",
  ".mov",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".class",
  ".jar",
  ".war",
  ".o",
  ".a",
  ".lib",
]);

/** Grep 搜索排除目录 */
export const GREP_EXCLUDE_DIRS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "__pycache__",
  "target",
  ".next",
  ".nuxt",
  "coverage",
];

/** 最近文件阈值(24 小时) */
export const RECENT_FILE_THRESHOLD = 24 * 60 * 60 * 1000;

/** 文件内容缓存最大条目数 */
export const MAX_FILE_CACHE_SIZE = 50;

/** 文件 stat 缓存最大条目数 */
export const MAX_FILE_STAT_CACHE_SIZE = 500;

/** ACE 空闲清理间隔(2 分钟) */
export const ACE_IDLE_CLEANUP_MS = 2 * 60 * 1000;

/** 最大索引文件数 */
export const MAX_INDEXED_FILES = 2000;

/** 每个文件最大符号数 */
export const MAX_SYMBOLS_PER_FILE = 100;

/** FZF 索引最大唯一符号名数 */
export const MAX_FZF_SYMBOL_NAMES = 30_000;

/** File_outline 默认最大符号数 */
export const MAX_FILE_OUTLINE_SYMBOLS = 200;

/** File_outline 最大序列化载荷字符数 */
export const MAX_FILE_OUTLINE_PAYLOAD_CHARS = 120_000;

/** 大文件阈值(1MB)，超过此值使用流式读取 */
export const LARGE_FILE_THRESHOLD = 1024 * 1024;

/** 流式读取块大小(512KB) */
export const FILE_READ_CHUNK_SIZE = 512 * 1024;

/** 文本搜索超时(30 秒) */
export const TEXT_SEARCH_TIMEOUT_MS = 30_000;

/** JS 回退搜索最大并发文件读取数 */
export const MAX_CONCURRENT_FILE_READS = 20;

/** 正则复杂度最大分数(ReDoS 防护) */
export const MAX_REGEX_COMPLEXITY_SCORE = 100;

/** 文件内容缓存最大字节数(50MB) */
export const MAX_CONTENT_CACHE_BYTES = 50 * 1024 * 1024;

/** 内存压力阈值(512MB RSS) */
export const MEMORY_PRESSURE_THRESHOLD_BYTES = 512 * 1024 * 1024;

/** 内存检查最小间隔(10 秒) */
export const MEMORY_CHECK_INTERVAL_MS = 10_000;
