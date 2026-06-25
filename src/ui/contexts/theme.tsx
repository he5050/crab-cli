/**
 * Theme Context
 *
 * 职责:
 *   - 管理应用主题状态
 *   - 提供主题颜色配置(基础色 + 扩展色)
 *   - 支持主题切换和持久化
 *   - 发布主题变更事件
 *
 * 模块功能:
 *   - 按名称设置主题
 *   - 循环切换所有可用主题
 *   - 切换 dark/light 模式
 *   - 提供 hex 和 RGBA 双格式颜色
 *   - 派生扩展颜色(diff/markdown/syntax)
 *   - 主题持久化到配置文件
 *
 * 使用场景:
 *   - 用户切换主题
 *   - 组件根据主题渲染样式
 *   - 代码高亮颜色配置
 *   - Diff 视图颜色配置
 *
 * 边界:
 *   1. 主题定义来自 themeConfig 模块
 *   2. 持久化依赖 saveConfig 函数
 *   3. 扩展颜色由基础色派生计算
 *
 * 流程:
 *   1. 初始化时加载默认或指定主题
 *   2. 调用 setTheme() 切换主题
 *   3. 保存到配置文件
 *   4. 发布 ThemeChanged 事件
 *   5. 组件响应主题变化更新样式
 */
import { createMemo, createSignal } from "solid-js";
import { createSimpleContext } from "@/ui/contexts/helper";
import {
  getDefaultTheme,
  getThemeDefinition,
  isThemeValid,
  listThemes,
  resolveThemeColors,
  resolveThemeExtendedOverrides,
} from "@config";
import { useEventBus } from "@/ui/contexts/eventBus";
import { AppEvent } from "@bus";
import { saveConfig } from "@config";
import { RGBA } from "@opentui/core";
import { registerThemeHotReload } from "@/ui/themes/themeHotReload";
import type {
  BackgroundColors,
  BorderColors,
  DiffColors,
  ExtendedThemeColors,
  MarkdownColors,
  SyntaxColors,
  ThemeColors,
  ThemeExtendedOverrides,
  ThemeMode,
} from "@config";

// ─── 类型定义 ─────────────────────────────────────────────────

export type {
  BackgroundColors,
  BorderColors,
  DiffColors,
  ExtendedThemeColors,
  MarkdownColors,
  SyntaxColors,
  ThemeColors,
  ThemeExtendedOverrides,
  ThemeMode,
};

/** RGBA 格式的主题 */
export interface RgbaTheme {
  primary: RGBA;
  secondary: RGBA;
  accent: RGBA;
  error: RGBA;
  warning: RGBA;
  success: RGBA;
  info: RGBA;
  text: RGBA;
  textMuted: RGBA;
  background: RGBA;
  backgroundPanel: RGBA;
  backgroundElement: RGBA;
  backgroundMenu: RGBA;
  border: RGBA;
  borderSubtle: RGBA;
  borderActive: RGBA;
  selectedListItemText: RGBA;
  thinkingOpacity: number;
  diff: {
    added: RGBA;
    removed: RGBA;
    context: RGBA;
    hunkHeader: RGBA;
    highlightAdded: RGBA;
    highlightRemoved: RGBA;
    addedBg: RGBA;
    removedBg: RGBA;
    contextBg: RGBA;
    lineNumber: RGBA;
    addedLineNumberBg: RGBA;
    removedLineNumberBg: RGBA;
  };
  markdown: {
    text: RGBA;
    heading: RGBA;
    link: RGBA;
    linkText: RGBA;
    code: RGBA;
    blockQuote: RGBA;
    emph: RGBA;
    strong: RGBA;
    horizontalRule: RGBA;
    listItem: RGBA;
    listEnumeration: RGBA;
    image: RGBA;
    imageText: RGBA;
    codeBlock: RGBA;
  };
  syntax: {
    comment: RGBA;
    keyword: RGBA;
    func: RGBA;
    variable: RGBA;
    string: RGBA;
    number: RGBA;
    type: RGBA;
    operator: RGBA;
    punctuation: RGBA;
  };
}

// ─── 颜色工具函数 ─────────────────────────────────────────────

/** Hex 字符串转 RGBA 对象 */
export function hexToRgba(hex: string): RGBA {
  return RGBA.fromHex(hex);
}

/** 解析 hex 为 [r, g, b] */
function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16)];
}

/** 颜色混合(tint) — base 和 overlay 按比例混合 */
export function tint(base: string, overlay: string, alpha: number): string {
  const b = parseHex(base);
  const o = parseHex(overlay);
  const r = Math.round(b[0] + (o[0] - b[0]) * alpha);
  const g = Math.round(b[1] + (o[1] - b[1]) * alpha);
  const bl = Math.round(b[2] + (o[2] - b[2]) * alpha);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bl.toString(16).padStart(2, "0")}`;
}

/** 加深/提亮颜色 */
function adjustBrightness(hex: string, factor: number): string {
  const [r, g, b] = parseHex(hex);
  const nr = Math.min(255, Math.max(0, Math.round(r * factor)));
  const ng = Math.min(255, Math.max(0, Math.round(g * factor)));
  const nb = Math.min(255, Math.max(0, Math.round(b * factor)));
  return `#${nr.toString(16).padStart(2, "0")}${ng.toString(16).padStart(2, "0")}${nb.toString(16).padStart(2, "0")}`;
}

// ─── 扩展颜色派生 ─────────────────────────────────────────────

/** 从基础颜色派生完整扩展颜色，并允许主题提供精确 token 覆盖 */
export function deriveExtendedColors(
  base: ThemeColors,
  mode: ThemeMode,
  overrides: ThemeExtendedOverrides = {},
): ExtendedThemeColors {
  const isDark = mode === "dark";
  const diffAlpha = isDark ? 0.22 : 0.14;

  const derived: ExtendedThemeColors = {
    ...base,
    backgroundMenu: adjustBrightness(base.background, isDark ? 1.4 : 0.94),
    bg: {
      element: adjustBrightness(base.background, isDark ? 1.4 : 0.94),
      main: base.background,
      panel: adjustBrightness(base.background, isDark ? 1.2 : 0.97),
    },
    borderExt: {
      active: adjustBrightness(base.border, isDark ? 1.5 : 0.8),
      main: base.border,
      subtle: adjustBrightness(base.border, isDark ? 0.7 : 1.2),
    },
    diff: {
      added: base.success,
      addedBg: tint(base.background, base.success, diffAlpha),
      addedLineNumberBg: tint(adjustBrightness(base.background, 1.1), base.success, diffAlpha),
      context: base.muted,
      contextBg: adjustBrightness(base.background, isDark ? 1.1 : 0.98),
      highlightAdded: adjustBrightness(base.success, isDark ? 1.3 : 0.85),
      highlightRemoved: adjustBrightness(base.error, isDark ? 1.3 : 0.85),
      hunkHeader: base.muted,
      lineNumber: base.muted,
      removed: base.error,
      removedBg: tint(base.background, base.error, diffAlpha),
      removedLineNumberBg: tint(adjustBrightness(base.background, 1.1), base.error, diffAlpha),
    },
    markdown: {
      blockQuote: base.warning,
      code: base.success,
      codeBlock: base.text,
      emph: base.warning,
      heading: base.accent,
      horizontalRule: base.muted,
      image: base.primary,
      imageText: base.info,
      link: base.primary,
      linkText: base.info,
      listEnumeration: base.info,
      listItem: base.primary,
      strong: base.accent,
      text: base.text,
    },
    selectedListItemText: base.background,
    syntax: {
      comment: base.muted,
      func: base.primary,
      keyword: base.secondary,
      number: base.warning,
      operator: base.accent,
      punctuation: base.text,
      string: base.success,
      type: base.info,
      variable: base.text,
    },
    textMuted: base.muted,
    thinkingOpacity: 0.6,
  };

  const bg = { ...derived.bg, ...overrides.bg };
  const borderExt = { ...derived.borderExt, ...overrides.borderExt };

  return {
    ...derived,
    backgroundMenu: overrides.backgroundMenu ?? bg.element,
    bg,
    borderExt,
    diff: { ...derived.diff, ...overrides.diff },
    markdown: { ...derived.markdown, ...overrides.markdown },
    selectedListItemText: overrides.selectedListItemText ?? derived.selectedListItemText,
    syntax: { ...derived.syntax, ...overrides.syntax },
    textMuted: overrides.textMuted ?? derived.textMuted,
    thinkingOpacity: overrides.thinkingOpacity ?? derived.thinkingOpacity,
  };
}

/** 将 hex ThemeColors 转换为 RGBA 格式 */
export function toRgbaTheme(extended: ExtendedThemeColors): RgbaTheme {
  return {
    accent: hexToRgba(extended.accent),
    background: hexToRgba(extended.background),
    backgroundElement: hexToRgba(extended.bg.element),
    backgroundMenu: hexToRgba(extended.backgroundMenu),
    backgroundPanel: hexToRgba(extended.bg.panel),
    border: hexToRgba(extended.border),
    borderActive: hexToRgba(extended.borderExt.active),
    borderSubtle: hexToRgba(extended.borderExt.subtle),
    diff: {
      added: hexToRgba(extended.diff.added),
      addedBg: hexToRgba(extended.diff.addedBg),
      addedLineNumberBg: hexToRgba(extended.diff.addedLineNumberBg),
      context: hexToRgba(extended.diff.context),
      contextBg: hexToRgba(extended.diff.contextBg),
      highlightAdded: hexToRgba(extended.diff.highlightAdded),
      highlightRemoved: hexToRgba(extended.diff.highlightRemoved),
      hunkHeader: hexToRgba(extended.diff.hunkHeader),
      lineNumber: hexToRgba(extended.diff.lineNumber),
      removed: hexToRgba(extended.diff.removed),
      removedBg: hexToRgba(extended.diff.removedBg),
      removedLineNumberBg: hexToRgba(extended.diff.removedLineNumberBg),
    },
    error: hexToRgba(extended.error),
    info: hexToRgba(extended.info),
    markdown: {
      blockQuote: hexToRgba(extended.markdown.blockQuote),
      code: hexToRgba(extended.markdown.code),
      codeBlock: hexToRgba(extended.markdown.codeBlock),
      emph: hexToRgba(extended.markdown.emph),
      heading: hexToRgba(extended.markdown.heading),
      horizontalRule: hexToRgba(extended.markdown.horizontalRule),
      image: hexToRgba(extended.markdown.image),
      imageText: hexToRgba(extended.markdown.imageText),
      link: hexToRgba(extended.markdown.link),
      linkText: hexToRgba(extended.markdown.linkText),
      listEnumeration: hexToRgba(extended.markdown.listEnumeration),
      listItem: hexToRgba(extended.markdown.listItem),
      strong: hexToRgba(extended.markdown.strong),
      text: hexToRgba(extended.markdown.text),
    },
    primary: hexToRgba(extended.primary),
    secondary: hexToRgba(extended.secondary),
    selectedListItemText: hexToRgba(extended.selectedListItemText),
    success: hexToRgba(extended.success),
    syntax: {
      comment: hexToRgba(extended.syntax.comment),
      func: hexToRgba(extended.syntax.func),
      keyword: hexToRgba(extended.syntax.keyword),
      number: hexToRgba(extended.syntax.number),
      operator: hexToRgba(extended.syntax.operator),
      punctuation: hexToRgba(extended.syntax.punctuation),
      string: hexToRgba(extended.syntax.string),
      type: hexToRgba(extended.syntax.type),
      variable: hexToRgba(extended.syntax.variable),
    },
    text: hexToRgba(extended.text),
    textMuted: hexToRgba(extended.textMuted),
    thinkingOpacity: extended.thinkingOpacity,
    warning: hexToRgba(extended.warning),
  };
}

/** 计算选中项前景色(深色背景用白字，浅色背景用黑字) */
export function selectedForeground(bgHex: string): string {
  const [r, g, b] = parseHex(bgHex);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 128 ? "#000000" : "#ffffff";
}

// ─── Context 定义 ─────────────────────────────────────────────

/** 主题 Context 值 */
export interface ThemeContextValue {
  /** 当前主题模式 */
  mode: ThemeMode;
  /** 当前主题名称 */
  themeName: string;
  /** 基础颜色(向后兼容) */
  colors: ThemeColors;
  /** 扩展颜色(diff/markdown/syntax/bg/border) */
  extended: ExtendedThemeColors;
  /** RGBA 格式主题 */
  theme: RgbaTheme;
  /** 设置主题(按名称) */
  setTheme: (name: string) => void;
  /** 循环切换下一个主题 */
  cycleTheme: () => void;
  /** 切换 dark/light */
  toggle: () => void;
  /** 设置主题模式 */
  setMode: (mode: ThemeMode) => void;
  /** 列出所有可用主题 */
  allThemes: () => import("../../config/themes/themeConfig").ThemeDefinition[];
  /** 选中项前景色 */
  selectedForeground: (bgHex?: string) => string;
  /** 模式锁定状态(锁定后不随系统切换) */
  lockMode: () => boolean;
  /** 设置模式锁定 */
  setLockMode: (locked: boolean) => void;
  /** 订阅主题变更，返回取消订阅函数 */
  subscribeThemes: (handler: (payload: { mode: ThemeMode; themeName: string }) => void) => () => void;
}

/** 所有可用主题列表 */
const ALL_THEMES = listThemes();

export const { use: useTheme, provider: ThemeProvider } = createSimpleContext<ThemeContextValue>({
  init: (props) => {
    const eventBus = useEventBus();
    const initialThemeName = (props?.initialTheme as string) ?? getDefaultTheme();
    const [activeTheme, setActiveTheme] = createSignal<string>(
      isThemeValid(initialThemeName) ? initialThemeName : getDefaultTheme(),
    );
    const initialDef = getThemeDefinition(activeTheme());
    const requestedInitialMode = props?.initialMode as ThemeMode | undefined;
    const initialMode =
      requestedInitialMode === initialDef.mode || (requestedInitialMode === "light" && initialDef.lightColors)
        ? requestedInitialMode
        : initialDef.mode;
    const [activeMode, setActiveMode] = createSignal<ThemeMode>(initialMode);
    const [lockMode, setLockModeSignal] = createSignal<boolean>(false);

    // 注册 SIGUSR2 信号热重载主题
    registerThemeHotReload();

    // 监听 ThemeChanged 事件(包括 SIGUSR2 热重载触发)，重新加载主题定义
    // 如果 lockMode 为 true，则不响应系统/外部触发的模式切换
    eventBus.subscribe(AppEvent.ThemeChanged, (payload) => {
      // 重新获取当前主题定义(可能已从 ~/.crab/themes/ 更新)
      const currentName = activeTheme();
      const def = getThemeDefinition(currentName);
      // 触发响应式更新
      setActiveTheme(currentName);
      // lockMode 为 true 时保持当前模式不变
      if (!lockMode() && payload?.mode) {
        setActiveMode(payload.mode);
      } else {
        setActiveMode(def.mode);
      }
    });

    const currentDefinition = () => getThemeDefinition(activeTheme());
    const themeName = (): string => activeTheme();

    /** 基础颜色 */
    const colors = (): ThemeColors => {
      const def = currentDefinition();
      return resolveThemeColors(def, activeMode());
    };

    const mode = (): ThemeMode => activeMode();

    /** 扩展颜色 */
    const extended = createMemo<ExtendedThemeColors>(() =>
      deriveExtendedColors(colors(), mode(), resolveThemeExtendedOverrides(currentDefinition(), mode())),
    );

    /** RGBA 格式主题 */
    const theme = createMemo<RgbaTheme>(() => toRgbaTheme(extended()));

    /** 选中项前景色:默认使用 background/selected token。 */
    const selectedForegroundColor = createMemo<string>(() => extended().selectedListItemText);

    /** 设置主题并持久化 */
    const setTheme = (name: string) => {
      if (!isThemeValid(name)) {
        return;
      }
      const def = getThemeDefinition(name);
      setActiveTheme(name);
      setActiveMode(def.mode);
      saveConfig({ theme: name }).catch(() => {});
      eventBus.publish(AppEvent.ThemeChanged, { mode: def.mode });
    };

    /** 循环切换下一个主题 */
    const cycleTheme = () => {
      const idx = ALL_THEMES.findIndex((t) => t.name === activeTheme());
      const next = ALL_THEMES[(idx + 1) % ALL_THEMES.length]!;
      setTheme(next.name);
    };

    const toggle = () => {
      cycleTheme();
    };

    const setMode = (m: ThemeMode) => {
      const currentMode = mode();
      if (m === currentMode) {
        return;
      }
      const def = currentDefinition();
      if (m === def.mode || (m === "light" && def.lightColors)) {
        setActiveMode(m);
        eventBus.publish(AppEvent.ThemeChanged, { mode: m });
        return;
      }
      const target = ALL_THEMES.find((t) => t.mode === m);
      if (target) {
        setTheme(target.name);
      }
    };

    /** 设置模式锁定(锁定后不随系统切换) */
    const setLockMode = (locked: boolean) => {
      setLockModeSignal(locked);
    };

    /** 订阅主题变更，返回取消订阅函数 */
    const subscribeThemes = (handler: (payload: { mode: ThemeMode; themeName: string }) => void): (() => void) => {
      return eventBus.subscribe(AppEvent.ThemeChanged, () => {
        handler({ mode: activeMode(), themeName: activeTheme() });
      });
    };

    return {
      allThemes: () => ALL_THEMES,
      get colors() {
        return colors();
      },
      cycleTheme,
      get extended() {
        return extended();
      },
      lockMode,
      get mode() {
        return mode();
      },
      get selectedForeground() {
        return (_bgHex?: string) => selectedForegroundColor();
      },
      setLockMode,
      setMode,
      setTheme,
      subscribeThemes,
      get theme() {
        return theme();
      },
      get themeName() {
        return themeName();
      },
      toggle,
    };
  },
  name: "Theme",
});
