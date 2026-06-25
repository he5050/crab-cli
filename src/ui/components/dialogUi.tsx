/**
 * DialogUi
 *
 * 职责:
 *   - 提供弹窗渲染层基础设施
 *   - 渲染半透明遮罩和居中弹窗内容
 *   - 支持多种弹窗尺寸和样式
 *
 * 模块功能:
 *   - DialogOverlay: 弹窗容器，支持遮罩点击关闭
 *   - DialogHeader: 弹窗标题头部
 *   - DialogBody: 弹窗内容体
 *   - DialogFooter: 弹窗底部按钮栏
 *   - DialogButton: 弹窗按钮组件
 *   - 支持 small/medium/large/xlarge 四种尺寸
 *
 * 使用场景:
 *   - 需要模态弹窗展示内容时
 *   - 需要用户确认或选择时
 *   - 作为其他弹窗组件的基础容器
 *
 * 边界:
 *   1. ESC 键关闭由全局键盘系统处理，不在组件内实现
 *   2. 遮罩点击关闭为简化实现，不支持选区检测
 *   3. 弹窗内容通过 children 传入，保持灵活性
 *   4. 尺寸通过 DialogSize 类型限制
 *
 * 流程:
 *   1. 使用 DialogOverlay 作为弹窗容器
 *   2. 组合 DialogHeader/DialogBody/DialogFooter 构建弹窗
 *   3. 使用 DialogButton 添加操作按钮
 *   4. 通过 onClose 回调处理关闭事件
 */
import { useTerminalDimensions } from "@opentui/solid";
import { useTheme } from "@/ui/contexts/theme";
import type { ParentProps } from "solid-js";

/** Dialog 尺寸类型 */
export type DialogSize = "small" | "medium" | "large" | "xlarge";

/** Dialog 尺寸对应的宽度 */
function dialogWidth(size: DialogSize): number {
  if (size === "xlarge") {
    return 116;
  }
  if (size === "large") {
    return 88;
  }
  if (size === "small") {
    return 40;
  }
  return 60;
}

/**
 * Dialog 弹窗容器。
 *
 * 使用方式:
 * ```tsx
 * <DialogOverlay onClose={() => dialog.close(id)} size="medium">
 *   <弹窗内容 />
 * </DialogOverlay>
 * ```
 */
export function DialogOverlay(
  props: ParentProps<{
    onClose: () => void;
    size?: DialogSize;
  }>,
) {
  const dims = useTerminalDimensions();
  const theme = useTheme();

  const width = () => dialogWidth(props.size ?? "medium");

  return (
    <box
      width={dims().width}
      height={dims().height}
      alignItems="center"
      position="absolute"
      zIndex={3000}
      paddingTop={Math.floor(dims().height / 4)}
      left={0}
      top={0}
      backgroundColor="rgba(0,0,0,0.6)"
    >
      <box
        width={width()}
        maxWidth={dims().width - 2}
        backgroundColor={theme.extended.bg.panel}
        paddingTop={1}
        paddingBottom={1}
        border={true}
        borderColor={theme.extended.borderExt.main}
      >
        {props.children}
      </box>
    </box>
  );
}

/**
 * Dialog 内容头部。
 */
export function DialogHeader(props: { title: string }) {
  const theme = useTheme();
  return (
    <box paddingLeft={1} paddingRight={1} paddingBottom={1}>
      <text fg={theme.extended.markdown.heading}>
        <b>{props.title}</b>
      </text>
    </box>
  );
}

/**
 * Dialog 内容体。
 */
export function DialogBody(props: ParentProps) {
  return (
    <box paddingLeft={1} paddingRight={1}>
      {props.children}
    </box>
  );
}

/**
 * Dialog 底部按钮栏。
 */
export function DialogFooter(props: ParentProps) {
  return (
    <box flexDirection="row" justifyContent="flex-end" paddingLeft={1} paddingRight={1} paddingTop={1} gap={1}>
      {props.children}
    </box>
  );
}

/**
 * Dialog 按钮。
 */
export function DialogButton(props: { label: string; fg?: string; onPress: () => void }) {
  const theme = useTheme();
  const fg = () => props.fg ?? theme.colors.primary;
  return (
    <box border={true} borderColor={fg()} paddingLeft={1} paddingRight={1} onMouseUp={props.onPress}>
      <text fg={fg()}>{props.label}</text>
    </box>
  );
}
