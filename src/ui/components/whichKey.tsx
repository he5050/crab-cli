/**
 * WhichKeyPanel
 *
 * 职责:
 *   - 显示可用快捷键绑定列表
 *   - 按功能分组展示快捷键
 *   - 提供自动隐藏和手动控制显示/隐藏的功能
 *
 * 模块功能:
 *   - 渲染快捷键分组列表(导航、操作、命令等)
 *   - 支持自动隐藏(默认 8 秒)
 *   - 提供 show/hide/toggle 控制方法
 *   - 预定义常用快捷键配置(SESSION_KEY_BINDINGS)
 *
 * 使用场景:
 *   - 用户按 ? 键显示快捷键帮助时
 *   - 需要展示当前上下文的可用快捷键时
 *   - 作为全局快捷键提示系统
 *
 * 边界:
 *   1. 快捷键绑定数据通过 props 传入
 *   2. 不处理键盘事件捕获，仅做展示
 *   3. 自动隐藏计时器可通过用户交互重置
 *   4. 使用 createWhichKeyControls 获取控制方法
 *
 * 流程:
 *   1. 接收快捷键绑定列表
 *   2. 按 group 字段分组渲染
 *   3. 显示后启动自动隐藏计时器
 *   4. 支持手动控制显示状态
 */
import { For, Show, createSignal, onCleanup } from "solid-js";
import { useTheme } from "@/ui/contexts/theme";

export interface KeyBinding {
  key: string;
  description: string;
  group: string;
  command?: string;
}

interface Props {
  bindings: KeyBinding[];
  visible?: boolean;
}

export const LEADER_KEY_BINDINGS: KeyBinding[] = [
  { command: "session.list", description: "会话列表", group: "会话", key: "l" },
  { command: "session.new", description: "新建会话", group: "会话", key: "n" },
  { command: "session.quick_switch.1..9", description: "快速切换", group: "会话", key: "1-9" },
  { command: "session.sidebar.toggle", description: "侧边栏", group: "会话", key: "b" },
  { command: "session.timeline", description: "时间线", group: "会话", key: "g" },
  { command: "session.compact", description: "压缩上下文", group: "会话", key: "c" },
  { command: "session.export", description: "导出", group: "会话", key: "x" },
  { command: "theme.switch", description: "主题", group: "模型", key: "t" },
  { command: "model.list", description: "模型", group: "模型", key: "m" },
  { command: "agent.list", description: "代理", group: "代理", key: "a" },
  { command: "crab.status", description: "状态", group: "应用", key: "s" },
  { command: "app.exit", description: "退出", group: "应用", key: "q" },
  { command: "messages.copy", description: "复制", group: "消息", key: "y" },
  { command: "session.undo", description: "撤销", group: "消息", key: "u" },
  { command: "session.redo", description: "重做", group: "消息", key: "r" },
  { command: "session.toggle.conceal", description: "切换隐藏", group: "消息", key: "h" },
];

export const SESSION_KEY_BINDINGS: KeyBinding[] = [
  { description: "滚动历史", group: "导航", key: "↑↓" },
  { description: "发送消息", group: "导航", key: "Enter" },
  { description: "返回/退出", group: "导航", key: "Esc" },
  { description: "命令面板", group: "导航", key: "/" },
  { description: "快捷键帮助", group: "导航", key: "?" },
  { description: "切换焦点", group: "导航", key: "Tab" },
  { description: "清屏", group: "操作", key: "Ctrl+L" },
  { description: "中断生成", group: "操作", key: "Ctrl+C" },
  { description: "保存会话", group: "操作", key: "Ctrl+S" },
  { description: "压缩上下文", group: "命令", key: "/compact" },
  { description: "计划模式", group: "命令", key: "/plan" },
  { description: "团队模式", group: "命令", key: "/team" },
  { description: "YOLO 模式", group: "命令", key: "/yolo" },
  { description: "分享会话", group: "命令", key: "/share" },
  { description: "生成摘要", group: "命令", key: "/summarize" },
  { description: "创建快照", group: "命令", key: "/snapshot" },
];

export function WhichKeyPanel(props: Props) {
  const theme = useTheme();
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  onCleanup(() => {
    if (hideTimer) {
      clearTimeout(hideTimer);
    }
  });

  const grouped = () => {
    const map = new Map<string, KeyBinding[]>();
    for (const b of props.bindings) {
      const list = map.get(b.group) ?? [];
      list.push(b);
      map.set(b.group, list);
    }
    return [...map.entries()];
  };

  return (
    <Show when={props.visible}>
      <box
        flexDirection="column"
        border={["top"]}
        borderColor={theme.colors.border}
        paddingLeft={2}
        paddingRight={2}
        gap={0}
      >
        <For each={grouped()}>
          {([group, bindings]) => (
            <box flexDirection="row" flexWrap="wrap" gap={1}>
              <text fg={theme.colors.accent}>
                <b>{`${group}:`}</b>
              </text>
              <For each={bindings}>
                {(b, i) => (
                  <box flexDirection="row" gap={0}>
                    <text fg={theme.colors.primary}>{b.key}</text>
                    <text fg={theme.colors.muted}>{` ${b.description}`}</text>
                    <Show when={i() < bindings.length - 1}>
                      <text fg={theme.colors.muted}>{" · "}</text>
                    </Show>
                  </box>
                )}
              </For>
            </box>
          )}
        </For>
        <text fg={theme.colors.muted}>{"按 Esc 关闭 · 8 秒后自动隐藏"}</text>
      </box>
    </Show>
  );
}

export function createWhichKeyControls() {
  const [visible, setVisible] = createSignal(false);
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const show = () => {
    setVisible(true);
    if (hideTimer) {
      clearTimeout(hideTimer);
    }
    hideTimer = setTimeout(() => setVisible(false), 8000);
  };

  const hide = () => {
    setVisible(false);
    if (hideTimer) {
      clearTimeout(hideTimer);
    }
  };

  const toggle = () => {
    if (visible()) {
      hide();
    } else {
      show();
    }
  };

  return { hide, show, toggle, visible };
}
