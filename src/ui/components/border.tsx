/**
 * Border
 *
 * 职责:
 *   - 定义边框字符常量
 *   - 提供 Border 包装组件
 *
 * 模块功能:
 *   - 定义 EmptyBorder 和 SplitBorder 等边框样式常量
 *   - 提供 Border 组件用于包裹内容并显示边框
 *   - 支持自定义边框样式、颜色和标题
 *
 * 使用场景:
 *   - 需要为 UI 元素添加边框装饰
 *   - 创建分割面板或分组容器
 *   - 统一边框样式管理
 *
 * 边界:
 *   1. 仅提供视觉边框，不包含布局功能
 *   2. 依赖底层 UI 框架的 box 组件
 *
 * 流程:
 *   1. 导入边框常量或组件
 *   2. 应用到需要边框的容器
 */
import type { JSX } from "solid-js";

// ─── 边框字符常量 ────────────────────────────

export const EmptyBorder = {
  bottomLeft: "",
  bottomRight: "",
  bottomT: "",
  cross: "",
  horizontal: " ",
  leftT: "",
  rightT: "",
  topLeft: "",
  topRight: "",
  topT: "",
  vertical: "",
};

export const SplitBorder = {
  border: ["left" as const, "right" as const],
  customBorderChars: {
    ...EmptyBorder,
    vertical: "┃",
  },
};

// ─── Border 包装组件 ──────────────────────────────────────────

export interface BorderProps {
  title?: string;
  borderColor?: string;
  borderStyle?: "single" | "double" | "rounded";
  padding?: number;
  children?: JSX.Element;
}

export function Border(props: BorderProps) {
  return (
    <box
      border={true}
      borderStyle={props.borderStyle ?? "single"}
      borderColor={props.borderColor}
      title={props.title}
      padding={props.padding}
    >
      {props.children}
    </box>
  );
}
