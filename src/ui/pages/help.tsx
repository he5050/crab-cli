/**
 * 帮助页 — 集中展示所有命令与快捷键的速查页面。
 *
 * 职责:
 *   - 分类展示命令面板命令
 *   - 分类展示按键绑定
 *   - 提供 esc 退出
 */
import { For, Show, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "@/ui/contexts/theme";
import { getCommandRegistry } from "@/commandPalette/registry";

interface HelpSection {
  title: string;
  color: string;
  items: string[];
}

const CATEGORY_COLORS: Record<string, string> = {
  Agent: "green",
  Git: "blue",
  Hook: "magenta",
  IDE: "blue",
  代码库: "blue",
  任务: "green",
  会话: "green",
  其他: "cyan",
  导航: "cyan",
  工具: "blue",
  框架: "cyan",
  模式: "magenta",
  界面: "cyan",
  管理: "yellow",
  角色: "yellow",
  配置: "yellow",
};

function buildDynamicSections(): HelpSection[] {
  const registry = getCommandRegistry();
  const slashCmds = registry.listSlashCommands().filter((c) => !c.hidden);
  if (slashCmds.length === 0) {
    return [];
  }

  const byCategory = new Map<string, { name: string; desc: string }[]>();
  let maxNameLen = 0;
  for (const cmd of slashCmds) {
    const cat = cmd.category ?? "其他";
    if (!byCategory.has(cat)) {
      byCategory.set(cat, []);
    }
    byCategory.get(cat)!.push({
      desc: cmd.description || cmd.title || "",
      name: cmd.slashName!,
    });
    if (cmd.slashName!.length > maxNameLen) {
      maxNameLen = cmd.slashName!.length;
    }
  }

  const categoryOrder = [
    "框架",
    "导航",
    "会话",
    "配置",
    "模式",
    "工具",
    "Git",
    "代码库",
    "IDE",
    "任务",
    "管理",
    "Hook",
    "角色",
    "Agent",
    "界面",
    "其他",
  ];

  const sections: HelpSection[] = [];
  const usedCategories = new Set(byCategory.keys());
  const pad = maxNameLen + 2;
  for (const cat of categoryOrder) {
    if (!usedCategories.has(cat)) {
      continue;
    }
    usedCategories.delete(cat);
    const items = byCategory.get(cat)!;
    sections.push({
      color: CATEGORY_COLORS[cat] ?? "green",
      items: items.map((c) => `/${c.name.padEnd(pad)}${c.desc}`),
      title: `斜杠命令 — ${cat}`,
    });
  }
  for (const cat of usedCategories) {
    const items = byCategory.get(cat)!;
    sections.push({
      color: CATEGORY_COLORS[cat] ?? "green",
      items: items.map((c) => `/${c.name.padEnd(pad)}${c.desc}`),
      title: `斜杠命令 — ${cat}`,
    });
  }

  return sections;
}

const STATIC_SECTIONS: HelpSection[] = [
  {
    color: "cyan",
    items: [
      "Enter         开始新对话",
      "S             打开设置",
      "M             MCP 服务器管理",
      "?             显示帮助页面",
      "Ctrl+L        打开日志目录",
      "Ctrl+C        退出应用",
      "Esc           返回 / 取消",
    ],
    title: "导航",
  },
  {
    color: "yellow",
    items: [
      "Enter         发送消息",
      "Shift+Enter   换行",
      "Up/Down       浏览输入历史",
      "Tab           自动补全",
      "Ctrl+A        跳到行首",
      "Ctrl+E        跳到行尾",
      "Ctrl+W        向前删除一个词",
      "Ctrl+U        删除到行首",
      "Ctrl+K        删除到行尾",
    ],
    title: "输入",
  },
  {
    color: "magenta",
    items: ["y/Enter       批准工具执行", "n/Esc         拒绝工具执行", "a             始终允许此工具"],
    title: "工具与权限",
  },
  {
    color: "blue",
    items: ["!<command>    直接执行 Bash 命令", "  e.g. !ls -la"],
    title: "Bash 模式",
  },
];

function buildHelpSections(): HelpSection[] {
  const dynamic = buildDynamicSections();
  return [...STATIC_SECTIONS, ...dynamic];
}

const MAX_VISIBLE_LINES = 18;

export function Help() {
  const theme = useTheme();
  const [offset, setOffset] = createSignal(0);

  const allLines = () => {
    const sections = buildHelpSections();
    const lines: { type: "title" | "item" | "spacer"; text: string; color?: string }[] = [];
    for (const section of sections) {
      if (lines.length > 0) {
        lines.push({ text: "", type: "spacer" });
      }
      lines.push({ color: section.color, text: section.title, type: "title" });
      for (const item of section.items) {
        lines.push({ text: `  ${item}`, type: "item" });
      }
    }
    return lines;
  };

  const totalLines = () => allLines().length;
  const maxVisible = Math.min(totalLines(), MAX_VISIBLE_LINES);
  const canScroll = () => totalLines() > maxVisible;

  useKeyboard((event) => {
    if (event.name === "escape") {
      event.stopPropagation();
      return;
    }
    if (!canScroll()) {
      return;
    }
    if (event.name === "up") {
      setOffset((o) => Math.max(0, o - 1));
      event.stopPropagation();
    } else if (event.name === "down") {
      setOffset((o) => Math.min(totalLines() - maxVisible, o + 1));
      event.stopPropagation();
    }
  });

  const visibleLines = () => {
    const lines = allLines();
    const o = Math.min(Math.max(0, offset()), Math.max(0, lines.length - maxVisible));
    return lines.slice(o, o + maxVisible);
  };

  const hiddenAbove = () => Math.min(Math.max(0, offset()), Math.max(0, allLines().length - maxVisible));
  const hiddenBelow = () => Math.max(0, allLines().length - hiddenAbove() - maxVisible);

  const colorMap: Record<string, string> = {
    blue: theme.colors.info,
    cyan: theme.colors.accent,
    green: theme.colors.success,
    magenta: theme.colors.warning,
    yellow: theme.colors.warning,
  };

  return (
    <box flexDirection="column" flexGrow={1} padding={1}>
      <text fg={theme.colors.text}>帮助 — 快捷键与命令</text>
      <box height={1} />

      <Show when={canScroll() && hiddenAbove() > 0}>
        <text fg={theme.colors.muted}>{`  ↑ ${hiddenAbove()} 向上还有更多`}</text>
      </Show>

      <For each={visibleLines()}>
        {(line) => {
          if (line.type === "spacer") {
            return <box height={1} />;
          }
          if (line.type === "title") {
            return <text fg={colorMap[line.color ?? ""] ?? theme.colors.accent}>{line.text}</text>;
          }
          return <text fg={theme.colors.text}>{line.text}</text>;
        }}
      </For>

      <Show when={canScroll() && hiddenBelow() > 0}>
        <text fg={theme.colors.muted}>{`  ↓ ${hiddenBelow()} 向下还有更多`}</text>
      </Show>

      <box height={1} />
      <text fg={theme.colors.muted}>按 Esc 返回上一页</text>
    </box>
  );
}
