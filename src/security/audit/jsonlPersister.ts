/**
 * JSONL 持久化工具 — 审计日志的 JSONL 文件读写。
 *
 * 职责:
 *   - JSONL 文件追加写入（writePromise 串行化，保证顺序一致）
 *   - JSONL 文件加载（损坏行跳过 + 计数日志告警）
 *   - 原子写入（tmp + rename，防止写入中断导致数据丢失）
 *   - 文件轮转（超限时自动重命名旧文件，保留 N 个历史版本）
 *
 * 使用场景:
 *   - AuditLogger 文件持久化
 *   - FileAuditStore 文件存储
 *
 * 边界:
 *   1. writePromise 串行化保证写入顺序
 *   2. 连续写入失败 ≥5 次时 log.warn 告警
 *   3. 轮转时保留最多 maxRotationFiles 个历史文件
 *   4. 原子写入通过 tmp+rename 实现
 */

import fs from "node:fs";
import { dirname } from "node:path";
import { type LogMetadata, createLogger } from "@/core/logging/logger";

const log = createLogger("security:audit:jsonl");

export interface JsonlPersisterOptions {
  /** 单个文件最大字节数（超过后自动轮转），默认 10MB */
  maxFileSize?: number;
  /** 最大保留轮转文件数，默认 3 */
  maxRotationFiles?: number;
}

export class JsonlPersister {
  private filePath: string;
  private writePromise: Promise<void> = Promise.resolve();
  private maxFileSize: number;
  private maxRotationFiles: number;
  private _consecutiveWriteFailures = 0;

  constructor(filePath: string, options?: JsonlPersisterOptions) {
    this.filePath = filePath;
    this.maxFileSize = options?.maxFileSize ?? 10 * 1024 * 1024;
    this.maxRotationFiles = options?.maxRotationFiles ?? 3;
  }

  /** 连续写入失败次数 */
  get consecutiveWriteFailures(): number {
    return this._consecutiveWriteFailures;
  }

  /** 获取文件路径 */
  getFilePath(): string {
    return this.filePath;
  }

  /** 文件是否存在 */
  exists(): boolean {
    return fs.existsSync(this.filePath);
  }

  /** 确保文件目录存在 */
  private async ensureDir(): Promise<void> {
    const dir = dirname(this.filePath);
    if (dir) {
      await fs.promises.mkdir(dir, { recursive: true });
    }
  }

  /**
   * 异步追加内容到 JSONL 文件（writePromise 串行化保证顺序）。
   * 写入前自动检查文件大小，超限则执行轮转。
   */
  appendLine(line: string): Promise<void> {
    this.writePromise = this.writePromise
      .then(async () => {
        await this.ensureDir();
        await this.rotateIfNeeded();
        await fs.promises.appendFile(this.filePath, line, "utf8");
        this._consecutiveWriteFailures = 0;
      })
      .catch((err: unknown) => {
        this._consecutiveWriteFailures++;
        log.error("JSONL 追加写入失败", err as LogMetadata);
        if (this._consecutiveWriteFailures >= 5) {
          log.warn(`JSONL 连续写入失败 ${this._consecutiveWriteFailures} 次，请检查磁盘空间和权限`);
        }
        throw err;
      });
    return this.writePromise;
  }

  /** 等待所有待写入完成 */
  async flush(): Promise<void> {
    await this.writePromise;
  }

  /**
   * 加载 JSONL 文件，返回解析后的对象数组和损坏行计数。
   * 损坏行被跳过并通过 log.warn 告警。
   */
  async load<T>(): Promise<{ entries: T[]; corruptLineCount: number }> {
    try {
      if (!fs.existsSync(this.filePath)) {
        return { corruptLineCount: 0, entries: [] };
      }
      const content = await fs.promises.readFile(this.filePath, "utf8");
      const lines = content.split("\n").filter(Boolean);
      const entries: T[] = [];
      let corruptLineCount = 0;
      for (const line of lines) {
        try {
          entries.push(JSON.parse(line) as T);
        } catch {
          corruptLineCount++;
        }
      }
      if (corruptLineCount > 0) {
        log.warn(`JSONL 加载完成，跳过 ${corruptLineCount} 行损坏数据`);
      }
      return { corruptLineCount, entries };
    } catch {
      log.error("JSONL 文件加载失败");
      return { corruptLineCount: 0, entries: [] };
    }
  }

  /**
   * 原子写入整个文件（先写临时文件，成功后 rename 覆盖）。
   * 防止写入过程中断导致数据丢失。
   */
  async atomicWrite(content: string): Promise<void> {
    await this.ensureDir();
    const tmpPath = `${this.filePath}.tmp`;
    await fs.promises.writeFile(tmpPath, content, "utf8");
    await fs.promises.rename(tmpPath, this.filePath);
  }

  /** 清空文件内容（用于 clear() 操作） */
  async clear(): Promise<void> {
    try {
      if (fs.existsSync(this.filePath)) {
        await fs.promises.writeFile(this.filePath, "", "utf8");
      }
    } catch {
      // 非生产环境忽略清理错误
    }
  }

  /**
   * 文件轮转: 超限时将当前文件重命名为 .1, .2, ...
   * 超出 maxRotationFiles 的最旧文件直接删除。
   */
  private async rotateIfNeeded(): Promise<void> {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const stat = await fs.promises.stat(this.filePath);
      if (stat.size < this.maxFileSize) return;

      log.info(`JSONL 文件超过 ${this.maxFileSize} 字节，执行轮转: ${this.filePath}`);

      // 删除最旧的轮转文件（超出保留上限的）
      const oldest = `${this.filePath}.${this.maxRotationFiles}`;
      if (fs.existsSync(oldest)) {
        await fs.promises.unlink(oldest);
      }

      // .n-1 → .n, .n-2 → .n-1, ... , current → .1
      for (let i = this.maxRotationFiles - 1; i >= 1; i--) {
        const src = i === 1 ? this.filePath : `${this.filePath}.${i}`;
        const dst = `${this.filePath}.${i + 1}`;
        if (fs.existsSync(src)) {
          await fs.promises.rename(src, dst);
        }
      }
    } catch (err) {
      log.error("JSONL 轮转失败", err as LogMetadata);
    }
  }
}
