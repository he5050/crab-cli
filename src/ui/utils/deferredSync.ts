/**
 * 延迟同步工厂 — 统一三处(statusBar / footer / questionEventBridge)的防抖模式。
 *
 * 核心模式: disposed 守卫 + pendingSync 去重 + setTimeout(fn, 0) 宏任务延迟。
 *
 * 使用方式:
 *   const { disposed, schedule } = createDeferredSync(syncFn);
 *   // 事件回调中调用 schedule() 即可
 *   onCleanup(() => disposed.current = true);
 */

/**
 * 创建延迟同步控制器。
 *
 * @param syncFn - 需要延迟执行的同步函数（通常会调用 renderer.requestRender()）
 * @returns disposed 标志（组件卸载时设为 true）和 schedule 调度函数
 */
export function createDeferredSync(syncFn: () => void): {
  disposed: { current: boolean };
  schedule: () => void;
} {
  const disposed = { current: false };
  let pendingSync: Timer | undefined;

  const schedule = () => {
    if (disposed.current || pendingSync) {
      return;
    }
    pendingSync = setTimeout(() => {
      pendingSync = undefined;
      if (disposed.current) {
        return;
      }
      syncFn();
    }, 0);
  };

  return { disposed, schedule };
}
