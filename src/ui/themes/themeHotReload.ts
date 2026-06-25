/**
 * 主题热重载 — 通过 SIGUSR2 信号触发主题重新加载。
 *
 * 职责:
 *   - 监听 SIGUSR2 信号
 *   - 重新扫描 ~/.crab/themes/*.json 自定义主题
 *   - 发布 ThemeChanged 事件通知 UI 更新
 *
 * 使用场景:
 *   - 开发时编辑主题 JSON 后热重载
 *   - 插件系统动态注入主题
 *
 * 边界:
 *   1. 仅在 Node.js 环境可用(Bun 兼容)
 *   2. 信号监听是进程级的
 *   3. 重复注册会自动去重
 */
import process from "node:process";
import { createLogger } from "@/core/logging/logger";
import { globalBus } from "@/bus";
import { AppEvent } from "@/bus";

const log = createLogger("theme:hot-reload");

let registered = false;

/**
 * 注册 SIGUSR2 信号监听器，触发主题热重载。
 *
 * 当收到 SIGUSR2 信号时:
 *   1. 记录日志
 *   2. 发布 ThemeChanged 事件
 *   3. UI 组件监听该事件后重新渲染
 *
 * 幂等: 重复调用不会注册多个监听器。
 */
export function registerThemeHotReload(): void {
  if (registered) {
    return;
  }
  registered = true;

  try {
    process.on("SIGUSR2", () => {
      log.info("收到 SIGUSR2 信号，触发热重载主题");
      try {
        globalBus.publish(AppEvent.ThemeChanged, { mode: "hot-reload" });
        log.info("主题热重载事件已发布");
      } catch (error) {
        log.error(`主题热重载事件发布失败: ${(error as Error).message}`);
      }
    });
    log.debug("SIGUSR2 主题热重载监听器已注册");
  } catch (error) {
    log.warn(`注册 SIGUSR2 监听器失败(可能不支持信号): ${(error as Error).message}`);
    registered = false;
  }
}

/**
 * 注销 SIGUSR2 信号监听器(主要用于测试)。
 */
export function unregisterThemeHotReload(): void {
  if (!registered) {
    return;
  }
  registered = false;
  try {
    process.removeAllListeners("SIGUSR2");
  } catch {
    // 忽略
  }
}
