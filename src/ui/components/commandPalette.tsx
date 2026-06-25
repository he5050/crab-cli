/**
 * CommandPalette
 *
 * 职责:
 *   - 显示可用命令列表并支持搜索
 *   - 按分类分组展示命令
 *   - 处理命令选择和执行
 *
 * 模块功能:
 *   - 从命令注册表获取所有可见命令
 *   - 实现模糊搜索过滤命令
 *   - 按分类分组渲染命令列表
 *   - 支持键盘导航(↑↓ 选择，Enter 执行，Esc 关闭)
 *   - 显示命令快捷键和描述信息
 *   - 根据使用频率排序命令
 *
 * 使用场景:
 *   - 用户通过快捷键打开命令面板
 *   - 快速搜索和执行可用命令
 *   - 浏览命令分类和发现功能
 *
 * 边界:
 *   1. 仅显示未隐藏的命令(除非输入 / 前缀)
 *   2. 搜索结果按 frecency(频率+最近使用)排序
 *   3. 列表最大显示 8 行，超出部分滚动
 *
 * 流程:
 *   1. 接收初始搜索词(可选)
 *   2. 过滤并排序命令列表
 *   3. 按分类分组渲染
 *   4. 处理键盘输入更新搜索词
 *   5. 执行选中的命令
 */
import { For, Show, createMemo, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "@/ui/contexts/theme";
import { getCommandRegistry } from "@/commandPalette/registry";
import { resolveEscape } from "../escBehavior";
import type { Command } from "@/commandPalette/types";

export function shouldShowCommandInPalette(cmd: Command, query: string): boolean {
  if (!cmd.hidden) {
    return true;
  }
  const trimmed = query.trim();
  if (!trimmed.startsWith("/")) {
    return false;
  }
  const slash = cmd.slashName ? `/${cmd.slashName}` : "";
  return slash.length > 0 && fuzzyMatch(trimmed.toLowerCase(), slash.toLowerCase()) > 0;
}

/** 评分式 fuzzy match:返回匹配分数，0 = 不匹配 */
function fuzzyMatch(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  let score = 0;
  let lastMatchIdx = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
      // 连续匹配加分
      if (lastMatchIdx === ti - 1) {
        score += 4;
      }
      // 词边界加分(字符前是 / 或空格)
      else if (ti === 0 || t[ti - 1] === " " || t[ti - 1] === "/" || t[ti - 1] === "-") {
        score += 2;
      } else {
        score += 1;
      }
      // 目标字符串中的匹配位置越靠前越好
      score += 1 / (ti + 1);
      lastMatchIdx = ti;
    }
  }
  return qi === q.length ? score : 0;
}

function hl(text: string, query: string): { text: string; matched: boolean }[] {
  if (!query) {
    return [{ matched: false, text }];
  }
  const q = query.toLowerCase();
  let qi = 0;
  const r: { text: string; matched: boolean }[] = [];
  let cur = "";
  let curM = false;
  for (const ch of text) {
    const m = qi < q.length && ch.toLowerCase() === q[qi];
    if (m !== curM || cur === "") {
      if (cur) {
        r.push({ matched: curM, text: cur });
      }
      cur = ch;
      curM = m;
    } else {
      cur += ch;
    }
    if (m) {
      qi++;
    }
  }
  if (cur) {
    r.push({ matched: curM, text: cur });
  }
  return r;
}

export function CommandPalette(props: { onClose: () => void; initialQuery?: string }) {
  const theme = useTheme();
  const c = theme.colors;
  const selFg = createMemo(() => theme.selectedForeground(c.primary));
  const [query, setQuery] = createSignal(props.initialQuery ?? "");
  const [selIdx, setSelIdx] = createSignal(0);

  const allCmds = createMemo(() =>
    getCommandRegistry()
      .listAll()
      .filter((cmd) => shouldShowCommandInPalette(cmd, query())),
  );

  const filtered = createMemo(() => {
    const q = query().trim();
    const cmds = allCmds();
    const registry = getCommandRegistry();
    if (!q) {
      return registry.sortByFrecency(cmds);
    }
    // 评分排序:fuzzy score + frecency 权重
    const scored = cmds
      .map((cmd) => {
        const t = `${(cmd.slashName ? "/" + cmd.slashName + " " : "") + cmd.title} ${cmd.description ?? ""}`;
        return { cmd, score: fuzzyMatch(q, t) };
      })
      .filter((item) => item.score > 0);
    scored.sort((a, b) => b.score - a.score);
    return scored.map((item) => item.cmd);
  });

  const rows = createMemo(() => {
    const items = filtered();
    const result: { type: "cat" | "cmd"; cat?: string; cmd?: Command }[] = [];
    const groups = new Map<string, Command[]>();
    for (const cmd of items) {
      const cat = cmd.category || "其他";
      if (!groups.has(cat)) {
        groups.set(cat, []);
      }
      groups.get(cat)!.push(cmd);
    }
    for (const [cat, cmds] of groups) {
      result.push({ cat, type: "cat" });
      for (const cmd of cmds) {
        result.push({ cmd, type: "cmd" });
      }
    }
    return result;
  });

  const cmdRows = createMemo(() => rows().filter((r) => r.type === "cmd"));
  const LIST_H = 8;

  const selRowIdx = createMemo(() => {
    const sel = cmdRows()[selIdx()];
    if (!sel?.cmd) {
      return 0;
    }
    const selName = sel.cmd.name;
    return rows().findIndex((r) => r.type === "cmd" && r.cmd?.name === selName);
  });

  const viewStart = createMemo(() => {
    const sel = selRowIdx();
    const total = rows().length;
    if (total <= LIST_H) {
      return 0;
    }
    const half = Math.floor(LIST_H / 2);
    let s = sel - half;
    if (s < 0) {
      s = 0;
    }
    if (s + LIST_H > total) {
      s = total - LIST_H;
    }
    return s;
  });

  const visible = createMemo(() => rows().slice(viewStart(), viewStart() + LIST_H));

  const execSelected = () => {
    const item = cmdRows()[selIdx()];
    if (item?.cmd) {
      void item.cmd.run();
      props.onClose();
    }
  };

  useKeyboard((event) => {
    const n = event.name;
    // 命令面板打开时，拦截所有键盘事件，防止冒泡到父组件
    if (n === "escape") {
      const a = resolveEscape({ openDialog: true });
      if (a.kind === "closeTopDialog") {
        event.stopPropagation();
        props.onClose();
        return;
      }
      event.stopPropagation();
      return;
    }
    if (n === "up") {
      event.stopPropagation();
      setSelIdx((i) => Math.max(0, i - 1));
      return;
    }
    if (n === "down") {
      event.stopPropagation();
      setSelIdx((i) => Math.min(cmdRows().length - 1, i + 1));
      return;
    }
    if (n === "return" || n === "enter") {
      event.stopPropagation();
      execSelected();
      return;
    }
    if (n === "backspace") {
      event.stopPropagation();
      if (query().length === 0) {
        props.onClose();
        return;
      }
      setQuery((q) => q.slice(0, -1));
      setSelIdx(0);
      return;
    }
    if (n === "tab") {
      event.stopPropagation();
      const item = cmdRows()[selIdx()];
      if (item?.cmd?.slashName) {
        setQuery(`/${item.cmd.slashName} `);
        setSelIdx(0);
      }
      return;
    }
    if (n && n.length === 1 && !event.ctrl && !event.meta) {
      event.stopPropagation();
      setQuery((q) => q + n);
      setSelIdx(0);
      return;
    }
    event.stopPropagation();
  });

  const selectedCmd = createMemo(() => cmdRows()[selIdx()]?.cmd);

  return (
    <box flexDirection="column" borderStyle="single" borderColor={c.primary} backgroundColor={c.background} height={14}>
      {/* 搜索栏 */}
      <box flexDirection="row" paddingLeft={2} paddingRight={1} height={1} alignItems="center">
        <text>
          <span style={{ fg: c.accent }}>{"❯ "}</span>
          <span style={{ fg: c.text }}>{query()}</span>
          <span style={{ fg: c.accent }}>{"▎"}</span>
          <Show when={!query()}>
            <span style={{ fg: c.muted }}>{"搜索命令..."}</span>
          </Show>
        </text>
        <box flexDirection="row" marginLeft="auto">
          <text fg={c.muted}>{"esc 关闭"}</text>
        </box>
      </box>

      {/* 分隔线 */}
      <box height={1}>
        <text fg={c.border}>{"─".repeat(60)}</text>
      </box>

      {/* 命令列表 */}
      <box flexDirection="column" height={8} paddingLeft={1} paddingRight={1}>
        <Show
          when={cmdRows().length > 0}
          fallback={
            <box paddingLeft={2} paddingTop={3} justifyContent="center">
              <text fg={c.muted}>{"  无匹配命令"}</text>
            </box>
          }
        >
          <For each={visible()}>
            {(row) => {
              if (row.type === "cat") {
                return (
                  <box paddingLeft={1} height={1}>
                    <text fg={c.primary}>
                      <b>{row.cat}</b>
                    </text>
                  </box>
                );
              }

              const cmd = row.cmd!;
              const isSel = () => cmdRows().findIndex((r) => r.cmd?.name === cmd.name) === selIdx();
              const q = query().trim();
              const slash = cmd.slashName ? `/${cmd.slashName}` : "";
              const parts = hl(cmd.title, q);

              return (
                <box
                  flexDirection="row"
                  height={1}
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={isSel() ? c.primary : undefined}
                  {...({} as any)}
                >
                  <text>
                    <span style={{ fg: isSel() ? selFg() : c.muted }}>{isSel() ? "▸ " : "  "}</span>
                    <Show when={slash}>
                      <span style={{ fg: isSel() ? selFg() : c.warning }}>{slash.padEnd(20)}</span>
                    </Show>
                    <For each={parts}>
                      {(part) => (
                        <span
                          style={{
                            fg: part.matched ? (isSel() ? selFg() : c.accent) : isSel() ? selFg() : c.text,
                          }}
                        >
                          {part.text}
                        </span>
                      )}
                    </For>
                  </text>
                </box>
              );
            }}
          </For>
        </Show>
      </box>

      {/* 分隔线 */}
      <box height={1}>
        <text fg={c.border}>{"─".repeat(60)}</text>
      </box>

      {/* 底部 */}
      <box
        flexDirection="row"
        justifyContent="space-between"
        paddingLeft={2}
        paddingRight={2}
        height={1}
        alignItems="center"
      >
        <text fg={c.muted}>{selectedCmd()?.description ?? " "}</text>
        <text fg={c.muted}>{"↑↓ 导航 · Tab 补全 · ↵ 执行"}</text>
      </box>
    </box>
  );
}
