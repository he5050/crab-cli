/**
 * UserMessagePreview
 *
 * 职责:
 *   - 显示用户消息预览
 *   - 支持图片附件显示
 *   - 提供编辑和发送操作
 *
 * 模块功能:
 *   - 显示消息内容预览
 *   - 显示图片附件列表(名称、大小)
 *   - 支持移除图片附件
 *   - 提供编辑、发送、取消操作按钮
 *   - 格式化显示文件大小(B/KB/MB)
 *   - 提供简洁版组件用于紧凑布局
 *   - UserInput 组件支持键盘输入和发送
 *
 * 使用场景:
 *   - 发送消息前预览内容和附件
 *   - 确认消息内容后再发送
 *   - 紧凑布局显示消息摘要
 *   - 键盘驱动的消息输入
 *
 * 边界:
 *   1. 仅显示预览，不处理实际发送逻辑
 *   2. 内容超过 30 字符时截断显示(简洁版)
 *   3. 空消息显示占位提示
 *
 * 流程:
 *   1. 接收消息内容和附件
 *   2. 渲染消息预览界面
 *   3. 处理编辑/发送/取消操作
 *   4. UserInput 处理键盘输入并触发发送
 */
import { For, Show, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "@/ui/contexts/theme";
import { formatBytes } from "@/core/utilities/textUtils";
import { actionClose, actionImage, iconUser } from "@/ui/utils/icon";

export interface ImageAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  previewUrl?: string;
}

export interface UserMessagePreviewProps {
  content: string;
  images?: ImageAttachment[];
  editable?: boolean;
  onEdit?: () => void;
  onSend?: () => void;
  onCancel?: () => void;
  onRemoveImage?: (id: string) => void;
}

export function UserMessagePreview(props: UserMessagePreviewProps) {
  const theme = useTheme();
  const c = theme.colors;

  return (
    <box flexDirection="column" border={["left"]} borderColor={c.accent} paddingLeft={2} paddingRight={2} gap={1}>
      {/* 标题 */}
      <box flexDirection="row" justifyContent="space-between">
        <text fg={c.text}>
          <b>
            {iconUser}
            {" 消息预览"}
          </b>
        </text>
        <box flexDirection="row" gap={2}>
          <Show when={props.editable && props.onEdit}>
            <text fg={c.primary} {...({ onClick: props.onEdit } as any)}>
              {"[编辑]"}
            </text>
          </Show>
          <Show when={props.onSend}>
            <text fg={c.success} {...({ onClick: props.onSend } as any)}>
              {"[发送 ↵]"}
            </text>
          </Show>
          <Show when={props.onCancel}>
            <text fg={c.muted} {...({ onClick: props.onCancel } as any)}>
              {"[取消]"}
            </text>
          </Show>
        </box>
      </box>

      {/* 内容 */}
      <text fg={c.text} wrapMode="word">
        {props.content || <span style={{ fg: c.muted }}>{"(空消息)"}</span>}
      </text>

      {/* 图片 */}
      <Show when={(props.images?.length ?? 0) > 0}>
        <box flexDirection="column" gap={0}>
          <For each={props.images}>
            {(img) => (
              <box flexDirection="row" gap={1}>
                <text fg={c.accent}>{actionImage}</text>
                <text fg={c.text}>{img.name}</text>
                <text fg={c.muted}>{`(${formatBytes(img.size)})`}</text>
                <Show when={props.onRemoveImage}>
                  <text fg={c.error} {...({ onClick: () => props.onRemoveImage?.(img.id) } as any)}>
                    {actionClose}
                  </text>
                </Show>
              </box>
            )}
          </For>
        </box>
      </Show>

      {/* 提示 */}
      <text fg={c.muted}>
        {props.content.length > 0 ? "Enter 发送 · Shift+Enter 换行 · Esc 取消" : "输入消息内容..."}
      </text>
    </box>
  );
}

export function UserMessagePreviewCompact(props: Pick<UserMessagePreviewProps, "content" | "images">) {
  const theme = useTheme();
  const c = theme.colors;

  return (
    <box flexDirection="row" gap={1}>
      <text fg={c.accent}>{iconUser}</text>
      <text fg={c.text}>{props.content.slice(0, 30) + (props.content.length > 30 ? "..." : "")}</text>
      <Show when={(props.images?.length ?? 0) > 0}>
        <text fg={c.accent}>
          {actionImage} {props.images?.length ?? 0}
        </text>
      </Show>
    </box>
  );
}

// ─── UserInput — 用户输入组件(useKeyboard 驱动)──────────

export interface UserInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onCancel?: () => void;
  placeholder?: string;
  multiline?: boolean;
  disabled?: boolean;
}

export function UserInput(props: UserInputProps) {
  const theme = useTheme();
  const c = theme.colors;
  const [localValue, setLocalValue] = createSignal(props.value);

  useKeyboard((event) => {
    if (props.disabled) {
      return;
    }
    if (event.name === "escape") {
      props.onCancel?.();
      return;
    }
    if (event.name === "return" || event.name === "enter") {
      if (!event.shift && localValue().trim()) {
        props.onSend();
        return;
      }
      // Shift+Enter 换行
      setLocalValue((v) => `${v}\n`);
      props.onChange(localValue());
      return;
    }
    if (event.name === "backspace") {
      setLocalValue((v) => v.slice(0, -1));
      props.onChange(localValue());
      return;
    }
    if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
      setLocalValue((v) => v + event.name);
      props.onChange(localValue());
    }
  });

  return (
    <box flexDirection="column" border={["top"]} borderColor={c.border} paddingLeft={2} paddingRight={2} gap={0}>
      <box flexDirection="row" gap={1}>
        <text fg={c.accent}>{iconUser}</text>
        <text fg={localValue() ? c.text : c.muted}>
          {localValue() || props.placeholder || "输入消息..."}
          <Show when={localValue()}>
            <span style={{ fg: c.accent }}>{"_"}</span>
          </Show>
        </text>
      </box>
      <text fg={c.muted}>{props.multiline ? "Shift+Enter 换行 · Enter 发送" : "Enter 发送 · Esc 取消"}</text>
    </box>
  );
}
