/**
 * 子代理配置页面
 *
 * 职责:
 *   - 查看/编辑/创建/删除子代理
 *   - 管理子代理的名称、描述、工具、系统提示词
 *
 * 模块功能:
 *   - 列表视图:显示所有子代理
 *   - 详情视图:查看和编辑代理属性
 *   - 创建模式:新建自定义代理
 *   - 字段编辑:名称、描述、系统提示词
 *   - 工具管理:分配可用工具给代理
 *
 * 使用场景:
 *   - 配置专用子代理(如代码审查、文档生成)
 *   - 管理代理可用的工具集
 *   - 自定义代理行为
 *
 * 边界:
 *   1. 内置代理不可删除
 *   2. 工具从预定义列表中选择
 *   3. 修改即时保存
 *
 * 流程:
 *   1. 加载子代理列表
 *   2. 显示代理列表或详情
 *   3. 处理创建/编辑/删除操作
 *   4. 更新代理配置
 */

import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "@/ui/contexts/theme";
import { type SubAgent, deleteSubAgent, getSubAgent, getSubAgents, updateSubAgent } from "@config";

// ─── 页面层级 ──────────────────────────────────────────────

type Screen = "list" | "detail" | "create" | "edit-field";

type EditField = "name" | "description" | "systemPrompt" | "tools";

// ─── 可用工具列表 ──────────────────────────────────────────

const AVAILABLE_TOOLS = [
  "filesystem-read",
  "filesystem-edit",
  "filesystem-write",
  "bash-execute",
  "codebase-search",
  "web-search",
  "web-fetch",
];

// ─── Props ─────────────────────────────────────────────────

export interface SubAgentConfigProps {
  onClose: () => void;
}

// ─── SubAgentConfigPage 组件 ────────────────────────────────

export function SubAgentConfigPage(props: SubAgentConfigProps) {
  const theme = useTheme();

  // 页面状态
  const [screen, setScreen] = createSignal<Screen>("list");
  const [focusIndex, setFocusIndex] = createSignal(0);
  const [errorMessage, setErrorMessage] = createSignal("");

  // 代理列表
  const [agents, setAgents] = createSignal<SubAgent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = createSignal<string | null>(null);

  // 创建/编辑表单
  const [formName, setFormName] = createSignal("");

  // 字段编辑
  const [editFieldValue, setEditFieldValue] = createSignal("");

  // 当前选中的代理
  const [selectedAgentData, setSelectedAgentData] = createSignal<SubAgent | null>(null);

  // 异步加载选中的代理
  createEffect(() => {
    const id = selectedAgentId();
    if (id) {
      getSubAgent(id).then((a) => setSelectedAgentData(a ?? null));
    } else {
      setSelectedAgentData(null);
    }
  });

  // ─── 刷新列表 ──────────────────────────────────────────

  async function refreshAgents() {
    setAgents(await getSubAgents());
  }

  // 首次加载
  refreshAgents();

  // ─── 进入创建模式 ──────────────────────────────────────

  function startCreate() {
    setFormName("");
    setScreen("create");
    setFocusIndex(0);
    setErrorMessage("");
  }

  // ─── 执行创建 ──────────────────────────────────────────

  // ─── 执行删除 ──────────────────────────────────────────

  async function doDelete(id: string) {
    await deleteSubAgent(id);
    await refreshAgents();
    if (selectedAgentId() === id) {
      setSelectedAgentId(null);
      setScreen("list");
      setFocusIndex(0);
    }
  }

  // ─── 进入字段编辑模式 ──────────────────────────────────

  function startEditField(field: EditField) {
    const agent = selectedAgentData();
    if (!agent) {
      return;
    }

    switch (field) {
      case "name": {
        setEditFieldValue(agent.name);
        break;
      }
      case "description": {
        setEditFieldValue(agent.description);
        break;
      }
      case "systemPrompt": {
        setEditFieldValue(agent.customSystemPrompt || agent.systemPrompt || "");
        break;
      }
      case "tools": {
        // Tools 切换不通过文本编辑
        return;
      }
    }

    setScreen("edit-field");
    setErrorMessage("");
  }

  // ─── 保存字段编辑 ──────────────────────────────────────

  async function saveEditField() {
    const agent = selectedAgentData();
    if (!agent) {
      return;
    }

    // 判断当前正在编辑哪个字段
    // 使用焦点索引映射: 0=name, 1=description, 2=systemPrompt
    const detailIdx = focusIndex();
    const fieldMap: Record<number, EditField> = { 0: "name", 1: "description", 2: "systemPrompt" };
    const field = fieldMap[detailIdx];
    if (!field) {
      return;
    }

    const updates: Record<string, string> = {};
    updates[field] = editFieldValue();

    try {
      await updateSubAgent(agent.id, updates);
      await refreshAgents();
      setScreen("detail");
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "保存失败");
    }
  }

  // ─── 列表选项 ──────────────────────────────────────────

  const listOptions = createMemo(() => {
    const items = agents().map((agent) => ({
      builtin: agent.builtin ?? false,
      label: `${agent.builtin ? "◆ " : "◇ "}${agent.name} — ${agent.description.slice(0, 40)}`,
      value: agent.id,
    }));

    items.push(
      { builtin: false, label: "+ 创建自定义代理", value: "__create__" },
      { builtin: false, label: "← 返回", value: "__back__" },
    );

    return items;
  });

  // ─── 详情选项 ──────────────────────────────────────────

  const detailOptions = createMemo(() => {
    const agent = selectedAgentData();
    if (!agent) {
      return [];
    }

    return [
      { label: `名称: ${agent.name}`, value: "name" },
      { label: `描述: ${agent.description}`, value: "description" },
      {
        label: `系统提示: ${(agent.customSystemPrompt || agent.systemPrompt || "未设置").slice(0, 50)}`,
        value: "systemPrompt",
      },
      { label: `工具: ${agent.tools?.join(", ") || "无"}`, value: "tools" },
      { label: `类型: ${agent.builtin ? "内置" : "自定义"}`, value: "__type__" },
      ...(agent.builtin ? [] : [{ label: "✗ 删除代理", value: "__delete__" }]),
      { label: "← 返回列表", value: "__back__" },
    ];
  });

  // ─── 当前选项 ──────────────────────────────────────────

  const currentOptions = createMemo(() => {
    switch (screen()) {
      case "list": {
        return listOptions();
      }
      case "detail": {
        return detailOptions();
      }
      default: {
        return [];
      }
    }
  });

  // ─── 页面标题 ──────────────────────────────────────────

  const pageTitle = createMemo(() => {
    switch (screen()) {
      case "list": {
        return "子代理列表";
      }
      case "detail": {
        return selectedAgentData()?.name || "代理详情";
      }
      case "create": {
        return "创建子代理";
      }
      case "edit-field": {
        return "编辑字段";
      }
      default: {
        return "子代理配置";
      }
    }
  });

  // ─── 键盘处理 ────────────────────────────────────────

  useKeyboard((event) => {
    // 字段编辑模式
    if (screen() === "edit-field") {
      if (event.name === "escape") {
        setScreen("detail");
        setErrorMessage("");
      } else if (event.name === "return" || event.name === "enter") {
        saveEditField();
      } else if (event.name === "backspace") {
        setEditFieldValue((v) => v.slice(0, -1));
      } else if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
        setEditFieldValue((v) => v + event.name);
      }
      return;
    }

    // 创建模式
    if (screen() === "create") {
      if (event.name === "escape") {
        setScreen("list");
        setFocusIndex(0);
        setErrorMessage("");
      }
      // 创建模式下使用焦点索引导航表单字段
      return;
    }

    // 列表/详情模式
    if (event.name === "escape") {
      if (screen() === "detail") {
        setScreen("list");
        setFocusIndex(0);
      } else {
        props.onClose();
      }
      return;
    }

    if (event.name === "up") {
      setFocusIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (event.name === "down") {
      const maxIdx = screen() === "list" ? listOptions().length - 1 : detailOptions().length - 1;
      setFocusIndex((i) => Math.min(maxIdx, i + 1));
      return;
    }

    if (event.name === "return" || event.name === "enter") {
      const idx = focusIndex();

      if (screen() === "list") {
        const opt = listOptions()[idx];
        if (!opt) {
          return;
        }
        if (opt.value === "__back__") {
          props.onClose();
        } else if (opt.value === "__create__") {
          startCreate();
        } else {
          setSelectedAgentId(opt.value);
          setScreen("detail");
          setFocusIndex(0);
        }
      } else if (screen() === "detail") {
        const opt = detailOptions()[idx];
        if (!opt) {
          return;
        }
        if (opt.value === "__back__") {
          setScreen("list");
          setFocusIndex(0);
        } else if (opt.value === "__delete__") {
          const agent = selectedAgentData();
          if (agent) {
            doDelete(agent.id);
          }
        } else if (opt.value === "__type__") {
          // 只读，不做操作
        } else if (opt.value === "tools") {
          // 切换工具 - 切换第一个工具的启用状态
          const agent = selectedAgentData();
          if (agent) {
            const currentTools = agent.tools || [];
            const nextTool = AVAILABLE_TOOLS.find((t) => !currentTools.includes(t));
            if (nextTool) {
              void updateSubAgent(agent.id, { tools: [...currentTools, nextTool] }).then(() => refreshAgents());
            } else if (currentTools.length > 0) {
              void updateSubAgent(agent.id, { tools: currentTools.slice(0, -1) }).then(() => refreshAgents());
            }
          }
        } else {
          startEditField(opt.value as EditField);
        }
      }
    }
  });

  // ─── 渲染 ────────────────────────────────────────────

  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1}>
      {/* 标题 */}
      <box marginBottom={1}>
        <span style={{ fg: theme.colors.warning, "font-weight": "bold" }}>{"子代理配置"}</span>
        <text fg={theme.colors.muted}>{` — ${pageTitle()}`}</text>
      </box>

      {/* 错误消息 */}
      <Show when={errorMessage()}>
        <box marginBottom={1}>
          <text fg={theme.colors.error}>{`✗ ${errorMessage()}`}</text>
        </box>
      </Show>

      {/* 字段编辑模式 */}
      <Show when={screen() === "edit-field"}>
        <box flexDirection="column" paddingLeft={1}>
          <text fg={theme.colors.info}>{"编辑字段:"}</text>
          <box paddingLeft={1} marginTop={1}>
            <text fg={theme.colors.accent}>{`❯ ${editFieldValue()}_`}</text>
          </box>
          <box marginTop={1}>
            <text fg={theme.colors.muted}>{"Enter 保存 · Esc 取消"}</text>
          </box>
        </box>
      </Show>

      {/* 创建模式 */}
      <Show when={screen() === "create"}>
        <box flexDirection="column" paddingLeft={1}>
          <box marginBottom={1}>
            <text fg={theme.colors.info}>{"创建新的子代理"}</text>
          </box>
          <text fg={theme.colors.muted}>{"请输入代理名称，然后按 Enter 确认"}</text>
          <box paddingLeft={1} marginTop={1}>
            <text fg={theme.colors.accent}>{`❯ ${formName()}_`}</text>
          </box>
          <box marginTop={1}>
            <text fg={theme.colors.muted}>{"输入名称 · Enter 创建 · Esc 取消"}</text>
          </box>
        </box>
      </Show>

      {/* 列表/详情模式 */}
      <Show when={screen() === "list" || screen() === "detail"}>
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

        {/* 详情页额外信息 */}
        <Show when={screen() === "detail" && selectedAgentData()}>
          <box marginTop={1} paddingLeft={1}>
            <text fg={theme.colors.info}>{`工具: ${(selectedAgentData()?.tools || []).join(", ") || "无"}`}</text>
          </box>
        </Show>

        <box marginTop={1}>
          <text fg={theme.colors.muted}>{"↑↓ 导航 · Enter 选择 · Esc 返回"}</text>
        </box>
      </Show>
    </box>
  );
}
