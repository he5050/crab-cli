import type { ThemeColors, ThemeDefinition, ThemeExtendedOverrides } from "../types/themeTypes";
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "fs";
import { toAppError } from "@/core/errors/appError";
import { createLogger } from "@/core/logging/logger";
import { getGlobalCrabDir } from "../paths/paths";

export type { ThemeDefinition };

import {
  ONE_DARK,
  DRACULA,
  CATPPUCCIN,
  CATPPUCCIN_FRAPPE,
  CATPPUCCIN_MACCHIATO,
  GRUVBOX,
  TOKYONIGHT,
  NORD,
  MONOKAI,
  MATERIAL,
  AYU,
  EVERFOREST,
  KANAGAWA,
  NIGHTOWL,
  SYNTHWAVE84,
  COBALT2,
  PALENIGHT,
  ROSEPINE,
  VESPER,
  ZENBURN,
  CARBONFOX,
  MATRIX,
  VERCEL,
  ORNG,
  AURA,
  OSAKA_JADE,
  MERCURY,
  CURSOR_THEME,
  LUCENT_ORNG,
  FLEXOKI,
  OPENCODE,
} from "./themesDark";
import { ONE_LIGHT, GITHUB_LIGHT, SOLARIZED_LIGHT } from "./themesLight";

/** 自定义主题 JSON 文件格式 */
interface CustomThemeJson {
  name: string;
  label?: string;
  mode?: "dark" | "light";
  palette?: string[];
  colors: ThemeColors;
  lightColors?: ThemeColors;
  extendedColors?: ThemeExtendedOverrides;
  lightExtendedColors?: ThemeExtendedOverrides;
}

const CUSTOM_THEMES_DIR = join(getGlobalCrabDir(), "themes");
const log = createLogger("config:theme");

function logThemeDebugFailure(message: string, error: unknown, context: Record<string, unknown> = {}): void {
  const appError = toAppError(error);
  log.debug(message, {
    ...context,
    error: appError.message,
    errorCode: appError.code,
  });
}

/** 从 ~/.crab/themes/*.json 加载自定义主题 */
function loadCustomThemes(): Record<string, ThemeDefinition> {
  if (!existsSync(CUSTOM_THEMES_DIR)) {
    return {};
  }
  try {
    const result: Record<string, ThemeDefinition> = {};
    const files = readdirSync(CUSTOM_THEMES_DIR).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const content = readFileSync(join(CUSTOM_THEMES_DIR, file), "utf8");
        const json = JSON.parse(content) as CustomThemeJson;
        if (!json.name || !json.colors) {
          continue;
        }
        const { name } = json;
        result[name] = {
          colors: json.colors,
          extendedColors: json.extendedColors,
          label: json.label ?? name,
          lightColors: json.lightColors,
          lightExtendedColors: json.lightExtendedColors,
          mode: json.mode ?? "dark",
          name,
          palette: json.palette ?? extractPalette(json.colors),
        };
      } catch (error) {
        logThemeDebugFailure("跳过无效自定义主题文件", error, {
          file,
          operation: "config.theme.loadCustomTheme",
        });
      }
    }
    return result;
  } catch (error) {
    logThemeDebugFailure("加载自定义主题目录失败", error, {
      dir: CUSTOM_THEMES_DIR,
      operation: "config.theme.loadCustomThemes",
    });
    return {};
  }
}

/** 从 colors 对象中提取 4 个代表色作为 palette */
function extractPalette(colors: ThemeColors): string[] {
  return [colors.primary, colors.secondary, colors.accent, colors.error];
}

// ─── 主题注册表 ────────────────────────────────────────────────

/**
 * 所有内置主题。
 *
 * 别名映射:dark → one-dark, light → one-light(向后兼容)
 */
const THEMES: Record<string, ThemeDefinition> = {
  // 别名(向后兼容)
  dark: ONE_DARK,
  light: ONE_LIGHT,

  // Dark 主题
  "one-dark": ONE_DARK,
  dracula: DRACULA,
  catppuccin: CATPPUCCIN,
  "catppuccin-frappe": CATPPUCCIN_FRAPPE,
  "catppuccin-macchiato": CATPPUCCIN_MACCHIATO,
  gruvbox: GRUVBOX,
  tokyonight: TOKYONIGHT,
  nord: NORD,
  monokai: MONOKAI,
  material: MATERIAL,
  ayu: AYU,
  everforest: EVERFOREST,
  kanagawa: KANAGAWA,
  nightowl: NIGHTOWL,
  synthwave84: SYNTHWAVE84,
  cobalt2: COBALT2,
  palenight: PALENIGHT,
  rosepine: ROSEPINE,
  vesper: VESPER,
  zenburn: ZENBURN,
  carbonfox: CARBONFOX,
  matrix: MATRIX,
  vercel: VERCEL,
  orng: ORNG,
  aura: AURA,
  "osaka-jade": OSAKA_JADE,
  mercury: MERCURY,
  cursor: CURSOR_THEME,
  "lucent-orng": LUCENT_ORNG,
  flexoki: FLEXOKI,
  opencode: OPENCODE,

  // Light 主题
  "one-light": ONE_LIGHT,
  github: GITHUB_LIGHT,
  solarized: SOLARIZED_LIGHT,
};

/** 所有去重主题(不含 dark/light 别名) */
const UNIQUE_THEMES: ThemeDefinition[] = [
  // Dark
  ONE_DARK,
  DRACULA,
  CATPPUCCIN,
  CATPPUCCIN_FRAPPE,
  CATPPUCCIN_MACCHIATO,
  GRUVBOX,
  TOKYONIGHT,
  NORD,
  MONOKAI,
  MATERIAL,
  AYU,
  EVERFOREST,
  KANAGAWA,
  NIGHTOWL,
  SYNTHWAVE84,
  COBALT2,
  PALENIGHT,
  ROSEPINE,
  VESPER,
  ZENBURN,
  CARBONFOX,
  MATRIX,
  VERCEL,
  ORNG,
  AURA,
  OSAKA_JADE,
  MERCURY,
  CURSOR_THEME,
  LUCENT_ORNG,
  FLEXOKI,
  OPENCODE,
  // Light
  ONE_LIGHT,
  GITHUB_LIGHT,
  SOLARIZED_LIGHT,
];

/**
 * 解析主题颜色(支持 dark/light 双变体)。
 *
 * 如果当前 mode 与主题默认 mode 一致，返回 colors；
 * 如果主题定义了 lightColors 且 mode 不一致，返回 lightColors。
 */
export function resolveThemeColors(theme: ThemeDefinition, mode: "dark" | "light"): ThemeColors {
  if (theme.mode === mode) {
    return theme.colors;
  }
  if (mode === "light" && theme.lightColors) {
    return theme.lightColors;
  }
  return theme.colors;
}

/**
 * 解析主题精确扩展 token。
 *
 * 没有覆盖时由 ThemeProvider 按基础色派生，确保旧主题兼容。
 */
export function resolveThemeExtendedOverrides(
  theme: ThemeDefinition,
  mode: "dark" | "light",
): ThemeExtendedOverrides | undefined {
  if (theme.mode === mode) {
    return theme.extendedColors;
  }
  if (mode === "light" && theme.lightColors) {
    return theme.lightExtendedColors;
  }
  return theme.extendedColors;
}

/**
 * 获取主题定义。
 *
 * 优先级:自定义主题 > 内置主题
 */
export function getThemeDefinition(name: string): ThemeDefinition {
  return _customThemes[name] ?? THEMES[name] ?? ONE_DARK;
}

/**
 * 列出所有可用主题(去重 + 自定义主题，不含 dark/light 别名)。
 */
export function listThemes(): ThemeDefinition[] {
  return [...UNIQUE_THEMES, ...Object.values(_customThemes)];
}

/**
 * 按 mode 过滤主题。
 */
export function listThemesByMode(mode: "dark" | "light"): ThemeDefinition[] {
  return UNIQUE_THEMES.filter((t) => t.mode === mode);
}

/**
 * 获取默认主题名称。
 */
export function getDefaultTheme(): string {
  return "one-dark";
}

/**
 * 检查主题名是否存在(内置 + 自定义)。
 */
export function isThemeValid(name: string): boolean {
  return name in THEMES || name in _customThemes;
}

// ─── 自定义主题初始化 ────────────────────────────────────────

/** 自定义主题缓存(从 ~/.crab/themes/*.json 加载) */
const _customThemes: Record<string, ThemeDefinition> = loadCustomThemes();

/**
 * 添加或更新自定义主题(运行时动态注册)。
 * 用于插件系统注入主题。
 */
export function addTheme(name: string, theme: ThemeDefinition): boolean {
  if (!name || !theme.colors) {
    return false;
  }
  _customThemes[name] = theme;
  return true;
}

/**
 * 获取所有自定义主题。
 */
export function listCustomThemes(): Record<string, ThemeDefinition> {
  return { ..._customThemes };
}

// ─── 系统主题自动生成 ──────────────────────────────────────

/**
 * 从终端调色板自动生成 system 主题。
 *
 * 此函数为降级版本:尝试获取终端 palette，失败则返回 undefined。
 */
export function generateSystemTheme(palette?: string[]): ThemeDefinition | undefined {
  if (!palette || palette.length < 8) {
    return undefined;
  }

  const bg = palette[0] ?? "#000000";
  const fg = palette[7] ?? "#ffffff";
  const red = palette[1] ?? "#ff0000";
  const green = palette[2] ?? "#00ff00";
  const yellow = palette[3] ?? "#ffff00";
  const blue = palette[4] ?? "#0000ff";
  const magenta = palette[5] ?? "#ff00ff";
  const cyan = palette[6] ?? "#00ffff";

  return {
    colors: {
      accent: yellow,
      background: bg,
      border: "#333333",
      error: red,
      info: cyan,
      muted: "#6c6c6c",
      primary: cyan,
      secondary: magenta,
      success: green,
      text: fg,
      warning: yellow,
    },
    label: "System (终端)",
    mode: "dark",
    name: "system",
    palette: [cyan, magenta, green, yellow],
  };
}

// ─── 语法高亮 ──────────────────────────────────────────────

/** 语法高亮颜色映射 */
export interface SyntaxColors {
  comment: string;
  keyword: string;
  function: string;
  variable: string;
  string: string;
  number: string;
  type: string;
  operator: string;
  punctuation: string;
}

/**
 * 从主题颜色生成语法高亮映射。
 *
 */
export function generateSyntaxColors(colors: ThemeColors): SyntaxColors {
  return {
    comment: colors.muted,
    function: colors.primary,
    keyword: colors.secondary,
    number: colors.warning,
    operator: colors.accent,
    punctuation: colors.text,
    string: colors.success,
    type: colors.info,
    variable: colors.text,
  };
}
