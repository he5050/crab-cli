/**
 * EventBus 进程生命周期管理 — 退出清理与测试重置。
 *
 * 职责:
 *   - 提供 `installGlobalProcessHandlers()` / `uninstallGlobalProcessHandlers()`
 *    显式注册/卸载进程退出处理器
 *   - 提供 `__resetGlobalBusForTest()` 测试重置工具
 *   - 与 `src/bus/eventBus.ts` 解耦,避免模块顶层副作用
 *
 * 使用:
 *   import { installGlobalProcessHandlers } from "@/bus"
 *   installGlobalProcessHandlers(globalBus)
 *
 * @see docs/architecture/event-bus.md 详细文档
 */
import { EventBus, globalBus } from "./eventBus";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("bus:lifecycle");

const processHandlersInstalled = new WeakSet<EventBus>();
const installedProcessListeners = new WeakMap<
  EventBus,
  {
    exit: () => void;
    SIGINT: () => void;
    SIGTERM: () => void;
  }
>();

async function gracefulDestroy(bus: EventBus): Promise<void> {
  try {
    await bus.flush(2000);
  } catch (error: unknown) {
    log.debug("EventBus flush 失败，继续销毁", { error: error instanceof Error ? error.message : String(error) });
  } finally {
    bus.destroy();
  }
}

export function installGlobalProcessHandlers(bus: EventBus = globalBus): void {
  if (processHandlersInstalled.has(bus)) {
    return;
  }
  processHandlersInstalled.add(bus);

  const exitListener = () => {
    bus.clear();
  };

  const sigintListener = () => {
    log.debug("收到 SIGINT 信号，异步 flush + 清理...");
    void gracefulDestroy(bus);
  };

  const sigtermListener = () => {
    log.debug("收到 SIGTERM 信号，异步 flush + 清理...");
    void gracefulDestroy(bus);
  };

  installedProcessListeners.set(bus, {
    exit: exitListener,
    SIGINT: sigintListener,
    SIGTERM: sigtermListener,
  });

  process.on("exit", exitListener);
  process.once("SIGINT", sigintListener);
  process.once("SIGTERM", sigtermListener);
}

export function uninstallGlobalProcessHandlers(bus: EventBus = globalBus): void {
  if (!processHandlersInstalled.has(bus)) {
    return;
  }
  processHandlersInstalled.delete(bus);
  const listeners = installedProcessListeners.get(bus);
  if (!listeners) {
    return;
  }
  process.off("exit", listeners.exit);
  process.off("SIGINT", listeners.SIGINT);
  process.off("SIGTERM", listeners.SIGTERM);
  installedProcessListeners.delete(bus);
}

export function __resetGlobalBusForTest(): EventBus {
  uninstallGlobalProcessHandlers(globalBus);
  globalBus.clear();
  return globalBus;
}
