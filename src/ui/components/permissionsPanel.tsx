/**
 * PermissionsPanel 组件
 *
 * 职责:
 *   - 提供权限规则管理界面，显示和配置工具调用权限
 *   - 支持启用/禁用特定权限规则
 *
 * 模块功能:
 *   - 显示权限规则列表，包括规则名称、类型、描述、启用状态
 *   - 支持三种权限类型:允许(allow)、拒绝(deny)、确认(confirm)
 *   - 提供图例说明各图标含义
 *   - 支持键盘导航和 T 键切换规则启用状态
 *
 * 使用场景:
 *   - 用户需要查看当前权限配置时
 *   - 需要临时禁用某些权限规则时
 *   - 需要了解各工具的权限策略时
 *
 * 边界:
 *   1. 默认提供 5 条预设规则(文件读取、文件写入、Bash 执行、敏感命令、网络请求)
 *   2. 仅支持切换规则的启用/禁用状态，不支持修改规则内容
 *   3. 规则类型图标:✓ 允许、✗ 拒绝、? 确认
 *
 * 流程:
 *   1. 初始化时加载默认规则或传入的规则
 *   2. 渲染规则列表，显示每条规则的启用状态和类型
 *   3. 上下键导航，T 键切换启用状态
 *   4. Esc 键关闭面板
 */

import { For, createMemo, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "@/ui/contexts/theme";
import { actionSelect, iconError, iconSuccess } from "@/ui/utils/icon";
import { checkboxIcon } from "@/core/icons/iconDerived";

// ─── 类型 ──────────────────────────────────────────────────

interface PermissionRule {
  id: string;
  name: string;
  type: "allow" | "deny" | "confirm";
  toolPattern: string;
  description: string;
  enabled: boolean;
}

// ─── Props ─────────────────────────────────────────────────

export interface PermissionsPanelProps {
  onClose: () => void;
  rules?: PermissionRule[];
  onToggleRule?: (id: string) => void;
}

// ─── 默认权限规则 ──────────────────────────────────────────

const DEFAULT_RULES: PermissionRule[] = [
  {
    description: "允许读取任意文件",
    enabled: true,
    id: "fs-read",
    name: "文件读取",
    toolPattern: "filesystem-read",
    type: "allow",
  },
  {
    description: "文件写入需确认",
    enabled: true,
    id: "fs-write",
    name: "文件写入",
    toolPattern: "filesystem-*",
    type: "confirm",
  },
  {
    description: "命令执行需确认",
    enabled: true,
    id: "bash",
    name: "Bash 执行",
    toolPattern: "bash-execute",
    type: "confirm",
  },
  {
    description: "敏感命令默认拒绝",
    enabled: true,
    id: "sensitive",
    name: "敏感命令",
    toolPattern: "sensitive-*",
    type: "deny",
  },
  { description: "允许网络请求", enabled: true, id: "web", name: "网络请求", toolPattern: "web-*", type: "allow" },
];

// ─── PermissionsPanel 组件 ─────────────────────────────────

export function PermissionsPanel(props: PermissionsPanelProps) {
  const theme = useTheme();

  const [focusIndex, setFocusIndex] = createSignal(0);
  const [rules, setRules] = createSignal<PermissionRule[]>(props.rules || DEFAULT_RULES);

  const typeIcons: Record<string, string> = {
    allow: iconSuccess,
    confirm: "?",
    deny: iconError,
  };

  const listOptions = createMemo(() => {
    const ruleItems = rules().map((rule) => ({
      label: `${rule.enabled ? `[${checkboxIcon(true)}]` : checkboxIcon(false)} ${typeIcons[rule.type]} ${rule.name} — ${rule.description}`,
      rule,
      value: rule.id,
    }));

    return [
      ...ruleItems,
      { label: "─".repeat(30), rule: null as any, value: "__sep__" },
      { label: "← 返回", rule: null as any, value: "__back__" },
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

    // T 切换启用
    if (event.name === "t" && !event.ctrl && !event.meta) {
      const idx = focusIndex();
      const opt = listOptions()[idx];
      if (opt && opt.rule) {
        setRules((prev) => prev.map((r) => (r.id === opt.rule.id ? { ...r, enabled: !r.enabled } : r)));
        props.onToggleRule?.(opt.rule.id);
      }
      return;
    }

    // Enter 查看详情 / 切换
    if (event.name === "return" || event.name === "enter") {
      const idx = focusIndex();
      const opt = listOptions()[idx];
      if (!opt) {
        return;
      }
      if (opt.value === "__back__") {
        props.onClose();
      }
    }
  });

  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <box marginBottom={1}>
        <span style={{ fg: theme.colors.warning, "font-weight": "bold" }}>{"权限管理"}</span>
        <text fg={theme.colors.muted}>{` — ${rules().length} 条规则`}</text>
      </box>

      {/* 图例 */}
      <box marginBottom={1} paddingLeft={1}>
        <text fg={theme.colors.muted}>
          {`${iconSuccess} 允许  ${iconError} 拒绝  ? 确认  [${iconSuccess}] 启用  [ ] 禁用`}
        </text>
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
                {`${isSelected() ? `${actionSelect} ` : "  "}${option.label}`}
              </text>
            );
          }}
        </For>
      </box>

      <box marginTop={1}>
        <text fg={theme.colors.muted}>{"↑↓ 导航 · T 切换启用 · Esc 返回"}</text>
      </box>
    </box>
  );
}
