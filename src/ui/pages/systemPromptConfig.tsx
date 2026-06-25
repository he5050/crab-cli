/**
 * 系统提示词配置页面
 *
 * 职责:
 *   - 查看和编辑系统提示词
 *   - 管理预设提示词模板
 *   - 保存配置到全局配置
 *
 * 模块功能:
 *   - 主菜单:查看/编辑/模板选择/重置
 *   - 预设模板:默认、代码审查、技术写作、架构设计、调试助手
 *   - 多行文本编辑支持
 *   - 实时预览当前提示词
 *
 * 使用场景:
 *   - 需要自定义 AI 系统提示词时
 *   - 切换不同场景的专业提示词模板
 *
 * 边界:
 *   1. 仅修改全局配置(~/.crab/config.json)
 *   2. 不验证提示词内容有效性
 *   3. 编辑模式使用简单文本输入
 *
 * 流程:
 *   1. 加载当前系统提示词
 *   2. 显示主菜单选项
 *   3. 根据选择进入预览/编辑/模板列表
 *   4. 保存修改到配置文件
 */

import { For, Show, createMemo, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "@/ui/contexts/theme";
import { loadConfig, saveConfig } from "@config";

// ─── 预设模板 ──────────────────────────────────────────────

interface PromptTemplate {
  name: string;
  description: string;
  content: string;
}

const PRESET_TEMPLATES: PromptTemplate[] = [
  {
    content: "你是 crab-cli 的 AI 助手，帮助用户完成编程任务。请用中文回复。",
    description: "Crab CLI 默认系统提示词",
    name: "默认",
  },
  {
    content: "你是一位资深代码审查专家。请仔细审查用户提交的代码，提供改进建议、潜在bug 和最佳实践建议。用中文回复。",
    description: "专注于代码审查和优化建议",
    name: "代码审查",
  },
  {
    content: "你是一位技术文档专家。帮助用户编写清晰、准确、结构良好的技术文档和 README。用中文回复。",
    description: "专注于技术文档编写",
    name: "技术写作",
  },
  {
    content: "你是一位系统架构师。帮助用户进行技术选型、架构设计和系统规划。提供权衡分析和决策建议。用中文回复。",
    description: "专注于系统架构设计",
    name: "架构设计",
  },
  {
    content:
      "你是一位调试专家。帮助用户分析错误信息、定位问题根因、提供修复方案。重点关注日志分析、堆栈追踪和常见陷阱。用中文回复。",
    description: "专注于问题诊断和调试",
    name: "调试助手",
  },
];

// ─── 页面层级 ──────────────────────────────────────────────

type Screen = "main" | "template-list" | "edit" | "preview";

// ─── Props ─────────────────────────────────────────────────

export interface SystemPromptConfigProps {
  onClose: () => void;
}

// ─── SystemPromptConfigPage 组件 ────────────────────────────

export function SystemPromptConfigPage(props: SystemPromptConfigProps) {
  const theme = useTheme();

  // 页面状态
  const [screen, setScreen] = createSignal<Screen>("main");
  const [focusIndex, setFocusIndex] = createSignal(0);
  const [errorMessage, setErrorMessage] = createSignal("");

  // 当前系统提示词
  const [currentPrompt, setCurrentPrompt] = createSignal("");
  const [editValue, setEditValue] = createSignal("");

  // 初始化加载
  const loadCurrentPrompt = async () => {
    try {
      const cfg: any = await loadConfig();
      setCurrentPrompt(cfg.systemPrompt || "");
    } catch {
      // 使用默认
    }
  };
  loadCurrentPrompt();

  // 主菜单选项
  const mainOptions = () => [
    { label: "查看当前提示词", value: "preview" },
    { label: "编辑提示词", value: "edit" },
    { label: "从模板选择", value: "templates" },
    { label: "重置为默认", value: "reset" },
    { label: "← 返回", value: "back" },
  ];

  // 模板列表选项
  const templateOptions = () =>
    PRESET_TEMPLATES.map((t) => ({
      content: t.content,
      label: `${t.name} — ${t.description}`,
      value: t.name,
    })).concat([{ content: "", label: "← 返回", value: "back" }]);

  // 当前选项
  const currentOptions = createMemo(() => {
    switch (screen()) {
      case "main": {
        return mainOptions();
      }
      case "template-list": {
        return templateOptions();
      }
      default: {
        return [];
      }
    }
  });

  // 页面标题
  const pageTitle = createMemo(() => {
    switch (screen()) {
      case "main": {
        return "系统提示词配置";
      }
      case "template-list": {
        return "选择模板";
      }
      case "edit": {
        return "编辑提示词";
      }
      case "preview": {
        return "当前提示词预览";
      }
      default: {
        return "";
      }
    }
  });

  // ─── 保存提示词 ────────────────────────────────────────

  async function savePrompt(prompt: string) {
    try {
      await saveConfig({ systemPrompt: prompt });
      setCurrentPrompt(prompt);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "保存失败");
    }
  }

  // ─── 键盘处理 ────────────────────────────────────────

  useKeyboard((event) => {
    // 编辑模式
    if (screen() === "edit") {
      if (event.name === "escape") {
        // Ctrl+S 式保存: Esc 保存并返回
        savePrompt(editValue());
        setScreen("main");
        setFocusIndex(0);
      } else if (event.ctrl && event.name === "s") {
        savePrompt(editValue());
        setScreen("main");
        setFocusIndex(0);
      } else if (event.name === "backspace") {
        setEditValue((v) => v.slice(0, -1));
      } else if (event.name === "return" || event.name === "enter") {
        setEditValue((v) => `${v}\n`);
      } else if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
        setEditValue((v) => v + event.name);
      }
      return;
    }

    // 预览模式
    if (screen() === "preview") {
      if (event.name === "escape" || event.name === "return" || event.name === "enter") {
        setScreen("main");
        setFocusIndex(0);
      }
      return;
    }

    // Escape
    if (event.name === "escape") {
      if (screen() === "template-list") {
        setScreen("main");
        setFocusIndex(0);
      } else {
        props.onClose();
      }
      return;
    }

    // 导航
    if (event.name === "up") {
      setFocusIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (event.name === "down") {
      setFocusIndex((i) => Math.min(currentOptions().length - 1, i + 1));
      return;
    }

    // Enter
    if (event.name === "return" || event.name === "enter") {
      const idx = focusIndex();

      if (screen() === "main") {
        const opt = mainOptions()[idx];
        if (!opt) {
          return;
        }
        switch (opt.value) {
          case "preview": {
            setScreen("preview");
            break;
          }
          case "edit": {
            setEditValue(currentPrompt());
            setScreen("edit");
            break;
          }
          case "templates": {
            setScreen("template-list");
            setFocusIndex(0);
            break;
          }
          case "reset": {
            savePrompt(PRESET_TEMPLATES[0]!.content);
            break;
          }
          case "back": {
            props.onClose();
            break;
          }
        }
      } else if (screen() === "template-list") {
        const opt = templateOptions()[idx];
        if (!opt) {
          return;
        }
        if (opt.value === "back") {
          setScreen("main");
          setFocusIndex(0);
        } else {
          savePrompt(opt.content);
          setScreen("main");
          setFocusIndex(0);
        }
      }
    }
  });

  // ─── 渲染 ────────────────────────────────────────────

  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1}>
      {/* 标题 */}
      <box marginBottom={1}>
        <span style={{ fg: theme.colors.warning, "font-weight": "bold" }}>{"系统提示词"}</span>
        <text fg={theme.colors.muted}>{` — ${pageTitle()}`}</text>
      </box>

      {/* 错误 */}
      <Show when={errorMessage()}>
        <box marginBottom={1}>
          <text fg={theme.colors.error}>{`✗ ${errorMessage()}`}</text>
        </box>
      </Show>

      {/* 编辑模式 */}
      <Show when={screen() === "edit"}>
        <box flexDirection="column" paddingLeft={1}>
          <text fg={theme.colors.info}>{"编辑系统提示词(多行输入):"}</text>
          <box flexDirection="column" paddingLeft={1} marginTop={1}>
            <For each={editValue().split("\n")}>{(line) => <text fg={theme.colors.text}>{line || " "}</text>}</For>
            <text fg={theme.colors.accent}>{"_"}</text>
          </box>
          <box marginTop={1}>
            <text fg={theme.colors.muted}>{"Esc 保存并返回 · Enter 换行 · Backspace 删除"}</text>
          </box>
        </box>
      </Show>

      {/* 预览模式 */}
      <Show when={screen() === "preview"}>
        <box flexDirection="column" paddingLeft={1}>
          <text fg={theme.colors.info}>{"当前系统提示词:"}</text>
          <box flexDirection="column" paddingLeft={1} marginTop={1}>
            <For each={currentPrompt().split("\n")}>{(line) => <text fg={theme.colors.text}>{line || " "}</text>}</For>
          </box>
          <Show when={!currentPrompt()}>
            <text fg={theme.colors.muted}>{"(未设置自定义提示词)"}</text>
          </Show>
          <box marginTop={1}>
            <text fg={theme.colors.muted}>{"按任意键返回"}</text>
          </box>
        </box>
      </Show>

      {/* 列表模式 */}
      <Show when={screen() === "main" || screen() === "template-list"}>
        <box flexDirection="column" paddingLeft={1}>
          <For each={currentOptions()}>
            {(option, index) => {
              const isSelected = () => index() === focusIndex();
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

        <box marginTop={1}>
          <text fg={theme.colors.muted}>{"↑↓ 导航 · Enter 选择 · Esc 返回"}</text>
        </box>
      </Show>
    </box>
  );
}
