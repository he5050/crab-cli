/**
 * Dialog Context
 *
 * 职责:
 *   - 维护模态弹窗栈(stack 模式)
 *   - 管理弹窗的打开、关闭、清空、替换操作
 *   - 支持弹窗尺寸配置
 *
 * 模块功能:
 *   - 打开弹窗并压入栈顶
 *   - 关闭指定弹窗并从栈中移除
 *   - 清空所有弹窗
 *   - 替换当前弹窗
 *   - 设置弹窗尺寸(medium/large/xlarge)
 *
 * 使用场景:
 *   - 模态确认对话框
 *   - 表单弹窗
 *   - 详情展示弹窗
 *   - 多层弹窗嵌套
 *
 * 边界:
 *   1. 仅管理弹窗状态，不负责渲染逻辑
 *   2. 弹窗以栈结构管理，后开的先关
 *   3. 不支持弹窗优先级或遮罩层级自定义
 *
 * 流程:
 *   1. 调用 open() 创建弹窗并压入栈
 *   2. 用户交互后调用 close() 关闭弹窗
 *   3. 或调用 clear() 清空所有弹窗
 *   4. replace() 先清空再打开新弹窗
 */
import { batch, createSignal } from "solid-js";
import { createSimpleContext } from "@/ui/contexts/helper";

/** 弹窗项 */
export interface DialogItem {
  id: string;
  element: any;
  onClose?: () => void;
}

/** 弹窗尺寸 */
export type DialogSize = "medium" | "large" | "xlarge";

/** 弹窗 Context 值 */
export interface DialogContextValue {
  /** 当前弹窗栈 */
  stack: DialogItem[];
  /** 当前弹窗尺寸 */
  size: DialogSize;
  /** 打开弹窗，返回弹窗 ID */
  open(element: any, onClose?: () => void): string;
  /** 关闭指定弹窗(从栈顶弹出) */
  close(id: string): void;
  /** 关闭所有弹窗 */
  clear(): void;
  /** 替换当前弹窗为新的弹窗 */
  replace(element: any, onClose?: () => void): void;
  /** 设置弹窗尺寸 */
  setSize(size: DialogSize): void;
  /** 弹窗是否打开 */
  isOpen(): boolean;
}

export const { use: useDialog, provider: DialogProvider } = createSimpleContext<DialogContextValue>({
  init: () => {
    const [stack, setStack] = createSignal<DialogItem[]>([]);
    const [size, setSizeDirect] = createSignal<DialogSize>("medium");
    let nextId = 0;

    return {
      clear() {
        batch(() => {
          for (const item of stack()) {
            item.onClose?.();
          }
          setStack([]);
          setSizeDirect("medium");
        });
      },
      close(id: string) {
        setStack((prev) => {
          const item = prev.find((d) => d.id === id);
          item?.onClose?.();
          return prev.filter((d) => d.id !== id);
        });
      },
      isOpen() {
        return stack().length > 0;
      },
      open(element: any, onClose?: () => void): string {
        const id = `dialog_${++nextId}`;
        setStack((prev) => [...prev, { element, id, onClose }]);
        return id;
      },
      replace(element: any, onClose?: () => void) {
        batch(() => {
          for (const item of stack()) {
            item.onClose?.();
          }
          setSizeDirect("medium");
          setStack([{ element, id: `dialog_${++nextId}`, onClose }]);
        });
      },
      setSize(size: DialogSize) {
        setSizeDirect(size);
      },
      get size() {
        return size();
      },
      get stack() {
        return stack();
      },
    };
  },
  name: "Dialog",
});
