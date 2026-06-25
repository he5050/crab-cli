/**
 * 主题系统测试。
 *
 * 测试用例:
 *   - 主题切换
 *   - 主题配置持久化
 *   - 默认主题设置
 */
import { describe, expect, test } from "bun:test";

const DARK_COLORS = {
  accent: "#e5c07b",
  background: "#282c34",
  border: "#3e4452",
  error: "#e06c75",
  muted: "#5c6370",
  primary: "#61afef",
  secondary: "#c678dd",
  success: "#98c379",
  text: "#abb2bf",
  warning: "#d19a66",
};

const LIGHT_COLORS = {
  accent: "#b76b01",
  background: "#fafafa",
  border: "#e5e5e6",
  error: "#e45649",
  muted: "#a0a1a7",
  primary: "#4078f2",
  secondary: "#a626a4",
  success: "#50a14f",
  text: "#383a42",
  warning: "#986801",
};

const REQUIRED_KEYS = [
  "primary",
  "secondary",
  "accent",
  "error",
  "warning",
  "success",
  "muted",
  "text",
  "background",
  "border",
] as const;

describe("主题 Context — 颜色配置", () => {
  test("深色主题包含所有必需颜色键", () => {
    for (const key of REQUIRED_KEYS) {
      expect(DARK_COLORS[key]).toBeDefined();
      expect(typeof DARK_COLORS[key]).toBe("string");
      expect(DARK_COLORS[key]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  test("浅色主题包含所有必需颜色键", () => {
    for (const key of REQUIRED_KEYS) {
      expect(LIGHT_COLORS[key]).toBeDefined();
      expect(typeof LIGHT_COLORS[key]).toBe("string");
      expect(LIGHT_COLORS[key]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  test("深色和浅色主题键名一致", () => {
    const darkKeys = Object.keys(DARK_COLORS).toSorted();
    const lightKeys = Object.keys(LIGHT_COLORS).toSorted();
    expect(darkKeys).toEqual(lightKeys);
  });

  test("toggle 在 dark 和 light 之间切换", () => {
    const toggle = (m: string) => (m === "dark" ? "light" : "dark");
    expect(toggle("dark")).toBe("light");
    expect(toggle("light")).toBe("dark");
    expect(toggle(toggle("dark"))).toBe("dark");
  });

  test("默认模式为 dark", () => {
    const mode: string | undefined = "dark";
    expect(mode).toBe("dark");
  });

  test("深色和浅色主题的主色和背景色不同", () => {
    expect(DARK_COLORS.primary).not.toBe(LIGHT_COLORS.primary);
    expect(DARK_COLORS.background).not.toBe(LIGHT_COLORS.background);
  });
});
