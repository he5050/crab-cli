/**
 * UseMessageUndo — 消息级撤销/重做 Hook
 *
 * 职责:
 *   - 管理消息列表的撤销/重做状态
 *   - 提供 undo/redo 操作接口
 *   - 维护 undo/redo 栈的数据一致性
 *
 * 模块功能:
 *   - 创建消息级 undo/redo 实例
 *   - 支持撤销最后一轮对话(user + 后续消息)
 *   - 支持重做最近一次撤销的操作
 *   - 提供 canUndo/canRedo 状态查询
 *   - 支持清空 undo/redo 栈
 *
 * 使用场景:
 *   - 在 ChatContext 中集成消息撤销功能
 *   - 用户需要撤销误发送的消息时
 *   - 需要实现 Ctrl+Z / Ctrl+Shift+Z 快捷键时
 *   - 清空会话时需要重置撤销栈时
 *
 * 边界:
 *   1. 仅支持按"轮"撤销(从最后一个 user 消息开始到末尾)
 *   2. 新 undo 操作会清空 redo 栈
 *   3. 依赖外部传入的 getMessages 和 setMessages
 *   4. 不处理键盘事件绑定(由调用方处理)
 *
 * 流程:
 *   1. 调用 createMessageUndo 创建实例
 *   2. 用户触发 undo → 找到最后一轮对话 → 移入 undo 栈
 *   3. 用户触发 redo → 从 redo 栈弹出 → 恢复消息
 *   4. 调用 clearStacks 清空所有栈
 */
import type { Setter } from "solid-js";
import type { ChatMessage } from "@/ui/contexts/chat";

export interface UndoEntry {
  messages: ChatMessage[];
}

export interface MessageUndoAPI {
  /** 执行 undo，返回 true 表示成功 */
  undo: () => boolean;
  /** 执行 redo，返回 true 表示成功 */
  redo: () => boolean;
  /** 是否可以 undo */
  canUndo: () => boolean;
  /** 是否可以 redo */
  canRedo: () => boolean;
  /** 清空 undo/redo 栈(clear 时调用) */
  clearStacks: () => void;
}

/**
 * 找到最后一轮对话的起始索引。
 * 一轮 = 最后一个 user 消息 + 后续直到末尾的所有 assistant/tool/system 消息。
 */
function findLastUserMessageIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") {
      return i;
    }
  }
  return -1;
}

/**
 * 创建消息级 undo/redo 实例。
 * 与 chat context 的 setMessages 绑定。
 */
export function createMessageUndo(
  getMessages: () => ChatMessage[],
  setMessages: Setter<ChatMessage[]>,
): MessageUndoAPI {
  let undoStack: UndoEntry[] = [];
  let redoStack: UndoEntry[] = [];

  const undo = (): boolean => {
    const messages = getMessages();
    const userIdx = findLastUserMessageIndex(messages);
    if (userIdx === -1) {
      return false;
    }

    const removed = messages.slice(userIdx);
    undoStack.push({ messages: removed });
    redoStack = []; // 新 undo 清空 redo

    setMessages(messages.slice(0, userIdx));
    return true;
  };

  const redo = (): boolean => {
    if (redoStack.length === 0) {
      return false;
    }

    const entry = redoStack.pop()!;
    undoStack.push(entry); // Redo 的内容可以再 undo

    const messages = getMessages();
    setMessages([...messages, ...entry.messages]);
    return true;
  };

  const canUndo = (): boolean => {
    const messages = getMessages();
    return findLastUserMessageIndex(messages) !== -1;
  };

  const canRedo = (): boolean => redoStack.length > 0;

  const clearStacks = () => {
    undoStack = [];
    redoStack = [];
  };

  return { canRedo, canUndo, clearStacks, redo, undo };
}
