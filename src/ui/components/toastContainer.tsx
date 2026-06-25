/**
 * ToastContainer
 *
 * 职责:
 *   - 在内容区右上角显示通知弹窗
 *   - 支持多 Toast 同时显示
 *   - 根据类型显示不同样式
 *
 * 模块功能:
 *   - 从 ToastContext 获取待显示的通知列表
 *   - 支持 info、success、warning、error 四种类型
 *   - 每种类型的 Toast 显示对应图标和颜色
 *   - 使用面板背景色和边框颜色区分
 *   - 自动计算最大宽度适配终端尺寸
 *
 * 使用场景:
 *   - 显示操作成功/失败的提示
 *   - 显示警告或错误信息
 *   - 显示一般性通知消息
 *
 * 边界:
 *   1. Toast 的显示时长和自动关闭由 ToastContext 管理
 *   2. 最大宽度限制为 60 字符或终端宽度减去边距
 *   3. 同时显示多个 Toast 时垂直堆叠
 *
 * 流程:
 *   1. 监听 ToastContext 中的 toasts 列表
 *   2. 遍历渲染每个 Toast 项
 *   3. 根据类型应用对应样式
 */
import { useToast } from "@/ui/contexts/toast";
import { For, Show } from "solid-js";
import { useTheme } from "@/ui/contexts/theme";
import { useTerminalDimensions } from "@opentui/solid";
import { SplitBorder } from "@/ui/components/border";
import { feedbackColor, getFeedbackMeta } from "@/ui/components/statusFeedback";

export function ToastContainer() {
  const { toasts } = useToast();
  const theme = useTheme();
  const c = theme.colors;
  const dims = useTerminalDimensions();

  return (
    <Show when={toasts().length > 0}>
      <box
        position="absolute"
        top={1}
        right={2}
        flexDirection="column"
        gap={1}
        zIndex={999}
        maxWidth={Math.min(60, dims().width - 6)}
      >
        <For each={toasts()}>
          {(toast) => {
            const meta = getFeedbackMeta(toast.type);
            const fg = feedbackColor(meta, c);

            return (
              <box
                paddingLeft={2}
                paddingRight={2}
                paddingTop={1}
                paddingBottom={1}
                backgroundColor={theme.extended.bg.panel}
                borderColor={fg}
                border={["left", "right"]}
                customBorderChars={SplitBorder.customBorderChars}
              >
                <Show when={toast.title}>
                  <text fg={c.text} marginBottom={1}>
                    <b>{toast.title}</b>
                  </text>
                </Show>
                <box flexDirection="row" gap={1}>
                  <text fg={fg}>
                    <b>{meta.icon}</b>
                  </text>
                  <text fg={c.text} wrapMode="word" width="100%">
                    {toast.message}
                  </text>
                </box>
              </box>
            );
          }}
        </For>
      </box>
    </Show>
  );
}
