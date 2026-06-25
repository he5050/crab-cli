/**
 * Editor Context
 *
 * 职责:
 *   - 跟踪编辑器连接状态
 *   - 管理编辑器选区(selection)
 *   - 提供选区操作方法
 *
 * 模块功能:
 *   - 查询编辑器集成是否启用
 *   - 查询编辑器连接状态
 *   - 获取当前选区信息
 *   - 清除选区状态
 *   - 标记选区已发送
 *
 * 使用场景:
 *   - 获取编辑器中选中的代码
 *   - 将代码发送到对话
 *   - 跟踪选区发送状态
 *
 * 边界:
 *   1. 当前为简化版本，编辑器集成默认禁用
 *   2. 不依赖 effect/Schema 系统
 *   3. 未来可扩展 WebSocket 连接、LSP 集成
 *
 * 流程:
 *   1. 检测编辑器连接状态
 *   2. 获取当前选区信息
 *   3. 使用选区内容(如发送到对话)
 *   4. 标记选区已发送或清除选区
 */
import { createSignal } from "solid-js";
import { createSimpleContext } from "@/ui/contexts/helper";

/** 编辑器选区范围 */
export interface SelectionRange {
  text: string;
  start: { line: number; character: number };
  end: { line: number; character: number };
}

/** 编辑器选区 */
export interface EditorSelection {
  filePath: string;
  ranges: SelectionRange[];
}

/** 编辑器连接状态 */
export type EditorStatus = "disabled" | "connecting" | "connected";

/** 编辑器标签状态 */
export type EditorLabelState = "pending" | "sent" | "none";

export const { use: useEditorContext, provider: EditorContextProvider } = createSimpleContext<{
  /** 是否启用编辑器集成 */
  enabled(): boolean;
  /** 是否已连接 */
  connected(): boolean;
  /** 当前选区 */
  selection(): EditorSelection | undefined;
  /** 清除选区 */
  clearSelection(): void;
  /** 标记选区已发送 */
  markSelectionSent(): void;
  /** 标签状态 */
  labelState(): EditorLabelState;
}>({
  init: () => {
    const [selection, setSelection] = createSignal<EditorSelection | undefined>(undefined);
    const [selectionSent, setSelectionSent] = createSignal(false);

    return {
      clearSelection() {
        setSelection(undefined);
        setSelectionSent(false);
      },
      connected() {
        return false;
      },
      enabled() {
        // Crab-cli 暂时禁用编辑器集成
        // 未来可检测环境变量或 lock 文件
        return false;
      },
      labelState(): EditorLabelState {
        if (!selection()) {
          return "none";
        }
        return selectionSent() ? "sent" : "pending";
      },
      markSelectionSent() {
        if (selection()) {
          setSelectionSent(true);
        }
      },
      selection() {
        return selection();
      },
    };
  },
  name: "EditorContext",
});

/** 对齐计划与上层调用口径的别名导出 */
export const useEditor = useEditorContext;
