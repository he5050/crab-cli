/**
 * 剪贴板 Hook — 带 loading 状态和反馈的剪贴板操作。
 *
 * 职责:
 *   - 提供异步剪贴板读写能力
 *   - 管理 loading 状态
 *   - 提供操作反馈和错误处理
 *
 * 模块功能:
 *   - useClipboard: 创建剪贴板 Hook
 *   - read: 读取剪贴板内容
 *   - write: 写入内容到剪贴板
 *   - reset: 重置状态
 *   - ClipboardState: 剪贴板状态接口
 *
 * 使用场景:
 *   - UI 组件中的剪贴板操作
 *   - 需要状态反馈的复制粘贴
 *   - 跨平台剪贴板交互
 *
 * 边界:
 *   1. 仅处理剪贴板操作状态，不直接操作 UI
 *   2. 依赖 Solid.js 的 createSignal
 *   3. 底层使用 @core/clipboard
 *
 * 流程:
 *   1. 调用 useClipboard 创建 hook
 *   2. 使用 read/write 进行剪贴板操作
 *   3. 通过 state 获取当前状态
 *   4. 出错时通过 error 获取错误信息
 *   5. 使用 reset 重置状态
 */
import { createSignal } from "solid-js";
import { readClipboard, writeClipboard } from "@/core/io/clipboard";
import { createLogger } from "@/core/logging/logger";
const log = createLogger("clipboard:hook");

/** 剪贴板操作状态 */
interface ClipboardState {
  isLoading: boolean;
  error: string | null;
  lastOperation: "read" | "write" | null;
}

/** 剪贴板 Hook 返回类型 */
interface UseClipboardReturn {
  /** 当前状态 */
  state: ClipboardState;
  /** 读取剪贴板内容 */
  read: () => Promise<string | null>;
  /** 写入内容到剪贴板 */
  write: (text: string) => Promise<boolean>;
  /** 重置状态 */
  reset: () => void;
}

/**
 * 创建剪贴板 Hook。
 * @returns 剪贴板操作方法
 */
export function useClipboard(): UseClipboardReturn {
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [lastOperation, setLastOperation] = createSignal<"read" | "write" | null>(null);

  const reset = () => {
    setIsLoading(false);
    setError(null);
    setLastOperation(null);
    log.debug("剪贴板状态已重置");
  };

  const read = async (): Promise<string | null> => {
    setIsLoading(true);
    setError(null);
    setLastOperation("read");
    log.debug("开始读取剪贴板");

    try {
      const result = await readClipboard();
      if (result === null) {
        setError("未知错误");
        log.warn("未知错误");
      } else {
        log.debug("读取剪贴板成功", { length: result.length });
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(message);
      log.error("读取剪贴板异常", { error: message });
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const write = async (text: string): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    setLastOperation("write");
    log.debug("开始写入剪贴板", { length: text.length });

    try {
      const result = await writeClipboard(text);
      if (!result) {
        setError("未知错误");
        log.warn("未知错误");
      } else {
        log.debug("写入剪贴板成功", { length: text.length });
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(message);
      log.error("写入剪贴板异常", { error: message });
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  return {
    read,
    reset,
    state: {
      get error() {
        return error();
      },
      get isLoading() {
        return isLoading();
      },
      get lastOperation() {
        return lastOperation();
      },
    },
    write,
  };
}
