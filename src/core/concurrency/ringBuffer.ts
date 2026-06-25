/**
 * 通用环形缓冲(FIFO 队列 + 容量上限)。
 *
 * 职责:
 *   - 提供 O(1) 的 push / shift 操作，避免大数组头部 shift 时的 O(n) 元素移动
 *   - 在满容量时自动覆盖最旧元素(适用于滑窗/历史裁剪场景)
 *   - 提供 [Symbol.iterator] 以保持 `for...of`、`...spread` 等使用方式
 *
 * 使用场景:
 *   - 替换 `Array.prototype.shift` 频繁调用导致的 O(n) 退化
 *   - 替换 `if (arr.length > N) arr.shift()` 的滑窗模式
 *   - 替换 `arr.shift()` 出队的 FIFO 队列
 *
 * 边界:
 *   1. 容量必须 >= 1(否则构造抛错)
 *   2. 容量固定(不支持动态扩容)
 *   3. shift 在空时返回 undefined，调用方需自行处理
 *   4. 不支持随机访问 / removeAt / indexOf 等本项目未使用的方法
 *
 * 性能:
 *   - push / shift:O(1) 摊销
 *   - toArray / [Symbol.iterator]:O(n) 一次性快照
 */

/**
 * 通用环形缓冲(FIFO)。
 *
 * 行为约定:
 *   - 元素按入队顺序出队(FIFO)
 *   - 容量固定为构造时指定的 `capacity`
 *   - 满容量后再 push 会覆盖最旧元素(FIFO + 滑窗语义)
 */
export class RingBuffer<T> implements Iterable<T> {
  private readonly buffer: (T | undefined)[];
  private readonly capacityValue: number;
  /** 队首元素索引 */
  private head = 0;
  /** 当前元素数量 */
  private count = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`RingBuffer: capacity must be a positive integer, got ${capacity}`);
    }
    this.capacityValue = capacity;
    // oxlint-disable-next-line unicorn/no-new-array
    this.buffer = new Array<T | undefined>(capacity);
  }

  /** 当前元素数 */
  get size(): number {
    return this.count;
  }

  /** 最大容量(构造时固定) */
  get capacity(): number {
    return this.capacityValue;
  }

  /** 是否为空 */
  isEmpty(): boolean {
    return this.count === 0;
  }

  /** 是否已满 */
  isFull(): boolean {
    return this.count === this.capacityValue;
  }

  /**
   * 入队。满容量时覆盖最旧元素(最旧元素被丢弃)。
   */
  push(item: T): void {
    if (this.count < this.capacityValue) {
      const tail = (this.head + this.count) % this.capacityValue;
      this.buffer[tail] = item;
      this.count++;
    } else {
      // 满容量:覆盖 head 位置(最旧元素)，并前移 head
      this.buffer[this.head] = item;
      this.head = (this.head + 1) % this.capacityValue;
    }
  }

  /**
   * 出队(FIFO)。空时返回 undefined。
   */
  shift(): T | undefined {
    if (this.count === 0) {
      return undefined;
    }
    const item = this.buffer[this.head];
    this.buffer[this.head] = undefined; // 释放引用，便于 GC
    this.head = (this.head + 1) % this.capacityValue;
    this.count--;
    return item;
  }

  /**
   * 窥探队首元素，不消费。空时返回 undefined。
   */
  peek(): T | undefined {
    if (this.count === 0) {
      return undefined;
    }
    return this.buffer[this.head];
  }

  /**
   * 浅拷贝快照(按 FIFO 顺序)。
   */
  toArray(): T[] {
    // oxlint-disable-next-line unicorn/no-new-array
    const result: T[] = new Array(this.count);
    for (let i = 0; i < this.count; i++) {
      result[i] = this.buffer[(this.head + i) % this.capacityValue] as T;
    }
    return result;
  }

  /**
   * 清空所有元素。
   */
  clear(): void {
    for (let i = 0; i < this.count; i++) {
      this.buffer[(this.head + i) % this.capacityValue] = undefined;
    }
    this.head = 0;
    this.count = 0;
  }

  /**
   * 批量入队。等效于对每个元素调用 push，但统一检查一次。
   */
  pushMany(items: readonly T[]): void {
    for (const item of items) {
      this.push(item);
    }
  }

  /**
   * 重置为指定数组内容。先清空再批量入队。
   */
  resetFromArray(items: T[]): void {
    this.clear();
    this.pushMany(items);
  }

  /**
   * 按 FIFO 顺序遍历。
   */
  *[Symbol.iterator](): Iterator<T> {
    for (let i = 0; i < this.count; i++) {
      yield this.buffer[(this.head + i) % this.capacityValue] as T;
    }
  }
}
