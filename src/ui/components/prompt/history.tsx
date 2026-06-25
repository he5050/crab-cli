/**
 * [Prompt History]
 *
 * 职责:
 *   - 记录用户输入历史(最多 50 条)
 *   - 支持上下键浏览历史记录
 *   - JSONL 格式持久化存储到本地文件
 *   - 连续重复输入去重检测
 *
 * 模块功能:
 *   - usePromptHistory Hook:管理历史记录状态
 *   - 历史文件读写操作(~/.crab/prompt-history.jsonl)
 *   - 浏览历史时的当前输入暂存恢复
 *   - 损坏文件自修复机制
 *
 * 使用场景:
 *   - 用户按上键查看之前输入的命令/消息
 *   - 用户按下键返回较新的历史记录
 *   - 会话间保留输入历史
 *   - 提交输入时自动记录到历史
 *
 * 边界:
 *   1. 最大存储 50 条历史记录，超出时自动淘汰最旧记录
 *   2. 仅当输入与上一条不同时才添加(去重)
 *   3. 空输入或纯空白字符不会被记录
 *   4. 历史文件损坏时会尝试自修复重写
 *
 * 流程:
 *   1. 组件挂载时从 ~/.crab/prompt-history.jsonl 加载历史
 *   2. 用户提交输入时，push() 方法添加新记录(去重后追加)
 *   3. 用户按上下键时，move() 方法返回对应历史输入
 *   4. 首次按上键时自动保存当前输入，按到下键尽头时恢复
 */
import { createSignal, onMount } from "solid-js";
import { InputHistory, type InputHistoryEntry, inputHistoryFilePath } from "@/ui/contexts/inputHistory";

// ─── 类型 ──────────────────────────────────────────────────────

export type HistoryEntry = InputHistoryEntry;

// ─── PromptHistory 管理 ───────────────────────────────────────

export function usePromptHistory() {
  const inputHistory = new InputHistory(inputHistoryFilePath());
  const [history, setHistory] = createSignal<HistoryEntry[]>(inputHistory.getEntries());

  onMount(() => {
    inputHistory.reload();
    setHistory(inputHistory.getEntries());
  });

  /** 添加条目 */
  function push(input: string) {
    inputHistory.push(input);
    setHistory(inputHistory.getEntries());
  }

  /** 向上/向下浏览历史 */
  function move(direction: 1 | -1, currentInput: string): string | undefined {
    return inputHistory.move(direction, currentInput);
  }

  /** 重置浏览位置 */
  function reset() {
    inputHistory.reset();
  }

  /** 获取保存的输入(浏览历史前的输入) */
  function getSavedInput(): string {
    return inputHistory.getSavedInput();
  }

  return { getSavedInput, history, move, push, reset };
}
