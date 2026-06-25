/**
 * ModelsPanel 组件
 *
 * 职责:
 *   - 提供模型选择面板，支持查看、搜索、切换 AI 模型
 *   - 支持配置高级模型、基础模型和思考模式
 *
 * 模块功能:
 *   - 三 Tab 界面:高级模型、基础模型、思考设置
 *   - 模型列表搜索过滤功能
 *   - 支持手动输入模型名称
 *   - 思考模式启用/禁用切换
 *   - 键盘导航:Tab 切换页、Enter 选择、M 手动输入
 *
 * 使用场景:
 *   - 用户需要切换使用的 AI 模型时
 *   - 需要配置不同场景使用的模型时
 *   - 需要启用/禁用思考模式时
 *
 * 边界:
 *   1. 模型列表从配置的 providers 中拉取
 *   2. 搜索支持模型名称、ID、提供商过滤
 *   3. 手动输入模式支持任意模型名称
 *   4. 配置变更自动保存
 *
 * 流程:
 *   1. 初始化时加载当前配置
 *   2. Tab 切换选择要配置的模型类型
 *   3. Enter 打开模型选择器，支持搜索
 *   4. M 键进入手动输入模式
 *   5. 选择或输入后自动保存配置
 */

import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "@/ui/contexts/theme";
import { getDefaultModel, listProviders } from "@config";
import { loadConfig, saveConfig } from "@config";
import { createLogger } from "@/core/logging/logger";
import { actionEdit, actionSelect, iconError, iconSuccess } from "@/ui/utils/icon";
import { checkboxIcon } from "@/core/icons/iconDerived";

const log = createLogger("ui:models-panel");

// ─── 类型 ──────────────────────────────────────────────────

type Tab = "advanced" | "basic" | "thinking";

interface ModelOption {
  label: string;
  value: string;
  provider?: string;
}

// ─── 工具函数 ──────────────────────────────────────────────

function getAllAvailableModels(): ModelOption[] {
  const providers = listProviders();
  const models: ModelOption[] = [];
  for (const provider of providers) {
    for (const modelId of provider.models) {
      models.push({ label: modelId, provider: provider.name, value: modelId });
    }
  }
  return models;
}

function filterModels(models: ModelOption[], query: string): ModelOption[] {
  if (!query.trim()) {
    return models;
  }
  const q = query.toLowerCase();
  return models.filter(
    (m) =>
      m.label.toLowerCase().includes(q) ||
      m.value.toLowerCase().includes(q) ||
      (m.provider && m.provider.toLowerCase().includes(q)),
  );
}

// ─── ModelsPanel ───────────────────────────────────────────

export interface ModelsPanelProps {
  visible: boolean;
  onClose: () => void;
}

export function ModelsPanel(props: ModelsPanelProps) {
  const theme = useTheme();

  const [activeTab, setActiveTab] = createSignal<Tab>("advanced");
  const isModelTab = createMemo(() => activeTab() === "advanced" || activeTab() === "basic");

  const [localAdvancedModel, setLocalAdvancedModel] = createSignal("");
  const [localBasicModel, setLocalBasicModel] = createSignal("");
  const [currentProvider, setCurrentProvider] = createSignal("");

  const allModels = createMemo(getAllAvailableModels);
  const [searchTerm, setSearchTerm] = createSignal("");
  const [isSelecting, setIsSelecting] = createSignal(false);
  const [manualInputMode, setManualInputMode] = createSignal(false);
  const [manualInputValue, setManualInputValue] = createSignal("");
  const [highlightedIndex, setHighlightedIndex] = createSignal(0);
  const [errorMessage, setErrorMessage] = createSignal("");

  const [thinkingEnabled, setThinkingEnabled] = createSignal(false);
  const [thinkingFocusIndex, setThinkingFocusIndex] = createSignal(0);

  const filteredModels = createMemo(() => filterModels(allModels(), searchTerm()));

  const currentOptions = createMemo(() => {
    const seen = new Set<string>();
    const unique = filteredModels().filter((m) => {
      if (seen.has(m.value)) {
        return false;
      }
      seen.add(m.value);
      return true;
    });
    return [{ label: `${actionEdit} 手动输入模型名称`, value: "__MANUAL_INPUT__" }, ...unique];
  });

  const currentModel = createMemo(() =>
    activeTab() === "advanced" ? localAdvancedModel() : activeTab() === "basic" ? localBasicModel() : "",
  );
  const currentLabel = createMemo(() =>
    activeTab() === "advanced" ? "高级模型" : activeTab() === "basic" ? "基础模型" : "思考设置",
  );

  // ─── 初始化 ────────────────────────────────────────────

  createEffect(() => {
    if (!props.visible) {
      return;
    }
    setActiveTab("advanced");
    setIsSelecting(false);
    setSearchTerm("");
    setManualInputMode(false);
    setManualInputValue("");
    setHighlightedIndex(0);
    setThinkingFocusIndex(0);
    setErrorMessage("");
    void loadConfig()
      .then((cfg: any) => {
        setLocalAdvancedModel(cfg.advancedModel || getDefaultModel("anthropic"));
        setLocalBasicModel(cfg.basicModel || getDefaultModel("openai"));
        setCurrentProvider(cfg.provider || "anthropic");
        setThinkingEnabled(cfg.thinking?.enabled ?? false);
      })
      .catch(() => log.warn("加载模型配置失败"));
  });

  // ─── 应用模型 ──────────────────────────────────────────

  async function applyModel(value: string, target: "advanced" | "basic") {
    setErrorMessage("");
    try {
      if (target === "advanced") {
        await saveConfig({ advancedModel: value });
        setLocalAdvancedModel(value);
      } else {
        await saveConfig({ basicModel: value });
        setLocalBasicModel(value);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "保存失败");
    }
  }

  // ─── 键盘处理 ──────────────────────────────────────────

  useKeyboard((event) => {
    if (!props.visible) {
      return;
    }

    if (event.name === "escape") {
      if (manualInputMode()) {
        setManualInputMode(false);
        setManualInputValue("");
        setSearchTerm("");
        return;
      }
      if (isSelecting()) {
        setIsSelecting(false);
        setSearchTerm("");
        return;
      }
      props.onClose();
      return;
    }

    // 手动输入
    if (manualInputMode()) {
      if (event.name === "return" || event.name === "enter") {
        const cleaned = manualInputValue().trim();
        if (cleaned && isModelTab()) {
          void applyModel(cleaned, activeTab() as "advanced" | "basic");
        }
        setManualInputMode(false);
        setManualInputValue("");
        setSearchTerm("");
        return;
      }
      if (event.name === "backspace") {
        setManualInputValue((v) => v.slice(0, -1));
        return;
      }
      if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
        setManualInputValue((v) => v + event.name);
        return;
      }
      return;
    }

    // 模型选择过滤
    if (isSelecting()) {
      if (event.name === "return" || event.name === "enter") {
        const opts = currentOptions();
        const selected = opts[highlightedIndex()];
        if (selected) {
          if (selected.value === "__MANUAL_INPUT__") {
            setIsSelecting(false);
            setSearchTerm("");
            setManualInputMode(true);
            setManualInputValue(currentModel());
            return;
          }
          if (isModelTab()) {
            void applyModel(selected.value, activeTab() as "advanced" | "basic");
          }
          setIsSelecting(false);
          setSearchTerm("");
        }
        return;
      }
      if (event.name === "up") {
        setHighlightedIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (event.name === "down") {
        setHighlightedIndex((i) => Math.min(currentOptions().length - 1, i + 1));
        return;
      }
      if (event.name === "backspace") {
        setSearchTerm((t) => t.slice(0, -1));
        setHighlightedIndex(0);
        return;
      }
      if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
        setSearchTerm((t) => t + event.name);
        setHighlightedIndex(0);
        return;
      }
      return;
    }

    // Tab 切换
    if (event.name === "tab") {
      setActiveTab((t) => (t === "advanced" ? "basic" : t === "basic" ? "thinking" : "advanced"));
      return;
    }

    // 思考设置页
    if (activeTab() === "thinking") {
      if (event.name === "up") {
        setThinkingFocusIndex((i) => (i === 0 ? 2 : i - 1));
        return;
      }
      if (event.name === "down") {
        setThinkingFocusIndex((i) => (i === 2 ? 0 : i + 1));
        return;
      }
      if (event.name === "return" || event.name === "enter") {
        if (thinkingFocusIndex() === 0) {
          setThinkingEnabled((e) => !e);
          void saveConfig({ thinking: { enabled: !thinkingEnabled() } });
        }
        return;
      }
      return;
    }

    // Enter → 打开选择器
    if (event.name === "return" || event.name === "enter") {
      setIsSelecting(true);
      setHighlightedIndex(0);
      return;
    }

    // M → 手动输入
    if (event.name === "m" && isModelTab()) {
      setManualInputMode(true);
      setManualInputValue(currentModel());
    }
  });

  if (!props.visible) {
    return null;
  }

  // ─── 渲染 ──────────────────────────────────────────────

  const tabBg = (tab: Tab) => (activeTab() === tab ? theme.colors.primary : undefined);

  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} gap={1}>
      {/* 标题栏 */}
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.colors.text}>
          <b>{"模型选择"}</b>
        </text>
        <text fg={theme.colors.muted}>{"esc 关闭"}</text>
      </box>

      {/* Tab 栏 */}
      <box flexDirection="row" gap={0}>
        <text
          fg={activeTab() === "advanced" ? theme.colors.text : theme.colors.muted}
          backgroundColor={tabBg("advanced")}
          {...({} as any)}
        >
          {" 高级模型 "}
        </text>
        <text
          fg={activeTab() === "basic" ? theme.colors.text : theme.colors.muted}
          backgroundColor={tabBg("basic")}
          {...({} as any)}
        >
          {" 基础模型 "}
        </text>
        <text
          fg={activeTab() === "thinking" ? theme.colors.text : theme.colors.muted}
          backgroundColor={tabBg("thinking")}
          {...({} as any)}
        >
          {" 思考设置 "}
        </text>
      </box>

      {/* 错误 */}
      <Show when={errorMessage()}>
        <text fg={theme.colors.error}>{`${iconError} ${errorMessage()}`}</text>
      </Show>

      {/* 思考设置 */}
      <Show when={activeTab() === "thinking" && !manualInputMode() && !isSelecting()}>
        <box flexDirection="column" gap={1}>
          <text fg={theme.colors.info}>
            {"当前提供商: "}
            <span style={{ fg: theme.colors.accent }}>{currentProvider()}</span>
          </text>
          <text fg={thinkingFocusIndex() === 0 ? theme.colors.accent : theme.colors.text}>
            {thinkingFocusIndex() === 0 ? `${actionSelect} ` : "  "}
            {"启用思考模式"}
            <span
              style={{ fg: theme.colors.accent }}
            >{` ${thinkingEnabled() ? `[${checkboxIcon(true)}]` : checkboxIcon(false)}`}</span>
          </text>
          <text fg={theme.colors.muted}>{"↑↓ 切换 · Enter 切换值 · Tab 切换页"}</text>
        </box>
      </Show>

      {/* 手动输入 */}
      <Show when={manualInputMode()}>
        <box flexDirection="column" gap={1}>
          <text fg={theme.colors.info}>{`手动输入 ${currentLabel()} 名称:`}</text>
          <text fg={theme.colors.accent}>{`${actionSelect} ${manualInputValue()}_`}</text>
          <text fg={theme.colors.muted}>{"Enter 确认 · Esc 取消"}</text>
        </box>
      </Show>

      {/* 模型列表 */}
      <Show when={isSelecting()}>
        <box flexDirection="column" gap={1}>
          <text fg={theme.colors.text}>
            <Show when={searchTerm()}>
              <span style={{ fg: theme.colors.info }}>{`过滤: ${searchTerm()}  `}</span>
            </Show>
            <b>{`共 ${currentOptions().length - 1} 个模型`}</b>
          </text>
          <For each={currentOptions().slice(0, 8)}>
            {(option, index) => {
              const isHighlighted = () => index() === highlightedIndex();
              return (
                <text
                  fg={isHighlighted() ? theme.colors.text : theme.colors.muted}
                  backgroundColor={isHighlighted() ? theme.colors.primary : undefined}
                  {...({} as any)}
                >
                  {isHighlighted() ? `${actionSelect} ` : "  "}
                  {option.label}
                </text>
              );
            }}
          </For>
          <Show when={currentOptions().length > 8}>
            <text fg={theme.colors.muted}>{"↑↓ 滚动 · Enter 选择 · Esc 取消"}</text>
          </Show>
        </box>
      </Show>

      {/* 默认视图 */}
      <Show when={activeTab() !== "thinking" && !manualInputMode() && !isSelecting()}>
        <box flexDirection="column" gap={1}>
          <text fg={theme.colors.info}>
            {"当前模型: "}
            <span style={{ fg: theme.colors.accent }}>{currentModel() || "未设置"}</span>
          </text>
          <text fg={theme.colors.muted}>{"Enter 选择模型 · M 手动输入 · Tab 切换页"}</text>
        </box>
      </Show>
    </box>
  );
}
