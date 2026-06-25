/**
 * Hook 配置页面
 *
 * 职责:
 *   - 查看和管理 Hook 事件规则
 *   - 支持多级页面导航
 *   - 配置命令和提示词动作
 *
 * 模块功能:
 *   - 作用域选择:全局 Hook / 项目 Hook
 *   - Hook 列表:显示所有可配置事件
 *   - Hook 详情:查看规则列表
 *   - 规则编辑:描述、匹配器、动作列表
 *   - 动作编辑:类型、命令/提示词、超时、启用状态
 *   - 支持的事件:beforeToolCall、afterToolCall、onUserMessage 等
 *
 * 使用场景:
 *   - 自定义工具调用前后的行为
 *   - 配置事件触发的自动化命令
 *   - 设置会话生命周期钩子
 *
 * 边界:
 *   1. 支持 command 和 prompt 两种动作类型
 *   2. 工具类 Hook 支持匹配器过滤
 *   3. 配置按作用域隔离(全局/项目)
 *
 * 流程:
 *   1. 选择作用域(全局/项目)
 *   2. 选择要配置的 Hook 事件
 *   3. 添加/编辑规则
 *   4. 配置动作(命令或提示词)
 *   5. 保存配置
 */

import { For, Show, createMemo, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "@/ui/contexts/theme";
import { checkboxIcon } from "@/core/icons/iconDerived";
import {
  type HookAction,
  type HookActionType,
  type HookRule,
  type HookScope,
  deleteHookConfig,
  getAllConfigKeys,
  listConfiguredHooks,
  loadHookConfig,
  saveHookConfig,
} from "@config";

// ─── 页面层级 ──────────────────────────────────────────────

type Screen = "scope-select" | "hook-list" | "hook-detail" | "rule-edit" | "action-edit";

type RuleField = "description" | "matcher";
type ActionField = "enabled" | "type" | "command" | "prompt" | "timeout";

// ─── Hook 描述映射 ─────────────────────────────────────────

const HOOK_DESCRIPTIONS: Record<string, string> = {
  afterToolCall: "工具调用后触发(可处理结果)",
  beforeCompress: "上下文压缩前触发",
  beforeToolCall: "工具调用前触发(可拦截或修改参数)",
  onNotification: "通知发送时触发",
  onSessionEnd: "会话结束时触发",
  onSessionStart: "会话启动时触发",
  onSkillExecute: "Skill 执行时触发",
  onStop: "会话停止时触发(支持 prompt 动作)",
  onSubAgentComplete: "子代理完成时触发(支持 prompt 动作)",
  onSubAgentStart: "子代理启动时触发",
  onUserMessage: "用户消息发送时触发",
  toolConfirmation: "工具确认时触发(自定义确认逻辑)",
};

const TOOL_HOOK_KEYS = new Set(["beforeToolCall", "toolConfirmation", "afterToolCall"]);

// ─── Props ─────────────────────────────────────────────────

export interface HooksConfigProps {
  onClose: () => void;
}

// ─── HooksConfigPage 组件 ──────────────────────────────────

export function HooksConfigPage(props: HooksConfigProps) {
  const theme = useTheme();

  // 页面状态
  const [screen, setScreen] = createSignal<Screen>("scope-select");
  const [selectedScope, setSelectedScope] = createSignal<HookScope>("project");
  const [selectedHookKey, setSelectedHookKey] = createSignal<string | null>(null);
  const [selectedRuleIndex, setSelectedRuleIndex] = createSignal(-1);
  const [editingRule, setEditingRule] = createSignal<HookRule | null>(null);
  const [infoText, setInfoText] = createSignal("");

  // 规则编辑状态
  const [editingRuleField, setEditingRuleField] = createSignal<RuleField | null>(null);
  const [ruleFieldValue, setRuleFieldValue] = createSignal("");

  // Action 编辑状态
  const [selectedActionIndex, setSelectedActionIndex] = createSignal(-1);
  const [editingAction, setEditingAction] = createSignal<HookAction | null>(null);
  const [editingActionField, setEditingActionField] = createSignal<ActionField | null>(null);
  const [actionFieldValue, setActionFieldValue] = createSignal("");

  // 列表导航
  const [focusIndex, setFocusIndex] = createSignal(0);

  // 作用域选项
  const scopeOptions = () => [
    { info: "对所有项目生效", label: "全局 Hook (~/.crab/hooks/)", value: "global" as HookScope },
    { info: "仅对当前项目生效", label: "项目 Hook (.crab/hooks/)", value: "project" as HookScope },
    { info: "", label: "返回", value: "back" as const },
  ];

  // Hook 类型列表选项
  const hookListOptions = () => {
    const allKeys = getAllConfigKeys();
    const configured = listConfiguredHooks(selectedScope());

    return allKeys
      .map((key) => {
        const isConfigured = configured.includes(key);
        const rules = isConfigured ? loadHookConfig(key, selectedScope()) : [];
        const ruleCount = rules.length;
        const icon = isConfigured ? checkboxIcon(true) : checkboxIcon(false);

        return {
          configured: isConfigured,
          info: HOOK_DESCRIPTIONS[key] || key,
          label: `${icon} ${key}${ruleCount > 0 ? ` (${ruleCount} 条规则)` : ""}`,
          value: key,
        };
      })
      .concat([{ configured: false, info: "", label: "← 返回", value: "back" }]);
  };

  // Hook 详情选项
  const hookDetailOptions = () => {
    const hookKey = selectedHookKey();
    if (!hookKey) {
      return [];
    }

    const rules = loadHookConfig(hookKey, selectedScope());
    const isToolHook = TOOL_HOOK_KEYS.has(hookKey);

    const ruleItems = rules.map((rule, index) => ({
      info: `${rule.hooks.length} 个动作${isToolHook && rule.matcher ? ` | 匹配器: ${rule.matcher}` : ""}`,
      label: `规则 ${index + 1}: ${rule.description}`,
      value: `rule-${index}`,
    }));

    return [
      ...ruleItems,
      { info: "创建新的 Hook 规则", label: "+ 添加新规则", value: "add" },
      { info: "删除此事件的所有规则", label: "✗ 删除所有配置", value: "delete" },
      { info: "", label: "← 返回", value: "back" },
    ];
  };

  // 规则编辑选项
  const ruleEditOptions = () => {
    const rule = editingRule();
    const hookKey = selectedHookKey();
    if (!rule || !hookKey) {
      return [];
    }

    const isToolHook = TOOL_HOOK_KEYS.has(hookKey);
    const items: { label: string; value: string; info: string }[] = [
      { info: "点击编辑", label: `描述: ${rule.description}`, value: "edit-description" },
    ];

    if (isToolHook) {
      items.push({
        info: "仅匹配指定工具(逗号分隔，* 通配)",
        label: `匹配器: ${rule.matcher || "未设置"}`,
        value: "edit-matcher",
      });
    }

    rule.hooks.forEach((action, index) => {
      const enabled = action.enabled !== false;
      const icon = enabled ? checkboxIcon(true) : checkboxIcon(false);
      const actionLabel = action.type === "command" ? action.command || "" : action.prompt || "";
      items.push({
        info: action.timeout ? `超时: ${action.timeout}ms` : "无超时",
        label: `${icon} ${index + 1}. ${action.type}: ${actionLabel}`,
        value: `action-${index}`,
      });
    });

    items.push(
      { info: "添加新的 Hook 动作", label: "+ 添加动作", value: "add-action" },
      { info: "", label: "✗ 删除规则", value: "delete-rule" },
      { info: "", label: "✓ 保存规则", value: "save" },
      { info: "", label: "← 取消", value: "back" },
    );

    return items;
  };

  // Action 编辑选项
  const actionEditOptions = () => {
    const action = editingAction();
    if (!action) {
      return [];
    }

    const enabled = action.enabled !== false;
    const icon = enabled ? checkboxIcon(true) : checkboxIcon(false);

    return [
      { info: enabled ? "当前已启用" : "当前已禁用", label: `${icon} 启用`, value: "enabled" },
      { info: "command 或 prompt", label: `类型: ${action.type}`, value: "type" },
      ...(action.type === "command"
        ? [{ info: "Shell 命令", label: `命令: ${action.command || "未设置"}`, value: "command" }]
        : [{ info: "提示词模板", label: `提示词: ${action.prompt || "未设置"}`, value: "prompt" }]),
      { info: "毫秒", label: `超时: ${action.timeout || "未设置"}`, value: "timeout" },
      { info: "", label: "✗ 删除动作", value: "delete" },
      { info: "", label: "✓ 保存动作", value: "save" },
      { info: "", label: "← 取消", value: "back" },
    ];
  };

  // 当前选项列表
  const currentOptions = createMemo(() => {
    switch (screen()) {
      case "scope-select": {
        return scopeOptions();
      }
      case "hook-list": {
        return hookListOptions();
      }
      case "hook-detail": {
        return hookDetailOptions();
      }
      case "rule-edit": {
        return ruleEditOptions();
      }
      case "action-edit": {
        return actionEditOptions();
      }
      default: {
        return [];
      }
    }
  });

  // 页面标题
  const pageTitle = createMemo(() => {
    switch (screen()) {
      case "scope-select": {
        return "Hook 配置";
      }
      case "hook-list": {
        return `Hook 列表 — ${selectedScope() === "global" ? "全局" : "项目"}`;
      }
      case "hook-detail": {
        return selectedHookKey() || "";
      }
      case "rule-edit": {
        return "编辑规则";
      }
      case "action-edit": {
        return "编辑动作";
      }
      default: {
        return "";
      }
    }
  });

  // ─── 返回上一级 ──────────────────────────────────────

  function handleBack() {
    switch (screen()) {
      case "scope-select": {
        props.onClose();
        break;
      }
      case "hook-list": {
        setScreen("scope-select");
        setFocusIndex(0);
        break;
      }
      case "hook-detail": {
        setScreen("hook-list");
        setSelectedHookKey(null);
        setFocusIndex(0);
        break;
      }
      case "rule-edit": {
        setScreen("hook-detail");
        setEditingRule(null);
        setSelectedRuleIndex(-1);
        setEditingRuleField(null);
        setFocusIndex(0);
        break;
      }
      case "action-edit": {
        setScreen("rule-edit");
        setEditingAction(null);
        setSelectedActionIndex(-1);
        setEditingActionField(null);
        setFocusIndex(0);
        break;
      }
    }
  }

  // ─── 选项选择处理 ──────────────────────────────────────

  function handleSelect(value: string) {
    switch (screen()) {
      case "scope-select": {
        if (value === "back") {
          props.onClose();
        } else {
          setSelectedScope(value as HookScope);
          setScreen("hook-list");
          setFocusIndex(0);
        }
        break;
      }
      case "hook-list": {
        if (value === "back") {
          handleBack();
        } else {
          setSelectedHookKey(value);
          setScreen("hook-detail");
          setFocusIndex(0);
        }
        break;
      }
      case "hook-detail": {
        if (value === "back") {
          handleBack();
        } else if (value === "add") {
          setEditingRule({ description: "新规则", hooks: [] });
          setSelectedRuleIndex(-1);
          setScreen("rule-edit");
          setFocusIndex(0);
        } else if (value === "delete") {
          const hookKey = selectedHookKey();
          if (hookKey) {
            deleteHookConfig(hookKey, selectedScope());
          }
          handleBack();
        } else if (value.startsWith("rule-")) {
          const index = parseInt(value.replace("rule-", ""));
          const hookKey = selectedHookKey();
          if (hookKey) {
            const rules = loadHookConfig(hookKey, selectedScope());
            setSelectedRuleIndex(index);
            setEditingRule({ ...rules[index]! });
            setScreen("rule-edit");
            setFocusIndex(0);
          }
        }
        break;
      }
      case "rule-edit": {
        if (value === "back") {
          handleBack();
        } else if (value === "save") {
          const hookKey = selectedHookKey();
          const rule = editingRule();
          if (hookKey && rule) {
            const rules = loadHookConfig(hookKey, selectedScope());
            const idx = selectedRuleIndex();
            if (idx >= 0) {
              rules[idx] = rule;
            } else {
              rules.push(rule);
            }
            saveHookConfig(hookKey, selectedScope(), rules);
          }
          handleBack();
        } else if (value === "add-action") {
          const rule = editingRule();
          const hookKey = selectedHookKey();
          if (!rule || !hookKey) {
            break;
          }

          const hasPrompt = rule.hooks.some((h) => h.type === "prompt");
          if (hasPrompt) {
            break;
          }

          const defaultType: HookActionType =
            (hookKey === "onSubAgentComplete" || hookKey === "onStop") && rule.hooks.length === 0
              ? "prompt"
              : "command";

          const newAction: HookAction =
            defaultType === "prompt"
              ? { enabled: true, prompt: "下一步做什么？", timeout: 30_000, type: "prompt" }
              : { command: 'echo "Hello from hook"', enabled: true, timeout: 5000, type: "command" };

          setEditingRule({ ...rule, hooks: [...rule.hooks, newAction] });
        } else if (value === "delete-rule") {
          const hookKey = selectedHookKey();
          const idx = selectedRuleIndex();
          if (hookKey && idx >= 0) {
            const rules = loadHookConfig(hookKey, selectedScope());
            rules.splice(idx, 1);
            saveHookConfig(hookKey, selectedScope(), rules);
          }
          handleBack();
        } else if (value === "edit-description") {
          const rule = editingRule();
          if (rule) {
            setEditingRuleField("description");
            setRuleFieldValue(rule.description);
          }
        } else if (value === "edit-matcher") {
          const rule = editingRule();
          if (rule) {
            setEditingRuleField("matcher");
            setRuleFieldValue(rule.matcher || "");
          }
        } else if (value.startsWith("action-")) {
          const idx = parseInt(value.replace("action-", ""));
          const rule = editingRule();
          if (rule) {
            setSelectedActionIndex(idx);
            setEditingAction({ ...rule.hooks[idx]! });
            setScreen("action-edit");
            setFocusIndex(0);
          }
        }
        break;
      }
      case "action-edit": {
        if (value === "back") {
          handleBack();
        } else if (value === "save") {
          const action = editingAction();
          const rule = editingRule();
          if (action && rule) {
            const newHooks = [...rule.hooks];
            const idx = selectedActionIndex();
            if (idx >= 0) {
              newHooks[idx] = action;
            } else {
              newHooks.push(action);
            }
            setEditingRule({ ...rule, hooks: newHooks });
          }
          handleBack();
        } else if (value === "delete") {
          const rule = editingRule();
          if (rule) {
            const idx = selectedActionIndex();
            const newHooks = rule.hooks.filter((_, i) => i !== idx);
            setEditingRule({ ...rule, hooks: newHooks });
          }
          handleBack();
        } else if (value === "enabled") {
          const action = editingAction();
          if (action) {
            const enabled = action.enabled !== false;
            setEditingAction({ ...action, enabled: !enabled });
          }
        } else if (value === "type") {
          const action = editingAction();
          if (action) {
            const newType: HookActionType = action.type === "command" ? "prompt" : "command";
            setEditingAction({
              ...action,
              command: newType === "command" ? action.command : undefined,
              prompt: newType === "prompt" ? action.prompt : undefined,
              type: newType,
            });
          }
        } else if (value === "command") {
          const action = editingAction();
          if (action) {
            setEditingActionField("command");
            setActionFieldValue(action.command || "");
          }
        } else if (value === "prompt") {
          const action = editingAction();
          if (action) {
            setEditingActionField("prompt");
            setActionFieldValue(action.prompt || "");
          }
        } else if (value === "timeout") {
          const action = editingAction();
          if (action) {
            setEditingActionField("timeout");
            setActionFieldValue(action.timeout?.toString() || "");
          }
        }
        break;
      }
    }
  }

  // ─── 键盘处理 ────────────────────────────────────────

  useKeyboard((event) => {
    // 文本输入模式
    if (editingRuleField()) {
      if (event.name === "escape") {
        setEditingRuleField(null);
        setRuleFieldValue("");
      } else if (event.name === "return" || event.name === "enter") {
        const field = editingRuleField();
        const rule = editingRule();
        if (field && rule) {
          setEditingRule({ ...rule, [field]: ruleFieldValue() });
          setEditingRuleField(null);
          setRuleFieldValue("");
        }
      } else if (event.name === "backspace") {
        setRuleFieldValue((v) => v.slice(0, -1));
      } else if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
        setRuleFieldValue((v) => v + event.name);
      }
      return;
    }

    if (editingActionField() && editingActionField() !== "enabled" && editingActionField() !== "type") {
      if (event.name === "escape") {
        setEditingActionField(null);
        setActionFieldValue("");
      } else if (event.name === "return" || event.name === "enter") {
        const field = editingActionField();
        const action = editingAction();
        if (field && action) {
          const value =
            field === "timeout"
              ? actionFieldValue()
                ? parseInt(actionFieldValue())
                : undefined
              : actionFieldValue() || undefined;
          setEditingAction({ ...action, [field]: value });
          setEditingActionField(null);
          setActionFieldValue("");
        }
      } else if (event.name === "backspace") {
        setActionFieldValue((v) => v.slice(0, -1));
      } else if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
        setActionFieldValue((v) => v + event.name);
      }
      return;
    }

    // Escape
    if (event.name === "escape") {
      handleBack();
      return;
    }

    // 导航
    if (event.name === "up") {
      setFocusIndex((i) => Math.max(0, i - 1));
      const opts = currentOptions();
      const idx = focusIndex();
      if (opts[idx]) {
        setInfoText(opts[idx].info || "");
      }
      return;
    }
    if (event.name === "down") {
      setFocusIndex((i) => Math.min(currentOptions().length - 1, i + 1));
      const opts = currentOptions();
      const idx = focusIndex();
      if (opts[idx]) {
        setInfoText(opts[idx].info || "");
      }
      return;
    }

    // Enter 选择
    if (event.name === "return" || event.name === "enter") {
      const opts = currentOptions();
      const idx = focusIndex();
      const selected = opts[idx];
      if (selected) {
        handleSelect(selected.value);
        setFocusIndex(0);
      }
    }
  });

  // ─── 渲染 ────────────────────────────────────────────

  const isTextInput = () =>
    Boolean(editingRuleField()) ||
    (Boolean(editingActionField()) && editingActionField() !== "enabled" && editingActionField() !== "type");

  const textInputLabel = () => {
    if (editingRuleField()) {
      return editingRuleField() === "description" ? "编辑描述" : "编辑匹配器";
    }
    return `编辑 ${editingActionField()}`;
  };

  const textInputValue = () => (editingRuleField() ? ruleFieldValue() : actionFieldValue());

  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1}>
      {/* 标题 */}
      <box marginBottom={1}>
        <span style={{ fg: theme.colors.warning, "font-weight": "bold" }}>{"Hook 配置"}</span>
        <text fg={theme.colors.muted}>{` — ${pageTitle()}`}</text>
      </box>

      {/* 文本输入模式 */}
      <Show when={isTextInput()}>
        <box flexDirection="column" paddingLeft={1}>
          <text fg={theme.colors.info}>{textInputLabel()}</text>
          <Show when={editingRuleField() === "matcher"}>
            <text fg={theme.colors.muted}>{"匹配器: 工具名(逗号分隔，* 通配符)"}</text>
          </Show>
          <box paddingLeft={1} marginTop={1}>
            <text fg={theme.colors.accent}>{`❯ ${textInputValue()}_`}</text>
          </box>
          <box marginTop={1}>
            <text fg={theme.colors.muted}>{"Enter 保存 · Esc 取消"}</text>
          </box>
        </box>
      </Show>

      {/* 列表模式 */}
      <Show when={!isTextInput()}>
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

        {/* 提示信息 */}
        <Show when={infoText()}>
          <box marginTop={1} paddingLeft={1}>
            <text fg={theme.colors.info}>{`ℹ ${infoText()}`}</text>
          </box>
        </Show>

        {/* 导航提示 */}
        <box marginTop={1}>
          <text fg={theme.colors.muted}>{"↑↓ 导航 · Enter 选择 · Esc 返回"}</text>
        </box>
      </Show>
    </box>
  );
}
