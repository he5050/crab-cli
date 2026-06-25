/**
 * 临时文件清理 — 启动时清理过期的 tmp 文件和旧备份。
 *
 * 职责:
 *   - 启动时清理过期的临时文件
 *   - 清理工具输出截断文件
 *   - 清理文件写入备份
 *   - 清理配置备份
 *
 * 模块功能:
 *   - runTmpCleanup: 执行所有临时文件清理
 *   - registerTmpCleanup: 注册退出时的清理回调
 *
 * 使用场景:
 *   - 应用启动时清理过期文件
 *   - 应用退出时清理临时文件
 *   - 定期维护磁盘空间
 *
 * 边界:
 *   1. 仅清理超过 7 天的文件
 *   2. 清理范围限定在 ~/.crab/ 目录
 *   3. 不影响正在使用的文件
 *
 * 流程:
 *   1. 应用启动时调用 runTmpCleanup
 *   2. 清理工具输出截断文件
 *   3. 清理文件写入备份
 *   4. 清理配置备份
 *   5. 注册退出时清理回调
 *
 * 清理范围:
 *   - ~/.crab/tmp/tool-output/ — 工具输出截断文件(>7天)
 *   - ~/.crab/tmp/backups/ — 文件写入备份(>7天)
 *   - ~/.crab/config.json.backup.* — 配置备份(>7天)
 */
import { cleanupOldBackups } from "@/config";
import { registerCleanup } from "@/bus/lifecycle/globalCleanup";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("tmp:cleanup");
const cleanupTasks = new Map<string, () => void>([["config-backups", cleanupOldBackups]]);

/** 注册临时文件清理任务。 */
export function registerTmpCleanupTask(name: string, task: () => void): void {
  cleanupTasks.set(name, task);
}

/** 移除临时文件清理任务，主要用于测试隔离。 */
export function unregisterTmpCleanupTask(name: string): void {
  cleanupTasks.delete(name);
}

/**
 * 执行所有临时文件清理。
 * 启动时调用一次，清理过期的文件。
 */
export function runTmpCleanup(): void {
  try {
    log.debug("开始清理临时文件...");
    for (const [name, task] of cleanupTasks) {
      try {
        task();
      } catch (error) {
        log.warn(`临时文件清理任务失败: ${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    log.debug("临时文件清理完成");
  } catch (error) {
    log.warn(`临时文件清理出错: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 注册退出时的清理回调。
 * 在应用初始化时调用一次。
 */
export function registerTmpCleanup(): void {
  registerCleanup(() => {
    runTmpCleanup();
  });
}
