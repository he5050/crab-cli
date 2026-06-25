/**
 * 文件锁服务 — 基于路径的互斥锁，防止多个工具并发修改同一文件。
 *
 * 职责:
 *   - 提供文件级互斥锁
 *   - 防止并发修改同一文件
 *   - 支持异步和同步锁
 *   - 锁队列管理
 *
 * 模块功能:
 *   - acquireFileLock: 异步获取文件锁
 *   - acquireFileLockSync: 同步获取文件锁
 *   - 基于 Promise 的锁队列
 *   - 自动锁清理
 *
 * 使用场景:
 *   - 多工具并发文件操作
 *   - 保证文件写入原子性
 *   - 防止竞态条件
 *
 * 边界:
 *   1. 基于路径的互斥锁
 *   2. 使用 Map 管理锁队列
 *   3. 同一文件操作串行执行
 *   4. 支持异步等待
 *   5. 需要手动释放锁
 *
 * 流程:
 *   1. 请求文件锁
 *   2. 检查现有锁
 *   3. 排队或立即获取
 *   4. 执行文件操作
 *   5. 释放锁
 */
import { createLogger } from "@/core/logging/logger";

const log = createLogger("tool:file-lock");

/** 文件路径 → 锁队列 */
const lockMap = new Map<string, Promise<void>>();

/**
 * 获取文件锁。
 * 返回一个 release 函数，调用后释放锁。
 *
 * 如果同一文件已有操作在进行，会排队等待。
 */
export async function acquireFileLock(filePath: string): Promise<() => void> {
  const key = filePath;
  const previousLock = lockMap.get(key) ?? Promise.resolve();

  let releaseFn!: () => void;
  const newLock = new Promise<void>((resolve) => {
    releaseFn = resolve;
  });

  // 链式等待:新锁在前一个锁之后
  const chained = previousLock.then(() => newLock);
  lockMap.set(key, chained);

  // 等待前一个锁释放
  await previousLock;

  log.debug(`文件锁已获取: ${key}`);

  // 清理已完成的锁
  const cleanup = () => {
    releaseFn();
    if (lockMap.get(key) === chained) {
      lockMap.delete(key);
    }
    log.debug(`文件锁已释放: ${key}`);
  };

  return cleanup;
}
