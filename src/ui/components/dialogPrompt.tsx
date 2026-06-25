/**
 * 提示对话框组件 — 带输入框的模态对话框。
 *
 * 职责:
 *   - 显示模态对话框，支持用户输入
 *   - 提供确认和取消操作
 *   - 自动聚焦输入框
 *
 * 模块功能:
 *   - DialogPrompt: 提示对话框组件
 *
 * 使用场景:
 *   - 用户需要输入文本的确认操作
 *   - 需要简短文本输入的交互场景
 *
 * 边界:
 *   1. 仅支持单行文本输入
 *   2. 不支持复杂表单验证
 *   3. 依赖 DialogOverlay 等 UI 组件
 *
 * 流程:
 *   1. 显示对话框并自动聚焦输入框
 *   2. 用户输入或按 Escape 取消
 *   3. 按 Enter 确认输入
 *   4. 触发对应回调函数
 */
import { Show, createSignal, onMount } from "solid-js";
import { DialogButton, DialogFooter, DialogHeader, DialogOverlay } from "@/ui/components/dialogUi";
import { useTheme } from "@/ui/contexts/theme";
import type { KeyboardEventLike } from "@/ui/types";

export function DialogPrompt(props: {
  title: string;
  value?: string;
  placeholder?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const [value, setValue] = createSignal(props.value ?? "");
  let inputRef: any = null;

  onMount(() => {
    queueMicrotask(() => inputRef?.focus?.());
  });

  const submit = () => {
    props.onConfirm(value().trim());
  };

  return (
    <DialogOverlay onClose={props.onCancel} size="small">
      <DialogHeader title={props.title} />
      <box paddingLeft={1} paddingRight={1} flexDirection="column" gap={1}>
        <Show when={props.description}>
          <text fg={theme.colors.muted}>{props.description}</text>
        </Show>
        <box
          border={true}
          borderColor={theme.extended.borderExt.subtle}
          backgroundColor={theme.extended.bg.element}
          paddingLeft={1}
          paddingRight={1}
        >
          {(() => {
            const textareaProps: any = {
              focused: true,
              maxHeight: 3,
              minHeight: 1,
              onContentChange: (next: any) => {
                setValue(typeof next === "string" ? next : String(next ?? ""));
              },
              onKeyDown: (event: KeyboardEventLike) => {
                if (event.name === "escape") {
                  event.stopPropagation?.();
                  props.onCancel();
                  return;
                }
                if (event.name === "return" || event.name === "enter") {
                  if (event.shift || event.ctrl || event.alt || event.meta) {
                    return;
                  }
                  event.stopPropagation?.();
                  submit();
                }
              },
              placeholder: props.placeholder ?? "",
              ref: (ref: any) => {
                inputRef = ref;
              },
              value: value(),
            };
            return <textarea {...textareaProps} />;
          })()}
        </box>
      </box>
      <DialogFooter>
        <DialogButton label={props.cancelLabel ?? "取消"} fg={theme.colors.muted} onPress={props.onCancel} />
        <DialogButton label={props.confirmLabel ?? "确认"} fg={theme.colors.primary} onPress={submit} />
      </DialogFooter>
    </DialogOverlay>
  );
}
