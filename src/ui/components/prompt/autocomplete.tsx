/**
 * [Prompt Autocomplete]
 *
 * 职责:
 *   - 检测 `/` 前缀触发命令补全列表
 *   - 检测 `@` 前缀触发文件引用列表(预留)
 *   - 处理键盘导航(上下键选择、Enter确认、Esc取消)
 *   - 提供 Fuzzy 模糊搜索过滤功能
 *
 * 模块功能:
 *   - Autocomplete 组件:渲染命令/文件补全下拉列表
 *   - useAutocomplete Hook:独立使用的补全状态管理
 *   - fuzzyMatch:简易模糊匹配算法
 *
 * 使用场景:
 *   - 用户在输入框输入 `/` 时显示可用命令列表
 *   - 用户在输入框输入 `@` 时显示文件引用列表
 *   - 需要键盘导航和搜索过滤的补全交互
 *
 * 边界:
 *   1. @ 文件引用模式当前为预留实现，返回空列表
 *   2. 最大显示宽度 60 字符，最大高度 12 行
 *   3. 依赖外部传入的命令列表，不内置命令定义
 *
 * 流程:
 *   1. 监听输入值变化，检测 `/` 或 `@` 前缀
 *   2. 根据前缀过滤匹配项，渲染下拉列表
 *   3. 处理键盘事件更新选中状态或确认选择
 *   4. 选择后触发 onSelect 回调并关闭列表
 */
import { For, Show, createMemo, createSignal } from "solid-js";
import { useTheme } from "@/ui/contexts/theme";

// ─── 类型 ──────────────────────────────────────────────────────

export type AutocompleteMode = false | "/" | "@";

export interface AutocompleteOption {
  display: string;
  value: string;
  description?: string;
}

export interface AutocompleteRef {
  onInput: (value: string) => void;
  visible: AutocompleteMode;
}

// ─── 简易 Fuzzy 搜索 ──────────────────────────────────────────

function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t.includes(q)) {
    return true;
  }
  // 字符级模糊匹配
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
    }
  }
  return qi === q.length;
}

// ─── Autocomplete 组件 ────────────────────────────────────────

export function Autocomplete(props: {
  /** 命令列表 */
  commands: AutocompleteOption[];
  /** 当前输入值 */
  value: string;
  /** 选择回调 */
  onSelect: (value: string) => void;
  /** 取消回调 */
  onClose: () => void;
}) {
  const theme = useTheme();
  const [selectedIndex, setSelectedIndex] = createSignal(0);

  // 检测模式
  const mode = createMemo<AutocompleteMode>(() => {
    const v = props.value;
    if (v.startsWith("/")) {
      return "/";
    }
    if (v.startsWith("@")) {
      return "@";
    }
    return false;
  });

  // 搜索 query(去掉前缀)
  const query = createMemo(() => {
    const m = mode();
    if (!m) {
      return "";
    }
    return props.value.slice(1);
  });

  // 过滤后的选项
  const filtered = createMemo(() => {
    const m = mode();
    if (!m) {
      return [];
    }
    const q = query();
    if (m === "/") {
      if (!q) {
        return props.commands;
      }
      return props.commands.filter((c) => fuzzyMatch(q, c.display) || (c.description && fuzzyMatch(q, c.description)));
    }
    // @ 模式 — 预留
    return [];
  });

  return (
    <Show when={mode() && filtered().length > 0}>
      <box
        flexDirection="column"
        backgroundColor={theme.extended.bg.panel}
        border={true}
        borderColor={theme.colors.border}
        maxWidth={60}
        maxHeight={12}
      >
        <For each={filtered()}>
          {(option, index) => (
            <box
              flexDirection="row"
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={index() === selectedIndex() ? theme.extended.bg.element : undefined}
              onMouseOver={() => setSelectedIndex(index())}
              onMouseUp={() => props.onSelect(option.value)}
            >
              <text fg={index() === selectedIndex() ? theme.colors.primary : theme.colors.text}>
                {index() === selectedIndex() ? "› " : "  "}
                {option.display}
              </text>
              <Show when={option.description}>
                <text fg={theme.colors.muted}> — {option.description}</text>
              </Show>
            </box>
          )}
        </For>
        <box paddingLeft={1} paddingTop={1}>
          <text fg={theme.colors.muted}>↑↓ 选择 · Enter 确认 · Esc 取消</text>
        </box>
      </box>
    </Show>
  );
}

// ─── Autocomplete Hook(可独立使用) ───────────────────────────

export function useAutocomplete(commands: AutocompleteOption[]) {
  const [visible, setVisible] = createSignal<AutocompleteMode>(false);
  const [query, setQuery] = createSignal("");

  function onInput(value: string) {
    if (value.startsWith("/")) {
      setVisible("/");
      setQuery(value.slice(1));
    } else if (value.startsWith("@")) {
      setVisible("@");
      setQuery(value.slice(1));
    } else {
      setVisible(false);
      setQuery("");
    }
  }

  const filtered = createMemo(() => {
    const q = query().toLowerCase();
    if (!q) {
      return commands;
    }
    return commands.filter((c) => fuzzyMatch(q, c.display) || (c.description && fuzzyMatch(q, c.description)));
  });

  return { close: () => setVisible(false), filtered, onInput, query, visible };
}
