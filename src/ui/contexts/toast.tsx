/**
 * Toast Context
 *
 * 职责:
 *   - 维护 Toast 通知列表状态
 *   - 提供显示/关闭 Toast 的方法
 *   - 支持自动消失定时器管理
 *
 * 模块功能:
 *   - 显示普通 Toast 通知(支持 info/success/warning/error 类型)
 *   - 显示带标题的 Toast 通知
 *   - 手动关闭指定 Toast
 *   - 自动清理过期 Toast
 *
 * 使用场景:
 *   - 操作成功/失败的反馈提示
 *   - 系统状态变更通知
 *   - 异步任务完成提示
 *
 * 边界:
 *   1. 仅管理 Toast 状态，不负责 UI 渲染
 *   2. 不持久化 Toast 数据
 *   3. 不支持 Toast 优先级排序
 *
 * 流程:
 *   1. 调用 show/showWithOptions 创建 Toast
 *   2. 添加到 Toast 列表并启动定时器
 *   3. 定时器触发或手动调用 dismiss 移除 Toast
 */
import { createSignal } from "solid-js";
import { createSimpleContext } from "@/ui/contexts/helper";

/** Toast 通知项 */
export interface ToastItem {
  id: string;
  message: string;
  type: "info" | "success" | "warning" | "error";
  title?: string;
  duration?: number;
}

/** Toast Context 值 */
export interface ToastContextValue {
  /** 当前 Toast 列表 */
  toasts: () => ToastItem[];
  /** 显示 Toast，返回 ID */
  show: (message: string, type?: ToastItem["type"], duration?: number) => string;
  /** 显示带标题的 Toast，返回 ID */
  showWithOptions: (options: {
    message: string;
    type?: ToastItem["type"];
    title?: string;
    duration?: number;
  }) => string;
  /** 手动关闭 Toast */
  dismiss: (id: string) => void;
}

export const { use: useToast, provider: ToastProvider } = createSimpleContext<ToastContextValue>({
  init: () => {
    const [toasts, setToasts] = createSignal<ToastItem[]>([]);
    let nextId = 0;
    /** 活跃的 Toast 定时器，用于 dismiss 时清理 */
    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    return {
      dismiss(id: string) {
        // 清理自动消失定时器，防止已关闭的 Toast 仍触发回调
        const timer = timers.get(id);
        if (timer) {
          clearTimeout(timer);
          timers.delete(id);
        }
        setToasts((prev) => prev.filter((t) => t.id !== id));
      },
      show(message: string, type: ToastItem["type"] = "info", duration = 3000): string {
        const id = `toast_${++nextId}`;
        const toast: ToastItem = { duration, id, message, type };
        setToasts((prev) => [...prev, toast]);

        // 自动消失
        if (duration > 0) {
          const timer = setTimeout(() => {
            timers.delete(id);
            setToasts((prev) => prev.filter((t) => t.id !== id));
          }, duration);
          timers.set(id, timer);
        }
        return id;
      },
      showWithOptions(options: {
        message: string;
        type?: ToastItem["type"];
        title?: string;
        duration?: number;
      }): string {
        const id = `toast_${++nextId}`;
        const toast: ToastItem = {
          duration: options.duration ?? 3000,
          id,
          message: options.message,
          title: options.title,
          type: options.type ?? "info",
        };
        setToasts((prev) => [...prev, toast]);

        if (toast.duration! > 0) {
          const timer = setTimeout(() => {
            timers.delete(id);
            setToasts((prev) => prev.filter((t) => t.id !== id));
          }, toast.duration);
          timers.set(id, timer);
        }
        return id;
      },
      toasts,
    };
  },
  name: "Toast",
});
