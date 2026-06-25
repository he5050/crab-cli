/**
 * 主题设置页面
 *
 * 职责:
 *   - 浏览和切换界面主题
 *   - 预览主题颜色
 *   - 管理主题配置
 *
 * 模块功能:
 *   - 预设主题列表:one-dark、one-light、dracula、nord、solarized 等
 *   - 当前主题标记(★)
 *   - 颜色预览:Primary、Secondary、Accent
 *   - 键盘导航选择和切换主题
 *
 * 使用场景:
 *   - 切换界面主题风格
 *   - 预览主题颜色效果
 *
 * 边界:
 *   1. 仅支持预设主题列表
 *   2. 主题切换即时生效
 *   3. 配置保存到全局配置
 *
 * 流程:
 *   1. 加载当前主题名称
 *   2. 显示主题列表和当前主题标记
 *   3. 导航选择主题
 *   4. Enter 应用选中的主题
 */

import { For, Show, createMemo, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "@/ui/contexts/theme";

// ─── 预设主题 ──────────────────────────────────────────────

interface ThemeOption {
  name: string;
  description: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
  };
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    colors: { accent: "#c678dd", primary: "#528bff", secondary: "#98c379" },
    description: "Atom One Dark — 深色护眼",
    name: "one-dark",
  },
  {
    colors: { accent: "#a626a4", primary: "#4078f2", secondary: "#50a14f" },
    description: "Atom One Light — 明亮清爽",
    name: "one-light",
  },
  {
    colors: { accent: "#ff79c6", primary: "#bd93f9", secondary: "#50fa7b" },
    description: "Dracula — 经典深色",
    name: "dracula",
  },
  {
    colors: { accent: "#b48ead", primary: "#88c0d0", secondary: "#a3be8c" },
    description: "Nord — 北极冷色调",
    name: "nord",
  },
  {
    colors: { accent: "#d33682", primary: "#268bd2", secondary: "#859900" },
    description: "Solarized Dark — 暖色深底",
    name: "solarized-dark",
  },
  {
    colors: { accent: "#d33682", primary: "#268bd2", secondary: "#859900" },
    description: "Solarized Light — 暖色浅底",
    name: "solarized-light",
  },
  {
    colors: { accent: "#ae81ff", primary: "#f92672", secondary: "#a6e22e" },
    description: "Monokai — 编辑器经典",
    name: "monokai",
  },
  {
    colors: { accent: "#bc8cff", primary: "#58a6ff", secondary: "#3fb950" },
    description: "GitHub Dark — 开发者友好",
    name: "github-dark",
  },
];

// ─── Props ─────────────────────────────────────────────────

export interface ThemeSettingsProps {
  onClose: () => void;
}

// ─── ThemeSettingsPage 组件 ─────────────────────────────────

export function ThemeSettingsPage(props: ThemeSettingsProps) {
  const theme = useTheme();

  const [focusIndex, setFocusIndex] = createSignal(0);

  const listOptions = createMemo(() => {
    const themeItems = THEME_OPTIONS.map((t) => ({
      label: `${t.name === theme.themeName ? "★ " : "  "}${t.name} — ${t.description}`,
      themeOpt: t,
      value: t.name,
    }));

    return [
      ...themeItems,
      { label: "─".repeat(40), themeOpt: null as any, value: "__sep__" },
      { label: "← 返回", themeOpt: null as any, value: "__back__" },
    ];
  });

  // ─── 键盘处理 ────────────────────────────────────────

  useKeyboard((event) => {
    if (event.name === "escape") {
      props.onClose();
      return;
    }

    if (event.name === "up") {
      setFocusIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (event.name === "down") {
      setFocusIndex((i) => Math.min(listOptions().length - 1, i + 1));
      return;
    }

    if (event.name === "return" || event.name === "enter") {
      const idx = focusIndex();
      const opt = listOptions()[idx];
      if (!opt) {
        return;
      }

      if (opt.value === "__back__") {
        props.onClose();
      } else if (opt.value === "__sep__") {
        // Skip
      } else {
        theme.setTheme(opt.value);
      }
    }
  });

  // 预览当前焦点主题
  const currentPreview = createMemo(() => {
    const idx = focusIndex();
    const opt = listOptions()[idx];
    return opt?.themeOpt || null;
  });

  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <box marginBottom={1}>
        <span style={{ fg: theme.colors.warning, "font-weight": "bold" }}>{"主题设置"}</span>
        <text fg={theme.colors.muted}>{` — 当前: ${theme.themeName}`}</text>
      </box>

      <box flexDirection="column" paddingLeft={1}>
        <For each={listOptions()}>
          {(option, index) => {
            const isSelected = () => index() === focusIndex();
            if (option.value === "__sep__") {
              return <text fg={theme.colors.muted}>{option.label}</text>;
            }
            return (
              <text
                fg={isSelected() ? theme.colors.text : theme.colors.muted}
                backgroundColor={isSelected() ? theme.colors.primary : undefined}
                {...({} as any)}
              >
                {`${isSelected() ? "❯ " : "  "}${option.label}`}
              </text>
            );
          }}
        </For>
      </box>

      {/* 颜色预览 */}
      <Show when={currentPreview()}>
        <box marginTop={1} paddingLeft={1} flexDirection="column">
          <text fg={theme.colors.muted}>{"颜色预览:"}</text>
          <box flexDirection="row" marginTop={1}>
            <text fg={currentPreview()!.colors.primary}>{"██ Primary  "}</text>
            <text fg={currentPreview()!.colors.secondary}>{"██ Secondary  "}</text>
            <text fg={currentPreview()!.colors.accent}>{"██ Accent"}</text>
          </box>
        </box>
      </Show>

      <box marginTop={1}>
        <text fg={theme.colors.muted}>{"↑↓ 导航 · Enter 应用主题 · Esc 返回"}</text>
      </box>
    </box>
  );
}
