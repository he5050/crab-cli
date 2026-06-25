/**
 * 全局常量配置 — 集中管理所有魔法数字和默认值。
 *
 * 职责:
 *   - 提供统一的常量定义
 *   - 便于维护和调整
 *   - 避免魔法数字散落在代码中
 *
 * 模块功能:
 *   - 事件总线常量(MAX_EVENT_HISTORY_SIZE, EVENT_HISTORY_TTL_MS)
 *   - MCP 客户端常量(MCP_TOOLS_CACHE_TTL_MS, MCP_IDLE_TIMEOUT_MS 等)
 *   - 日志系统常量(LOG_BUFFER_SIZE)
 *   - API 层常量(FALLBACK_PROBE_TIMEOUT_MS, DEFAULT_STREAM_TIMEOUT_MS)
 *   - 对话压缩常量(DEFAULT_COMPACTION_TOKEN_THRESHOLD 等)
 *   - 工具执行常量(DEFAULT_TOOL_EXECUTION_TIMEOUT_MS)
 *   - 重试机制常量(DEFAULT_MAX_RETRIES, DEFAULT_RETRY_DELAY_MS)
 *   - 资源监控常量(RESOURCE_MONITOR_INTERVAL_MS, MEMORY_WARNING_THRESHOLD_MB)
 *   - 内存限制常量(MAX_TODO_STORES, MAX_NOTEBOOKS 等)
 *   - 文件大小限制常量(MAX_FILE_SIZE, LARGE_FILE_THRESHOLD 等)
 *   - 缓存配置常量(CODEBASE_SEARCH_CACHE_TTL_MS 等)
 *   - 背压和限流常量(MAX_CONCURRENT_TOOL_EXECUTION 等)
 *   - Agent 限制常量(MAX_SPAWN_DEPTH, MAX_RUNNING_SUBAGENTS 等)
 *
 * 使用场景:
 *   - 配置超时时间
 *   - 设置缓存大小
 *   - 定义阈值和限制
 *
 * 边界:
 *   1. 纯常量定义，无业务逻辑
 *   2. 所有常量集中在此文件管理
 *   3. 修改常量可能影响多处逻辑
 *
 * 流程:
 *   1. 需要常量时从此文件导入
 *   2. 调整常量值时统一修改
 *   3. 重新构建应用生效
 */

// ─── 事件总线 ──────────────────────────────────────────────

/** 事件历史最大保留数量 */
export const MAX_EVENT_HISTORY_SIZE = 1000;

/** 事件历史保留时间(毫秒)- 1小时 */
export const EVENT_HISTORY_TTL_MS = 60 * 60 * 1000;

// ─── MCP 客户端 ────────────────────────────────────────────

/** MCP 工具缓存 TTL(毫秒)- 5分钟 */
export const MCP_TOOLS_CACHE_TTL_MS = 5 * 60 * 1000;

/** MCP 空闲超时时间(毫秒)- 10分钟 */
export const MCP_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

/** MCP 连接超时(毫秒)- 30秒 */
export const MCP_CONNECT_TIMEOUT_MS = 30_000;

/** MCP 工具调用超时(毫秒)- 60秒 */
export const MCP_CALL_TIMEOUT_MS = 60_000;

/** MCP 空闲检查间隔(毫秒)- 1分钟 */
export const MCP_IDLE_CHECK_INTERVAL_MS = 60_000;

// ─── 日志系统 ──────────────────────────────────────────────

/** 日志缓冲区最大大小 */
export const LOG_BUFFER_SIZE = 200;

// ─── API 层 ────────────────────────────────────────────────

/** 降级探测超时(毫秒)- 10秒 */
export const FALLBACK_PROBE_TIMEOUT_MS = 10_000;

/** 默认流式超时(毫秒)- 60秒 */
export const DEFAULT_STREAM_TIMEOUT_MS = 60_000;

// ─── 对话压缩 ──────────────────────────────────────────────

/** 默认 Token 阈值 - 80k */
export const DEFAULT_COMPACTION_TOKEN_THRESHOLD = 80_000;

/** 默认保留近期轮次 - 4轮 */
export const DEFAULT_COMPACTION_KEEP_RECENT_TURNS = 4;

/** 默认工具输出截断长度 */
export const DEFAULT_TOOL_OUTPUT_TRUNCATE_LENGTH = 2000;

/** 默认压缩目标比例 */
export const DEFAULT_COMPACTION_TARGET_RATIO = 0.3;

/** 摘要生成超时(毫秒)- 15秒 */
export const SUMMARY_GENERATION_TIMEOUT_MS = 15_000;

/** 摘要最大 Token 数 */
export const SUMMARY_MAX_TOKENS = 4000;

// ─── 工具执行 ──────────────────────────────────────────────

/** 默认工具执行超时(毫秒)- 60秒 */
export const DEFAULT_TOOL_EXECUTION_TIMEOUT_MS = 60_000;

/** 默认最大工具调用轮次。仅作为防失控保护，不应限制复杂任务容量。 */
export const DEFAULT_MAX_TOOL_ROUNDS = 50;

// ─── 重试机制 ──────────────────────────────────────────────

/** 默认最大重试次数 */
export const DEFAULT_MAX_RETRIES = 3;

/** 默认重试延迟(毫秒)- 1秒 */
export const DEFAULT_RETRY_DELAY_MS = 1000;

/** 最大重试延迟(毫秒)- 30秒 */
export const MAX_RETRY_DELAY_MS = 30_000;

// ─── 资源监控 ──────────────────────────────────────────────

/** 资源监控采样间隔(毫秒)- 30秒 */
export const RESOURCE_MONITOR_INTERVAL_MS = 30_000;

/** 内存警告阈值(MB)- 500MB */
export const MEMORY_WARNING_THRESHOLD_MB = 500;

// ─── 内存限制 ──────────────────────────────────────────────

/** Todo 存储最大数量 */
export const MAX_TODO_STORES = 20;

/** Notebook 存储最大数量 */
export const MAX_NOTEBOOKS = 20;

/** 代码库搜索缓存最大条目数 */
export const MAX_CODEBASE_CACHE_SIZE = 30;

// ─── 文件大小限制 ──────────────────────────────────────────

/** 最大文件大小(10MB)- 超过此大小的文件需要特殊处理 */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** 大文件阈值(1MB)- 超过此大小的文件标记为大文件 */
export const LARGE_FILE_THRESHOLD = 1 * 1024 * 1024;

/** 流式读取块大小(64KB) */
export const STREAM_CHUNK_SIZE = 64 * 1024;

/** 文件预览最大行数 */
export const FILE_PREVIEW_MAX_LINES = 1000;

// ─── 缓存配置 ──────────────────────────────────────────────

/** 代码库搜索缓存 TTL(30秒) */
export const CODEBASE_SEARCH_CACHE_TTL_MS = 30 * 1000;

// ─── SQLite ─────────────────────────────────────────────

/** SQLite busy timeout(毫秒) */
export const SQLITE_BUSY_TIMEOUT_MS = 5000;

/** Web 搜索缓存最大条目数 */
export const WEB_SEARCH_CACHE_MAX_SIZE = 50;

/** Web 搜索缓存 TTL(5分钟) */
export const WEB_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;

// ─── 性能监控 ──────────────────────────────────────────────

/** 内存使用趋势窗口大小(10个采样点) */
export const MEMORY_TREND_WINDOW_SIZE = 10;

// ─── 背压和限流 ────────────────────────────────────────────

/** 最大并发工具执行数 */
export const MAX_CONCURRENT_TOOL_EXECUTION = 5;

/** 请求队列最大长度 */
export const MAX_REQUEST_QUEUE_SIZE = 100;

/** 令牌桶容量 */
export const TOKEN_BUCKET_CAPACITY = 10;

/** 令牌桶补充速率(每秒) */
export const TOKEN_BUCKET_REFILL_RATE = 2;

/** 背压触发阈值(队列使用率) */
export const BACKPRESSURE_THRESHOLD = 0.8;

// ─── Agent 限制 ────────────────────────────────────────────

/** 最大子代理生成深度 */
export const MAX_SPAWN_DEPTH = 3;

/** 最大运行中子代理数量(基础值，实际根据任务动态调整) */
export const MAX_RUNNING_SUBAGENTS = 5;

// ─── 看门狗与超时 ─────────────────────────────────────────

/** 看门狗默认超时(毫秒)- 5 分钟 */
export const WATCHDOG_DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/** 看门狗最大超时(毫秒)- 30 分钟 */
export const WATCHDOG_MAX_TIMEOUT_MS = 30 * 60 * 1000;

// ─── 熔断器 ──────────────────────────────────────────────

/** 熔断器默认阈值 - 连续 3 次错误触发 */
export const CIRCUIT_BREAKER_THRESHOLD = 3;

/** 熔断器重置时间(毫秒)- 5 分钟 */
export const CIRCUIT_BREAKER_RESET_TIMEOUT_MS = 5 * 60 * 1000;

/** 错误指纹最大历史记录数 */
export const CIRCUIT_BREAKER_MAX_HISTORY = 100;

// ─── 事件类型 ─────────────────────────────────────────────

/** 看门狗相关事件类型 */
export const EVENT_SUBAGENT_WATCHDOG_TIMEOUT = "subagent:watchdog:timeout";
export const EVENT_SUBAGENT_FORCED_TERMINATE = "subagent:forced:terminate";

// ─── 压缩协调 ────────────────────────────────────────────

/** 压缩协调锁超时时间(毫秒)- 默认 5 分钟 */
export const COMPRESSION_LOCK_TIMEOUT_MS = 5 * 60 * 1000;
