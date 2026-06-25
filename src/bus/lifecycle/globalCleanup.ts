/**
 * 全局清理注册器 — 管理应用退出时需要执行的清理回调。
 *
 * 职责:
 *   - 注册/注销清理回调
 *   - 在应用退出时按 LIFO 顺序执行清理
 *   - 管理清理超时
 *
 * 模块功能:
 *   - registerCleanup:注册清理回调
 *   - unregisterCleanup:注销清理回调
 *   - runCleanup:执行所有清理回调
 *
 * 使用场景:
 *   - 应用退出时释放资源
 *   - 关闭数据库连接
 *   - 清理临时文件
 *
 * 边界:
 *   1. 仅管理回调注册，不涉及具体清理逻辑
 *   2. 清理执行有超时限制
 *
 * 流程:
 *   1. 应用启动时注册清理回调
 *   2. 应用退出时触发清理
 *   3. 按 LIFO 顺序执行回调
 *   4. 超时后强制退出
 */

import { createLogger } from "@/core/logging/logger";
const log = createLogger("cleanup");

/** 清理回调集合 */
const handlers = new Set<() => void | Promise<void>>();

/** 默认清理超时时间(毫秒) */
const DEFAULT_CLEANUP_TIMEOUT = 5000;

/**
 * 注册一个在应用退出时执行的清理回调。
 * 回调按注册顺序的反序(LIFO)执行。
 *
 * @param handler - 清理回调，可返回 Promise
 * @returns 取消注册函数
 */
export function registerCleanup(handler: () => void | Promise<void>): () => void {
  handlers.add(handler);
  log.debug(`注册清理回调，当前共 ${handlers.size} 个`);

  return () => {
    const deleted = handlers.delete(handler);
    if (deleted) {
      log.debug(`注销清理回调，当前共 ${handlers.size} 个`);
    }
  };
}

/**
 * 注销指定清理回调。
 *
 * @param handler - 要注销的回调
 */
export function unregisterCleanup(handler: () => void | Promise<void>): void {
  handlers.delete(handler);
}

/**
 * 执行所有注册的清理回调。
 * 按 LIFO 顺序执行(后注册的先执行)。
 * 所有回调执行完毕后清空注册表。
 *
 * @param timeoutMs - 每个回调的超时时间(默认 5000ms)
 * @returns 是否有回调抛出错误或超时
 */
export async function runCleanup(timeoutMs = DEFAULT_CLEANUP_TIMEOUT): Promise<boolean> {
  const handlersArray = [...handlers].toReversed();
  log.info(`开始执行全局清理: ${handlersArray.length} 个回调，超时 ${timeoutMs}ms`);
  handlers.clear();

  let hadError = false;
  let completed = 0;
  let failed = 0;

  for (let i = 0; i < handlersArray.length; i++) {
    const handler = handlersArray[i]!;
    const index = i + 1;
    log.debug(`执行清理回调 ${index}/${handlersArray.length}`);

    try {
      // 使用 Promise.race 添加超时保护
      await Promise.race([
        handler(),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error(`清理超时(${timeoutMs}ms)`)), timeoutMs)),
      ]);
      completed++;
      log.debug(`清理回调 ${index}/${handlersArray.length} 完成`);
    } catch (error) {
      hadError = true;
      failed++;
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error(`清理回调 ${index}/${handlersArray.length} 失败: ${errorMsg}`);
      // eslint-disable-next-line no-console
      console.error(`清理回调失败: ${errorMsg}`);
    }
  }

  if (hadError) {
    log.warn(`全局清理完成: ${completed} 成功, ${failed} 失败`);
  } else {
    log.info(`全局清理完成: ${completed} 个回调全部成功`);
  }

  return hadError;
}

/**
 * 清空所有注册的清理回调。
 */
export function clearCleanup(): void {
  handlers.clear();
}
