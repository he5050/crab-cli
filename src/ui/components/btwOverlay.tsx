/**
 * BtwOverlay 组件
 *
 * 职责:
 *   - 显示 BTW(By The Way)流式旁路问答的实时响应
 *   - 提供流式内容的视觉反馈，包括加载、完成、错误状态
 *
 * 模块功能:
 *   - 订阅 BtwStreamChunk 事件接收流式数据
 *   - 显示流式响应内容，支持实时更新
 *   - 三种状态显示:● 流式中、✓ 完成、✗ 错误
 *   - 自动清理:错误 3 秒后消失，完成 5 秒后消失
 *
 * 使用场景:
 *   - 用户通过 /btw 命令发起旁路问答时
 *   - 需要显示流式响应而不打断当前对话时
 *   - 需要临时获取额外信息时
 *
 * 边界:
 *   1. 仅在有内容时显示(hasContent 判断)
 *   2. 流式完成后 5 秒自动清除
 *   3. 错误状态 3 秒后自动清除
 *   4. 使用左边框颜色区分状态
 *
 * 流程:
 *   1. 订阅 BtwStreamChunk 事件
 *   2. 接收 chunk 数据并追加到显示文本
 *   3. 根据 done/error 标志切换状态
 *   4. 定时自动清理已完成/错误的内容
 */
import { Show, createSignal, onCleanup } from "solid-js";
import { useEventBus } from "@/ui/contexts/eventBus";
import { AppEvent } from "@bus";
import { useTheme } from "@/ui/contexts/theme";
import { iconError, iconRunning, iconSuccess } from "@/ui/utils/icon";

export function BtwOverlay() {
  const eventBus = useEventBus();
  const theme = useTheme();
  const [text, setText] = createSignal("");
  const [active, setActive] = createSignal(false);
  const [done, setDone] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const unsub = eventBus.subscribe(AppEvent.BtwStreamChunk, (evt) => {
    const data = evt.properties;
    if (data.error) {
      setError(data.error);
      setDone(true);
      setActive(false);
      setTimeout(() => {
        setError(null);
        setDone(false);
      }, 3000);
      return;
    }

    if (!data.done) {
      setActive(true);
      setDone(false);
      setText((prev) => prev + data.chunk);
    } else {
      if (data.fullText) {
        setText(data.fullText);
      }
      setDone(true);
      setActive(false);
      setTimeout(() => {
        setText("");
        setDone(false);
      }, 5000);
    }
  });

  onCleanup(() => unsub());

  const displayText = () => text();
  const hasContent = () => displayText().length > 0 || error();

  const statusLabel = () => {
    if (error()) {
      return `${iconError} BTW Error`;
    }
    if (active()) {
      return `${iconRunning} BTW (streaming)`;
    }
    if (done()) {
      return `${iconSuccess} BTW`;
    }
    return "";
  };

  const statusColor = () => {
    if (error()) {
      return theme.colors.error;
    }
    if (active()) {
      return theme.colors.info;
    }
    return theme.colors.success;
  };

  return (
    <Show when={hasContent()}>
      <box border={["left"]} borderColor={statusColor()} marginTop={1} paddingLeft={1} flexShrink={0}>
        <text fg={statusColor()}>
          <b>{statusLabel()}</b>
        </text>
        <text fg={error() ? theme.colors.error : theme.colors.text}>{error() || displayText()}</text>
      </box>
    </Show>
  );
}
