/**
 * 首页
 *
 * 职责:
 *   - 展示品牌标志和欢迎界面
 *   - 提供 Prompt 输入框
 *   - 处理用户输入并导航到 Session
 *
 * 模块功能:
 *   - 显示 Logo 和品牌标识
 *   - Prompt 输入框(支持占位符提示)
 *   - 快捷命令提示(/mcp、/agents、/plan 等)
 *   - 创建新会话并自动导航
 *   - 斜杠命令处理
 *
 * 使用场景:
 *   - 应用启动时的欢迎界面
 *   - 创建新对话的入口
 *
 * 边界:
 *   1. 输入后自动创建会话并跳转
 *   2. 斜杠命令在首页直接执行
 *   3. 普通消息发送到新会话
 *
 * 流程:
 *   1. 显示欢迎界面和输入框
 *   2. 用户输入内容
 *   3. 斜杠命令直接执行
 *   4. 普通消息创建会话并跳转
 */
import { For, Show, createMemo } from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
import { useRoute } from "@/ui/contexts/route";
import { usePromptRef } from "@/ui/contexts/prompt";
import { useConfig } from "@/ui/contexts/config";
import { useTheme } from "@/ui/contexts/theme";
import { useKV } from "@/ui/contexts/kv";
import { Logo } from "@/ui/components/logo";
import { Prompt } from "@/ui/components/prompt";
import { Slot } from "@/ui/plugins/slots";
import { getCommandRegistry } from "@/commandPalette/registry";
import { useEventBus } from "@/ui/contexts/eventBus";
import { AppEvent } from "@bus";
import { createId } from "@/core/identity";
import { ensureSession } from "@session";
import path from "node:path";

/** 输入框占位提示列表:首次使用侧重引导，后续侧重效率 */
const PLACEHOLDERS_FIRST = ["我该如何开始使用这个项目？", "crab-cli 的主要功能有哪些？", "显示可用的快捷键"];
const PLACEHOLDERS_RETURN = ["修复代码库中的一个 TODO", "这个项目的技术栈是什么？", "修复失败的测试"];

const FIRST_VISIT_KEY = "crab:first_visit";

/** 快捷键提示项 */
const HOME_TIPS = [
  { key: "ctrl+p", label: "命令" },
  { key: "ctrl+x", label: "快捷入口" },
  { key: "/agents", label: "代理" },
  { key: "/models", label: "模型" },
  { key: "/mcp", label: "mcp" },
];

export function getWorkspaceLabel(cwd = process.cwd()): { name: string; path: string } {
  return {
    name: path.basename(cwd) || cwd,
    path: cwd,
  };
}

export function Home() {
  const eventBus = useEventBus();
  const route = useRoute();
  const promptRefCtx = usePromptRef();
  const { config } = useConfig();
  const theme = useTheme();
  const kv = useKV();
  const c = theme.colors;
  const dimensions = useTerminalDimensions();
  const workspace = createMemo(() => getWorkspaceLabel());
  const promptMaxWidth = createMemo(() => Math.max(75, Math.floor(dimensions().width * 0.7)));
  const isFirstVisit = createMemo(() => !kv.get(FIRST_VISIT_KEY));
  const hasApiKey = createMemo(() => {
    const providerId = config.defaultProvider.provider;
    const provider = config.providerConfig?.[providerId];
    return Boolean(provider?.apiKey) || Boolean(provider?.baseURL);
  });

  /** 创建新会话并导航 */
  function createAndNavigate(initialMessage?: string) {
    if (isFirstVisit()) {
      kv.set(FIRST_VISIT_KEY, "1");
    }
    const sessionId = createId("ses");
    ensureSession(sessionId, {
      model: config.defaultProvider.model,
      projectDir: process.cwd(),
    });
    eventBus.publish(AppEvent.SessionCreated, { sessionId });
    route.navigate({ sessionId, type: "session" });
    // 如果有初始消息，延迟发送(等 Session 组件挂载)
    if (initialMessage) {
      queueMicrotask(() => {
        eventBus.publish(AppEvent.HomePromptSubmit, { message: initialMessage, sessionId });
      });
    }
  }

  /** 处理 Prompt 提交 */
  function handleSubmit(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    // `/` 开头 → 斜杠命令
    if (trimmed.startsWith("/")) {
      const fullText = trimmed.slice(1);
      const firstSpace = fullText.indexOf(" ");
      const slashCmd = firstSpace !== -1 ? fullText.slice(0, firstSpace) : fullText;
      const slashArgs = firstSpace !== -1 ? fullText.slice(firstSpace + 1) : "";
      if (!slashCmd) {
        return;
      }

      const registry = getCommandRegistry();
      registry.executeSlash(slashCmd, slashArgs).then((found) => {
        if (!found) {
          eventBus.publish(AppEvent.Toast, {
            message: `未知命令: /${slashCmd}`,
            variant: "warning",
          });
        }
      });
      return;
    }

    // 普通消息 → 创建会话
    createAndNavigate(trimmed);
  }

  return (
    <>
      <box flexDirection="column" alignItems="center" flexGrow={1} paddingLeft={2} paddingRight={2}>
        <box flexGrow={1} minHeight={0} />
        <box height={4} minHeight={0} flexShrink={1} />
        <box flexShrink={0}>
          <Slot name="home_logo">
            <Logo />
          </Slot>
        </box>
        <box height={1} minHeight={0} flexShrink={1} />
        <box flexDirection="column" alignItems="center" flexShrink={0}>
          <text fg={c.muted}>终端内的 AI 编程助手 — 输入问题或 /命令 开始</text>
        </box>
        <Show when={isFirstVisit() && !hasApiKey()}>
          <box flexDirection="column" alignItems="center" gap={0} flexShrink={0}>
            <text fg={c.warning}>首次使用？请先完成以下配置:</text>
            <text fg={c.accent}>{"1. 配置 API Key: 打开设置 (S) → 选择 Provider → 填入 API Key"}</text>
            <text fg={c.accent}>{"2. 选择模型: /models 切换 AI 模型"}</text>
            <text fg={c.accent}>{"3. 开始对话: 输入问题或按 Enter 开始"}</text>
          </box>
        </Show>
        <Show when={isFirstVisit() && hasApiKey()}>
          <box flexDirection="column" alignItems="center" gap={0} flexShrink={0}>
            <text fg={c.muted}>欢迎使用 Crab CLI！输入问题开始对话，或按 ? 查看帮助</text>
          </box>
        </Show>
        <box flexDirection="column" alignItems="center" gap={0} flexShrink={0}>
          <text fg={c.muted}>工作区</text>
          <text fg={c.text}>{workspace().name}</text>
          <text fg={c.muted}>{workspace().path}</text>
        </box>
        <Show when={!hasApiKey()}>
          <text fg={c.warning}>{"⚠ 未配置 API Key — 输入 /settings 配置"}</text>
        </Show>
        <box width="100%" maxWidth={promptMaxWidth()} zIndex={1000} paddingTop={1} flexShrink={0}>
          <Slot name="home_prompt">
            <Prompt
              ref={(r) => {
                promptRefCtx.set(r);
              }}
              placeholders={isFirstVisit() ? PLACEHOLDERS_FIRST : PLACEHOLDERS_RETURN}
              right={
                <Slot name="home_prompt_right">
                  <text fg={c.muted}>{config.defaultProvider.model}</text>
                </Slot>
              }
              onSubmit={handleSubmit}
            />
          </Slot>
        </box>
        <Slot name="home_bottom">
          <box flexDirection="row" gap={2} flexShrink={0} paddingTop={1}>
            <For each={HOME_TIPS}>
              {(item) => (
                <text fg={c.muted}>
                  {item.key}
                  <span style={{ fg: c.primary }}> </span>
                  <span style={{ fg: c.text }}>{item.label}</span>
                </text>
              )}
            </For>
          </box>
        </Slot>
        <box flexGrow={1} minHeight={0} />
      </box>
      <box width="100%" flexShrink={0} justifyContent="center" paddingBottom={1}>
        <Slot name="home_footer">
          <text fg={c.muted}>Enter 开始会话 · Ctrl+P 命令面板 · Ctrl+X 快捷入口</text>
        </Slot>
      </box>
    </>
  );
}
