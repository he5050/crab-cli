/**
 * DialogStash
 *
 * 职责:
 *   - 显示暂存条目列表(最新在前)
 *   - 选择条目后恢复到输入框
 *   - 支持 D 键删除条目(双击确认)
 *   - 显示相对时间
 *
 * 模块功能:
 *   - 从 prompt stash 获取暂存条目列表
 *   - 格式化显示条目预览(截断第一行)
 *   - 计算并显示相对时间(刚刚、X分钟前等)
 *   - 处理键盘导航(↑↓ 选择，Enter 恢复，D 删除，Esc 取消)
 *   - 支持鼠标点击选择条目
 *
 * 使用场景:
 *   - 用户需要恢复之前暂存的输入内容
 *   - 管理历史输入记录(查看、恢复、删除)
 *   - 快速复用之前的提示词
 *
 * 边界:
 *   1. 仅显示通过 prompt stash 保存的条目
 *   2. 删除操作需要双击 D 键确认
 *   3. 选择后条目会从 stash 中移除
 *
 * 流程:
 *   1. 获取暂存条目列表
 *   2. 渲染条目列表(预览 + 时间 + 行数)
 *   3. 处理键盘/鼠标选择
 *   4. 恢复选中条目到输入框或删除
 */
import { createMemo, createSignal } from "solid-js";
import { useTheme } from "@/ui/contexts/theme";
import { useDialog } from "@/ui/contexts/dialog";
import { type StashEntry, usePromptStash } from "@/ui/components/prompt/stash";
import { DialogHeader, DialogOverlay } from "@/ui/components/dialogUi";
import { For, Show } from "solid-js";
import type { KeyboardEventLike } from "@/ui/types";

/** 相对时间 */
function getRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) {
    return "刚刚";
  }
  if (minutes < 60) {
    return `${minutes}分钟前`;
  }
  if (hours < 24) {
    return `${hours}小时前`;
  }
  if (days < 7) {
    return `${days}天前`;
  }
  return new Date(timestamp).toLocaleDateString();
}

/** 截断预览 */
function getStashPreview(input: string, maxLength = 50): string {
  const firstLine = input.split("\n")[0]?.trim() ?? "";
  return firstLine.length > maxLength ? `${firstLine.slice(0, maxLength)}…` : firstLine;
}

interface DialogStashProps {
  onSelect: (entry: StashEntry) => void;
  onClose?: () => void;
  stash?: ReturnType<typeof usePromptStash>;
}

export function DialogStash(props: DialogStashProps) {
  const theme = useTheme();
  const dialog = useDialog();
  const localStash = usePromptStash();
  const stash = props.stash ?? localStash;

  const [toDelete, setToDelete] = createSignal<number | undefined>(undefined);
  const [selectedIndex, setSelectedIndex] = createSignal(0);

  const options = createMemo(() => {
    const entries = stash.list();
    // 最新在前
    return entries
      .map((entry, index) => {
        const isDeleting = toDelete() === index;
        const lineCount = (entry.input.match(/\n/g)?.length ?? 0) + 1;
        return {
          index,
          isDeleting,
          lines: lineCount > 1 ? `~${lineCount} 行` : undefined,
          preview: isDeleting ? "再次按 D 确认删除" : getStashPreview(entry.input),
          time: getRelativeTime(entry.timestamp),
        };
      })
      .toReversed();
  });

  const close = () => {
    props.onClose?.();
    if (!props.onClose) {
      dialog.clear();
    }
  };

  function handleKeyDown(event: KeyboardEventLike) {
    const items = options();
    if (event.name === "up") {
      event.stopPropagation?.();
      setSelectedIndex((i) => Math.max(0, i - 1));
      setToDelete(undefined);
    } else if (event.name === "down") {
      event.stopPropagation?.();
      setSelectedIndex((i) => Math.min(items.length - 1, i + 1));
      setToDelete(undefined);
    } else if (event.name === "return" || event.name === "enter") {
      event.stopPropagation?.();
      const item = items[selectedIndex()];
      if (item) {
        const entries = stash.list();
        const entry = entries[item.index];
        if (entry) {
          stash.remove(item.index);
          props.onSelect(entry);
        }
        close();
      }
    } else if (event.name === "escape") {
      event.stopPropagation?.();
      close();
    } else if (event.key === "d" || event.key === "D") {
      event.stopPropagation?.();
      const item = items[selectedIndex()];
      if (!item) {
        return;
      }
      if (toDelete() === item.index) {
        // 确认删除
        stash.remove(item.index);
        setToDelete(undefined);
      } else {
        setToDelete(item.index);
      }
    }
  }

  return (
    <DialogOverlay onClose={close} size="medium">
      <DialogHeader title="暂存" />
      <box paddingLeft={1} paddingRight={1} flexDirection="column" maxHeight={20}>
        <Show when={options().length === 0}>
          <text fg={theme.colors.muted}>没有暂存条目</text>
        </Show>
        <For each={options()}>
          {(option, index) => (
            <box
              flexDirection="row"
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={index() === selectedIndex() ? theme.extended.bg.element : undefined}
              onMouseUp={() => {
                setSelectedIndex(index());
                const entries = stash.list();
                const entry = entries[option.index];
                if (entry) {
                  stash.remove(option.index);
                  props.onSelect(entry);
                }
                close();
              }}
            >
              <text
                fg={
                  option.isDeleting
                    ? theme.colors.error
                    : index() === selectedIndex()
                      ? theme.colors.primary
                      : theme.colors.text
                }
              >
                {index() === selectedIndex() ? "› " : "  "}
                {option.preview}
              </text>
              <Show when={option.time}>
                <text fg={theme.colors.muted}> — {option.time}</text>
              </Show>
              <Show when={option.lines}>
                <text fg={theme.colors.muted}> {option.lines}</text>
              </Show>
            </box>
          )}
        </For>
      </box>
      <box paddingLeft={1} paddingRight={1} paddingTop={1}>
        <text fg={theme.colors.muted}>↑↓ 选择 · Enter 恢复 · D 删除 · Esc 取消</text>
      </box>
      {/* 使弹窗可接收键盘事件 */}
      <input focused={true} onKeyDown={handleKeyDown} style={{ opacity: 0, width: 0 } as any} />
    </DialogOverlay>
  );
}
