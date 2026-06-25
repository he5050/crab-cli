/**
 * Session Prompt 输入区 — 收纳 PromptInput + Slot 注入点
 *
 * 职责:
 *   - 渲染 PromptInput 主输入框
 *   - 通过 Slot 暴露 session_prompt / session_prompt_right 注入点
 *   - 接受 promptBlocked 控制显示/隐藏
 *
 * 边界:
 *   1. 纯展示:所有状态与回调由父组件提供
 *   2. 不管理输入状态
 *   3. Slot 注入由插件系统消费
 */
import { type JSX } from "solid-js";
import { Slot } from "@/ui/plugins/slots";
import { PromptInput } from "@/ui/pages/session/components/promptInput";
import type { ThemeColors } from "@/ui/contexts/theme";
import type { PromptTrigger } from "@/ui/pages/session/components/promptParts";
import type { Extmark } from "@/ui/pages/session/components/promptExtmarks";
import type { KeyboardEventLike } from "@/ui/types";

interface PromptInputRef {
  focus?: () => void;
  cursorOffset?: number;
}

export interface SessionPromptAreaProps {
  visible: () => boolean;
  inputRef: (ref: PromptInputRef | null) => void;
  value: () => string;
  onInput: (val: string) => void;
  onTrigger: (trigger: PromptTrigger, value: string) => void;
  onKeyDown: (event: KeyboardEventLike) => boolean | void;
  onSubmit: (val: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  loading: boolean;
  placeholder: string;
  disabled: () => boolean;
  meta?: string;
  rightHint?: string;
  rightSlot?: JSX.Element;
  colors: ThemeColors;
  promptBlocked: () => boolean;
  /** Extmark 列表 */
  extmarks?: Extmark[];
  /** 移除 extmark 回调 */
  onRemoveExtmark?: (id: string) => void;
}

export function SessionPromptArea(props: SessionPromptAreaProps) {
  return (
    <box visible={props.visible()}>
      <Slot name="session_prompt">
        <PromptInput
          ref={props.inputRef}
          value={props.value()}
          onInput={props.onInput}
          onTrigger={props.onTrigger}
          onKeyDown={props.onKeyDown}
          onSubmit={props.onSubmit}
          onFocus={props.onFocus}
          onBlur={props.onBlur}
          loading={props.loading}
          placeholder={props.placeholder}
          colors={props.colors}
          disabled={props.disabled()}
          meta={props.meta}
          rightHint={props.rightHint}
          right={
            props.rightSlot ?? (
              <Slot name="session_prompt_right">
                <text fg={props.colors.muted}>{props.rightHint}</text>
              </Slot>
            )
          }
          extmarks={props.extmarks}
          onRemoveExtmark={props.onRemoveExtmark}
        />
      </Slot>
    </box>
  );
}
