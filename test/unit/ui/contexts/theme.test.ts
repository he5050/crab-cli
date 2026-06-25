/**
 * 主题系统测试。
 *
 * 测试用例:
 *   - 获取主题定义
 *   - 未知主题回退
 *   - 主题有效性验证
 *   - 列出所有主题
 *   - 按模式过滤主题
 *   - 主题颜色解析
 *   - ThemeProvider RGBA / cycleTheme / setMode
 */
import { describe, expect, test } from "bun:test";
import { createRoot } from "solid-js";
import { ThemeProvider, useTheme } from "@/ui/contexts/theme";

describe("主题系统", () => {
  test("getThemeDefinition 返回已知主题", async () => {
    const { getThemeDefinition } = await import("@/config/themes/themeConfig.ts");
    const dracula = getThemeDefinition("dracula");
    expect(dracula.name).toBe("dracula");
    expect(dracula.mode).toBe("dark");
    expect(dracula.colors.primary).toBeDefined();
  });

  test("getThemeDefinition 未知主题回退到默认", async () => {
    const { getThemeDefinition } = await import("@/config/themes/themeConfig.ts");
    const fallback = getThemeDefinition("nonexistent-theme");
    expect(fallback.name).toBe("one-dark");
  });

  test("isThemeValid 正确验证", async () => {
    const { isThemeValid } = await import("@/config/themes/themeConfig.ts");
    expect(isThemeValid("dracula")).toBe(true);
    expect(isThemeValid("nonexistent")).toBe(false);
    expect(isThemeValid("dark")).toBe(true); // 别名
  });

  test("listThemes 返回 34+ 主题", async () => {
    const { listThemes } = await import("@/config/themes/themeConfig.ts");
    const themes = listThemes();
    expect(themes.length).toBeGreaterThanOrEqual(34);
  });

  test("listThemesByMode 按模式过滤", async () => {
    const { listThemesByMode } = await import("@/config/themes/themeConfig.ts");
    const dark = listThemesByMode("dark");
    const light = listThemesByMode("light");
    expect(dark.length).toBeGreaterThanOrEqual(28);
    expect(light.length).toBeGreaterThanOrEqual(3);
  });

  test("resolveThemeColors 双变体", async () => {
    const { getThemeDefinition, resolveThemeColors } = await import("@/config/themes/themeConfig.ts");
    const oneDark = getThemeDefinition("one-dark");
    // Dark mode → 返回 colors
    const darkColors = resolveThemeColors(oneDark, "dark");
    expect(darkColors.background).toBe("#282c34");
    // Light mode → 返回 lightColors(如果定义了)
    const lightColors = resolveThemeColors(oneDark, "light");
    expect(lightColors).toBeDefined();
  });

  test("ThemeProvider 提供 RGBA 主题对象并支持 cycleTheme / setMode", async () => {
    let snapshot:
      | {
          initialName: string;
          cycledName: string;
          lightThemeName: string;
          primaryHex?: string;
          backgroundHex?: string;
          allThemesCount: number;
        }
      | undefined;
    let themeApi: ReturnType<typeof useTheme> | undefined;

    createRoot((dispose) => {
      ThemeProvider({
        get children() {
          themeApi = useTheme();
          return null;
        },
        initialTheme: "dracula",
      });

      const initialName = themeApi!.themeName;
      const initialPrimaryBuffer = [...(themeApi!.theme.primary.buffer ?? [])];
      themeApi!.cycleTheme();
      const cycledName = themeApi!.themeName;
      themeApi!.setMode("light");
      const lightThemeName = themeApi!.themeName;
      const backgroundBuffer = [...(themeApi!.theme.background.buffer ?? [])];

      snapshot = {
        allThemesCount: themeApi!.allThemes().length,
        backgroundHex: backgroundBuffer.join(","),
        cycledName,
        initialName,
        lightThemeName,
        primaryHex: initialPrimaryBuffer.join(","),
      };
      dispose();
    });

    expect(snapshot).toBeDefined();
    expect(snapshot!.initialName).toBe("dracula");
    expect(snapshot!.cycledName).not.toBe(snapshot!.initialName);
    expect(snapshot!.primaryHex).toBeTruthy();
    expect(snapshot!.backgroundHex).toBeTruthy();
    expect(snapshot!.allThemesCount).toBeGreaterThanOrEqual(34);

    const { getThemeDefinition } = await import("@/config/themes/themeConfig.ts");
    expect(getThemeDefinition(snapshot!.lightThemeName).mode).toBe("light");
  });

  test("opencode 默认主题 dark/light token 与参考基线一致", async () => {
    const { getDefaultTheme, getThemeDefinition, resolveThemeColors, resolveThemeExtendedOverrides } =
      await import("@/config/themes/themeConfig.ts");
    const { deriveExtendedColors } = await import("@/ui/contexts/theme.tsx");

    const definition = getThemeDefinition("opencode");
    expect(getDefaultTheme()).toBe("opencode");

    const dark = deriveExtendedColors(
      resolveThemeColors(definition, "dark"),
      "dark",
      resolveThemeExtendedOverrides(definition, "dark"),
    );
    expect({
      accent: dark.accent,
      background: dark.background,
      backgroundElement: dark.bg.element,
      backgroundPanel: dark.bg.panel,
      border: dark.borderExt.main,
      borderActive: dark.borderExt.active,
      borderSubtle: dark.borderExt.subtle,
      diffAdded: dark.diff.added,
      diffAddedBg: dark.diff.addedBg,
      diffLineNumber: dark.diff.lineNumber,
      diffRemoved: dark.diff.removed,
      diffRemovedBg: dark.diff.removedBg,
      error: dark.error,
      info: dark.info,
      primary: dark.primary,
      secondary: dark.secondary,
      selectedListItemText: dark.selectedListItemText,
      success: dark.success,
      text: dark.text,
      textMuted: dark.textMuted,
      warning: dark.warning,
    }).toEqual({
      accent: "#9d7cd8",
      background: "#0a0a0a",
      backgroundElement: "#1e1e1e",
      backgroundPanel: "#141414",
      border: "#484848",
      borderActive: "#606060",
      borderSubtle: "#3c3c3c",
      diffAdded: "#4fd6be",
      diffAddedBg: "#20303b",
      diffLineNumber: "#8f8f8f",
      diffRemoved: "#c53b53",
      diffRemovedBg: "#37222c",
      error: "#e06c75",
      info: "#56b6c2",
      primary: "#fab283",
      secondary: "#5c9cf5",
      selectedListItemText: "#0a0a0a",
      success: "#7fd88f",
      text: "#eeeeee",
      textMuted: "#808080",
      warning: "#f5a742",
    });

    const light = deriveExtendedColors(
      resolveThemeColors(definition, "light"),
      "light",
      resolveThemeExtendedOverrides(definition, "light"),
    );
    expect({
      accent: light.accent,
      background: light.background,
      backgroundElement: light.bg.element,
      backgroundPanel: light.bg.panel,
      border: light.borderExt.main,
      borderActive: light.borderExt.active,
      borderSubtle: light.borderExt.subtle,
      diffAdded: light.diff.added,
      diffAddedBg: light.diff.addedBg,
      diffLineNumber: light.diff.lineNumber,
      diffRemoved: light.diff.removed,
      diffRemovedBg: light.diff.removedBg,
      error: light.error,
      info: light.info,
      primary: light.primary,
      secondary: light.secondary,
      selectedListItemText: light.selectedListItemText,
      success: light.success,
      text: light.text,
      textMuted: light.textMuted,
      warning: light.warning,
    }).toEqual({
      accent: "#d68c27",
      background: "#ffffff",
      backgroundElement: "#f5f5f5",
      backgroundPanel: "#fafafa",
      border: "#b8b8b8",
      borderActive: "#a0a0a0",
      borderSubtle: "#d4d4d4",
      diffAdded: "#1e725c",
      diffAddedBg: "#d5e5d5",
      diffLineNumber: "#595959",
      diffRemoved: "#c53b53",
      diffRemovedBg: "#f7d8db",
      error: "#d1383d",
      info: "#318795",
      primary: "#3b7dd8",
      secondary: "#7b5bb6",
      selectedListItemText: "#ffffff",
      success: "#3d9a57",
      text: "#1a1a1a",
      textMuted: "#8a8a8a",
      warning: "#d68c27",
    });
  });

  test("opencode 选中态前景色使用 background/selected token", () => {
    const snapshotFor = (initialMode: "dark" | "light") => {
      let snapshot: { mode: string; selected: string; backgroundPanel: string } | undefined;

      createRoot((dispose) => {
        ThemeProvider({
          get children() {
            const theme = useTheme();
            snapshot = {
              backgroundPanel: theme.extended.bg.panel,
              mode: theme.mode,
              selected: theme.selectedForeground(theme.colors.primary),
            };
            return null;
          },
          initialMode,
          initialTheme: "opencode",
        });
        dispose();
      });

      return snapshot;
    };

    expect(snapshotFor("dark")).toEqual({ backgroundPanel: "#141414", mode: "dark", selected: "#0a0a0a" });
    expect(snapshotFor("light")).toEqual({ backgroundPanel: "#fafafa", mode: "light", selected: "#ffffff" });
  });
});
