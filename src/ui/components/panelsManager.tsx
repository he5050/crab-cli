/**
 * PanelsManager 组件
 *
 * 职责:
 *   - 提供面板管理基础设施，支持面板的注册、打开、关闭
 *   - 基于 useDialog context 实现弹窗栈管理
 *
 * 模块功能:
 *   - PanelId 类型定义:支持 20+ 种面板类型
 *   - 面板注册表:registerPanel / registerPanels / getPanelDefinition
 *   - openPanel API:通过 useDialog 打开指定面板
 *   - PanelsManager 组件:渲染当前弹窗栈中的所有面板
 *
 * 使用场景:
 *   - 需要打开会话列表、模型选择、权限管理等面板时
 *   - 需要统一管理多个面板的显示和关闭时
 *   - 需要面板层级管理(弹窗栈)时
 *
 * 边界:
 *   1. 面板必须先注册才能打开
 *   2. 未注册的面板打开时会输出警告
 *   3. 面板关闭时自动从弹窗栈移除
 *   4. 支持自定义 onClose 回调
 *
 * 流程:
 *   1. 应用启动时注册所有面板(registerPanels)
 *   2. 调用 openPanel(dialog, panelId) 打开面板
 *   3. PanelsManager 自动渲染弹窗栈中的面板
 *   4. 用户按 Esc 或调用 onClose 关闭面板
 */

import { For, Show } from "solid-js";
import { createLogger } from "@/core/logging/logger";
import { useDialog } from "@/ui/contexts/dialog";
import { useTheme } from "@/ui/contexts/theme";

// ─── 面板注册类型 ──────────────────────────────────────────

export type PanelId =
  | "session-list"
  | "mcp-info"
  | "usage"
  | "help"
  | "custom-command-config"
  | "skill-creation"
  | "role-creation"
  | "role-deletion"
  | "role-list"
  | "working-directory"
  | "branch"
  | "connection"
  | "todo-list"
  | "models"
  | "diff-review"
  | "hooks-config"
  | "sub-agent-config"
  | "system-prompt-config"
  | "sensitive-command-config"
  | "proxy-config"
  | "permissions"
  | "theme-settings"
  | "codebase-config";

/** 面板定义 */
export interface PanelDefinition {
  id: PanelId;
  title: string;
  component: (props: { onClose: () => void }) => any;
}

// ─── 面板注册表 ────────────────────────────────────────────

const panelRegistry = new Map<PanelId, PanelDefinition>();
const log = createLogger("ui:panels");

export function registerPanel(definition: PanelDefinition): void {
  panelRegistry.set(definition.id, definition);
}

export function registerPanels(definitions: PanelDefinition[]): void {
  for (const def of definitions) {
    registerPanel(def);
  }
}

export function getPanelDefinition(id: PanelId): PanelDefinition | undefined {
  return panelRegistry.get(id);
}

export function formatUnregisteredPanelError(id: PanelId): string {
  return `未注册面板: ${id}`;
}

// ─── 面板管理器 API(基于 useDialog)───────────────────────

/**
 * 打开面板。内部使用 useDialog context。
 * 返回弹窗 ID(dialog ID)。
 */
export function openPanel(dialog: ReturnType<typeof useDialog>, id: PanelId, opts?: { onClose?: () => void }): string {
  const def = panelRegistry.get(id);
  if (!def) {
    log.warn(formatUnregisteredPanelError(id), {
      operation: "ui.panel.open",
      panelId: id,
    });
    return "";
  }
  const dialogId = dialog.open(() =>
    def.component({
      onClose: () => {
        dialog.close(dialogId);
        opts?.onClose?.();
      },
    }),
  );
  return dialogId;
}

/**
 * 检查面板是否已注册。
 */
export function isPanelRegistered(id: PanelId): boolean {
  return panelRegistry.has(id);
}

// ─── PanelsManager 组件 ──────────────────────────────────

/**
 * 面板管理器组件。
 *
 * 从 useDialog context 读取当前弹窗列表，
 * 为每个弹窗渲染标题栏 + 内容。
 *
 * Dialog 组件的布局模式:
 *   - 顶部标题行(标题 + esc 提示)
 *   - 下方内容区
 */
export function PanelsManager() {
  const theme = useTheme();
  const dialog = useDialog();

  return (
    <Show when={dialog.stack.length > 0}>
      <For each={dialog.stack}>
        {(item) => (
          <box
            flexDirection="column"
            borderStyle="single"
            borderColor={theme.colors.primary}
            backgroundColor={theme.colors.background}
            paddingLeft={2}
            paddingRight={2}
            paddingBottom={1}
            gap={1}
            marginTop={1}
          >
            <box flexDirection="row" justifyContent="space-between">
              <text fg={theme.colors.text}>{"面板"}</text>
              <text fg={theme.colors.muted}>{"esc 关闭"}</text>
            </box>
            {item.element}
          </box>
        )}
      </For>
    </Show>
  );
}
