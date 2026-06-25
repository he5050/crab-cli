/**
 * FileWatcher 模块
 *
 * 职责:
 *   - 监控项目目录下的文件创建/修改/删除事件
 *   - 过滤出源代码文件(使用 language.ts 检测)
 *   - 防抖处理后批量触发回调
 *   - 管理文件监控的生命周期
 *
 * 模块功能:
 *   - FileWatcher 类:文件监控器核心类
 *   - start: 启动文件监控
 *   - stop: 停止文件监控
 *   - isRunning: 检查监控状态
 *   - getPendingCount: 获取待处理事件数
 *   - handleFsEvent: 处理文件系统事件
 *   - flushEvents: 批量处理待处理事件
 *
 * 使用场景:
 *   - 开发时实时同步代码变更到索引
 *   - 监控代码文件变化触发重新索引
 *   - 批量处理文件变更事件
 *   - 避免频繁触发索引操作
 *
 * 边界:
 *   1. 依赖 Bun.watch API(Bun 环境)
 *   2. 默认排除 node_modules、.git 等目录
 *   3. 仅监控有语言支持的源代码文件
 *   4. 防抖间隔默认 500ms
 *   5. 停止时处理剩余待处理事件
 *
 * 流程:
 *   1. 初始化配置(根目录、排除目录、回调)
 *   2. 启动 Bun.watch 监控文件系统事件
 *   3. 过滤排除目录和非代码文件
 *   4. 将事件加入待处理队列
 *   5. 防抖定时器触发后批量处理
 *   6. 调用用户回调通知变更事件
 */
import { createLogger } from "@/core/logging/logger";
import { detectLanguage } from "@/lsp/language/language";
import { join } from "node:path";
import { existsSync } from "node:fs";

const log = createLogger("search:watcher");

/** Bun.watch 函数签名（Bun 全局类型可能不包含此 API） */
type BunWatchFn = (
  path: string,
  options: { recursive: boolean; handler: (event: string, filePath: string) => void },
) => { close: () => void };

/** 文件变更事件 */
export interface FileChangeEvent {
  /** 事件类型 */
  type: "create" | "modify" | "delete";
  /** 文件路径(绝对路径) */
  filePath: string;
  /** 时间戳 */
  timestamp: number;
}

/** 文件变更回调 */
export type FileChangeCallback = (events: FileChangeEvent[]) => void | Promise<void>;

/** 文件监控器配置 */
export interface FileWatcherConfig {
  /** 监控的根目录 */
  rootDir: string;
  /** 排除的目录名 */
  excludeDirs?: string[];
  /** 防抖间隔(毫秒)，默认 500 */
  debounceMs?: number;
  /** 变更回调 */
  onChange: FileChangeCallback;
}

/** 默认排除目录 */
const DEFAULT_EXCLUDES = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "coverage",
  ".cache",
  "vendor",
  "__pycache__",
  ".tox",
  "target",
  ".turbo",
]);

/**
 * 文件监控器。
 *
 * 使用 Bun 的 fs.watch API 监控文件变更，防抖后批量通知回调。
 */
/** FileWatcher */
export class FileWatcher {
  private rootDir: string;
  private excludeDirs: Set<string>;
  private debounceMs: number;
  private onChange: FileChangeCallback;

  private watcher: { close: () => void } | null = null;
  private pendingEvents = new Map<string, FileChangeEvent>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(config: FileWatcherConfig) {
    this.rootDir = config.rootDir;
    this.excludeDirs = new Set([...DEFAULT_EXCLUDES, ...(config.excludeDirs ?? [])]);
    this.debounceMs = config.debounceMs ?? 500;
    this.onChange = config.onChange;
  }

  /**
   * 启动文件监控。
   */
  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;

    try {
      // Bun.watch 在某些环境中可能不可用
      const maybeWatch = (Bun as unknown as { watch?: BunWatchFn }).watch;
      if (typeof Bun !== "undefined" && typeof maybeWatch === "function") {
        this.watcher = maybeWatch(this.rootDir, {
          handler: (event: string, filePath: string) => {
            this.handleFsEvent(event, filePath);
          },
          recursive: true,
        });
        log.info(`文件监控已启动: ${this.rootDir}`);
      } else {
        log.warn("Bun.watch 不可用，文件监控已禁用");
        this.running = false;
      }
    } catch (error) {
      log.error(`文件监控启动失败`, { error: error instanceof Error ? error.message : String(error) });
      this.running = false;
    }
  }

  /**
   * 停止文件监控。
   */
  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    // 处理剩余事件
    if (this.pendingEvents.size > 0) {
      this.flushEvents();
    }

    log.info("文件监控已停止");
  }

  /**
   * 是否正在运行。
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * 获取待处理的事件数。
   */
  getPendingCount(): number {
    return this.pendingEvents.size;
  }

  // ── 内部方法 ────────────────────────────────────────────────────

  private handleFsEvent(event: string, filePath: string): void {
    if (!this.running) {
      return;
    }

    // 解析绝对路径
    const absolutePath = filePath.startsWith("/") ? filePath : join(this.rootDir, filePath);

    // 过滤排除目录
    if (this.isExcludedPath(absolutePath)) {
      return;
    }

    // 过滤非代码文件
    const lang = detectLanguage(absolutePath);
    if (!lang) {
      return;
    }

    // 判断事件类型
    let type: FileChangeEvent["type"];
    if (event === "create") {
      type = "create";
    } else if (event === "delete") {
      type = "delete";
    } else {
      // Modify 或 rename 等都视为 modify
      // 进一步检查文件是否存在来区分 create/delete/modify
      if (existsSync(absolutePath)) {
        type = "modify";
      } else {
        type = "delete";
      }
    }

    // 添加到待处理队列
    this.pendingEvents.set(absolutePath, {
      filePath: absolutePath,
      timestamp: Date.now(),
      type,
    });

    // 防抖
    this.scheduleFlush();
  }

  private isExcludedPath(filePath: string): boolean {
    const parts = filePath.split("/");
    for (const part of parts) {
      if (this.excludeDirs.has(part)) {
        return true;
      }
    }
    return false;
  }

  private scheduleFlush(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.flushEvents();
    }, this.debounceMs);
  }

  private flushEvents(): void {
    if (this.pendingEvents.size === 0) {
      return;
    }

    const events = [...this.pendingEvents.values()];
    this.pendingEvents.clear();

    log.debug(`文件变更: ${events.length} 个事件`);
    for (const e of events) {
      log.debug(`  ${e.type}: ${e.filePath}`);
    }

    // 异步调用回调
    try {
      const result = this.onChange(events);
      if (result instanceof Promise) {
        result.catch((error) => {
          log.error("文件变更回调失败", { error: error instanceof Error ? error.message : String(error) });
        });
      }
    } catch (error) {
      log.error("文件变更回调失败", { error: error instanceof Error ? error.message : String(error) });
    }
  }
}
