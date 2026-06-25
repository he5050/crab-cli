/**
 * Session 页面 UI 表面令牌(设计 Token 集中模块)。
 *
 * 职责:
 *   - 集中所有 Session 页用到的硬编码 hex 色值
 *   - 提供具名常量供子组件 import(替代字面量散落)
 *   - 定义响应式断点常量，统一各组件间的布局策略
 *   - 与 `@ui/contexts/theme` 的动态主题(`useTheme().colors`)解耦:
 *     这些是"静态表面色"，跟随暗色基底而非用户主题切换
 *
 * 命名约定:
 *   - SURFACE_*:box/backgroundColor 用的填充色
 *   - BORDER_*:borderColor 用的描边色
 *   - SCROLLBAR_*:滚动条 track/foreground
 *   - TEXT_*:文字色(fg)
 *   - CURSOR_*:输入框光标
 *   - BP_*:响应式断点宽度阈值(字符列数)
 *
 * 断点说明(P2-9):
 *   NARROW <= BP_NARROW < MEDIUM <= BP_MEDIUM < WIDE <= BP_WIDE < XLARGE
 *     - NARROW:折叠侧边栏，紧凑消息密度，简化底部栏
 *     - MEDIUM:侧边栏为覆盖层(overlay)，常规消息
 *     - WIDE:  侧边栏内联排列(inline)，常规消息
 *     - XLARGE:同 WIDE，可选更高密度信息
 *
 * 使用场景:
 *   - session/index.tsx 主壳
 *   - session/footer.tsx / subagentFooter.tsx 状态栏
 *   - session/components/{messages,sidebar,promptInput}.tsx
 *
 * 边界:
 *   1. 不承载主题色(primary/warning/error 等仍在 theme.colors)
 *   2. 调色板类常量(One Dark)保留在 messageParts.tsx 内独立 palette
 *   3. 本模块无副作用，纯常量导出
 */

/** 终端宽度 ≤ 80 列时视为 NARROW:折叠侧边栏、紧凑消息 */
export const BP_NARROW = 80;
/** 终端宽度 ≤ 100 列时视为 MEDIUM:侧边栏 overlay */
export const BP_MEDIUM = 100;
/** 终端宽度 ≤ 120 列时视为 WIDE:侧边栏 inline */
export const BP_WIDE = 120;

/** 侧边栏标准宽度(列) */
export const SIDEBAR_WIDTH = 42;

/** 侧边栏收起状态宽度(列) */
export const SIDEBAR_COLLAPSED_WIDTH = 2;

export type Breakpoint = "narrow" | "medium" | "wide" | "xlarge";

export function classifyBreakpoint(width: number): Breakpoint {
  if (width <= BP_NARROW) {
    return "narrow";
  }
  if (width <= BP_MEDIUM) {
    return "medium";
  }
  if (width <= BP_WIDE) {
    return "wide";
  }
  return "xlarge";
}

export const SURFACE_ROOT = "#050505";
export const SURFACE_PANEL = "#111111";
export const SURFACE_PANEL_ALT = "#141414";
export const SURFACE_INPUT = "#1a1a1a";
export const SURFACE_HOVER = "#1a1a1a";

export const BORDER_SUBTLE = "#2f2f2f";

export const SCROLLBAR_TRACK = "#1f2937";
export const SCROLLBAR_FOREGROUND = "#6b7280";

export const TEXT_PRIMARY = "#f5f5f5";
export const TEXT_MUTED = "#9ca3af";
export const TEXT_BOLD = "#ffffff";

export const CURSOR_ACTIVE = "#86B7FF";
