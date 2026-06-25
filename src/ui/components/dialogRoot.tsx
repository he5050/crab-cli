/**
 * DialogRoot — AppShell 级统一弹窗根
 *
 * 职责:
 *   - 统一管理所有弹窗的挂载点
 *   - 逐步迁移具体选择器到 DialogSelect v2
 *   - 提供统一的弹窗生命周期管理
 *
 * 模块功能:
 *   - DialogRoot: 弹窗根组件
 *   - StatusItem: 状态项类型
 *   - 集成 PermissionDialog、CommandPalette、SessionListDialog 等
 *
 * 使用场景:
 *   - 全局弹窗管理
 *   - 多弹窗协调
 *
 * 边界:
 * 1. Phase 2 已把旧全局弹窗收口到一个挂载点
 * 2. Phase 4 开始逐步迁移具体选择器到 DialogSelect v2
 * 3. 不处理具体弹窗的业务逻辑
 *
 * 流程:
 * 1. 暂无(这是 UI 组件根，无特定执行流程)
 */
import { For, type JSX, Show, createMemo, createSignal, onCleanup } from "solid-js";
import { KeyboardPriority, useKeyboardPriority } from "@/ui/keyboardPriority";
import { useEventBus } from "@/ui/contexts/eventBus";
import { AppEvent } from "@bus";
import { createId } from "@/core/identity";
import { ensureSession } from "@session";
import { useConfig } from "@/ui/contexts/config";
import { useDialog } from "@/ui/contexts/dialog";
import { useRoute } from "@/ui/contexts/route";
import { DialogHeader, DialogOverlay } from "@/ui/components/dialogUi";
import { PermissionDialog } from "@/ui/components/permissionDialog";
import { CommandPalette } from "@/ui/components/commandPalette";
import { SessionListDialog } from "@/ui/components/sessionListDialog";
import { ThemeListDialog } from "@/ui/components/dialogThemeList";
import { ProfilePanel } from "@/ui/components/profilePanel";
import { ModelPicker } from "@/ui/components/modelPicker";
import { DialogStatus } from "@/ui/components/dialogStatus";
import { RecoveryDialog } from "@/ui/components/recoveryDialog";
import { clearAgentState } from "@/agent";

interface StatusItem {
  name: string;
  status: string;
  detail?: string;
  error?: string;
}

function renderDialogElement(element: unknown): JSX.Element | string {
  if (typeof element === "function") {
    return (element as () => JSX.Element | string)();
  }
  return typeof element === "string" ? element : (element as JSX.Element);
}

export function DialogRoot() {
  const eventBus = useEventBus();
  const dialog = useDialog();
  const route = useRoute();
  const { config, setConfig } = useConfig();
  const [showCommandPalette, setShowCommandPalette] = createSignal(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = createSignal("");
  const [showSessionList, setShowSessionList] = createSignal(false);
  const [showThemePicker, setShowThemePicker] = createSignal(false);
  const [showModelPicker, setShowModelPicker] = createSignal(false);
  const [showStatusDialog, setShowStatusDialog] = createSignal(false);
  const [showProfilePanel, setShowProfilePanel] = createSignal(false);
  const [showRecovery, setShowRecovery] = createSignal(false);
  const [recoverableSessions, setRecoverableSessions] = createSignal<
    {
      sessionId: string;
      title: string;
      savedAt: number;
      status: string;
    }[]
  >([]);
  const [mcpServers, setMcpServers] = createSignal<StatusItem[]>([]);

  const unsubCommandPalette = eventBus.subscribe(AppEvent.CommandPaletteShow, (evt) => {
    setCommandPaletteQuery(evt.properties.query ?? "");
    setShowCommandPalette(true);
  });
  onCleanup(() => {
    unsubCommandPalette();
  });

  const unsubSessionList = eventBus.subscribe(AppEvent.SessionListShow, () => {
    setShowSessionList(true);
  });
  onCleanup(() => {
    unsubSessionList();
  });

  const unsubThemePicker = eventBus.subscribe(AppEvent.ThemePickerShow, () => {
    setShowThemePicker(true);
  });
  onCleanup(() => {
    unsubThemePicker();
  });

  const unsubModelPicker = eventBus.subscribe(AppEvent.ModelPickerShow, () => {
    setShowModelPicker(true);
  });
  onCleanup(() => {
    unsubModelPicker();
  });

  const unsubStatusDialog = eventBus.subscribe(AppEvent.StatusDialogShow, () => {
    setShowStatusDialog(true);
  });
  onCleanup(() => {
    unsubStatusDialog();
  });

  const unsubProfilePanel = eventBus.subscribe(AppEvent.ProfilePanelShow, () => {
    setShowProfilePanel(true);
  });
  onCleanup(() => {
    unsubProfilePanel();
  });

  const unsubRecovery = eventBus.subscribe(AppEvent.AgentRecoveryDetected, (evt) => {
    setRecoverableSessions(evt.properties.sessions);
    setShowRecovery(true);
  });
  onCleanup(() => {
    unsubRecovery();
  });

  const unsubMcp = eventBus.subscribe(AppEvent.McpStatusUpdated, (evt) => {
    setMcpServers(
      evt.properties.servers.map((server) => ({
        detail: `${server.type} · ${server.toolCount} tools`,
        error: server.error,
        name: server.name,
        status: server.state,
      })),
    );
  });
  onCleanup(() => {
    unsubMcp();
  });

  const modelEntries = createMemo(() => {
    const entries: { provider: string; model: string; label: string; description?: string }[] = [];
    const seen = new Set<string>();
    for (const [provider, providerConfig] of Object.entries(config.providerConfig ?? {})) {
      const models = providerConfig.modelList?.length
        ? providerConfig.modelList
        : providerConfig.defaultModel
          ? [providerConfig.defaultModel]
          : [];
      for (const model of models) {
        const key = `${provider}:${model}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        entries.push({
          description: providerConfig.requestMethod,
          label: `${provider} / ${model}`,
          model,
          provider,
        });
      }
    }
    const currentKey = `${config.defaultProvider.provider}:${config.defaultProvider.model}`;
    if (!seen.has(currentKey)) {
      entries.unshift({
        description: "当前模型",
        label: `${config.defaultProvider.provider} / ${config.defaultProvider.model}`,
        model: config.defaultProvider.model,
        provider: config.defaultProvider.provider,
      });
    }
    return entries;
  });

  const updateModel = (provider: string, model: string) => {
    const next = {
      ...config,
      defaultProvider: { model, provider },
    };
    setConfig(next);
    eventBus.publish(AppEvent.ConfigUpdated, { config: next, source: "hot-reload" });
    eventBus.publish(AppEvent.Toast, { message: `已切换模型: ${provider}/${model}`, variant: "success" });
    setShowModelPicker(false);
  };

  useKeyboardPriority(KeyboardPriority.DIALOG_ROOT, "dialog-root", (event) => {
    if (event.name !== "escape") {
      return;
    }
    if (showCommandPalette()) {
      setShowCommandPalette(false);
      event.stopPropagation();
      return;
    }
    if (showProfilePanel()) {
      setShowProfilePanel(false);
      event.stopPropagation();
      return;
    }
    if (showStatusDialog()) {
      setShowStatusDialog(false);
      event.stopPropagation();
      return;
    }
    if (showModelPicker()) {
      setShowModelPicker(false);
      event.stopPropagation();
      return;
    }
    if (showThemePicker()) {
      setShowThemePicker(false);
      event.stopPropagation();
      return;
    }
    if (showSessionList()) {
      setShowSessionList(false);
      event.stopPropagation();
      return;
    }
    const top = dialog.stack[dialog.stack.length - 1];
    if (top) {
      dialog.close(top.id);
      event.stopPropagation();
    }
  });

  const createAndOpenSession = () => {
    const sessionId = createId("ses");
    ensureSession(sessionId, {
      model: config.defaultProvider.model,
      projectDir: process.cwd(),
    });
    eventBus.publish(AppEvent.SessionCreated, { sessionId });
    route.navigate({ sessionId, type: "session" });
  };

  return (
    <>
      <PermissionDialog />

      <Show when={showCommandPalette()}>
        <DialogOverlay size="large" onClose={() => setShowCommandPalette(false)}>
          <CommandPalette
            initialQuery={commandPaletteQuery()}
            onClose={() => {
              setShowCommandPalette(false);
              setCommandPaletteQuery("");
            }}
          />
        </DialogOverlay>
      </Show>

      <Show when={showSessionList()}>
        <SessionListDialog
          onSelect={(id: string) => {
            setShowSessionList(false);
            eventBus.publish(AppEvent.SessionSwitched, { sessionId: id });
            route.navigate({ sessionId: id, type: "session" });
          }}
          onNew={() => {
            setShowSessionList(false);
            createAndOpenSession();
          }}
          onClose={() => setShowSessionList(false)}
        />
      </Show>

      <Show when={showThemePicker()}>
        <ThemeListDialog onClose={() => setShowThemePicker(false)} />
      </Show>

      <Show when={showModelPicker()}>
        <ModelPicker
          models={modelEntries()}
          currentProvider={config.defaultProvider.provider}
          currentModel={config.defaultProvider.model}
          onSelect={updateModel}
          onClose={() => setShowModelPicker(false)}
        />
      </Show>

      <Show when={showStatusDialog()}>
        <DialogOverlay size="medium" onClose={() => setShowStatusDialog(false)}>
          <DialogStatus
            agentName={config.agents?.[0]?.name ?? "default"}
            modelName={`${config.defaultProvider.provider}/${config.defaultProvider.model}`}
            mcpServers={mcpServers()}
            onClose={() => setShowStatusDialog(false)}
          />
        </DialogOverlay>
      </Show>

      <Show when={showProfilePanel()}>
        <ProfilePanel onClose={() => setShowProfilePanel(false)} />
      </Show>

      <Show when={showRecovery()}>
        <RecoveryDialog
          sessions={recoverableSessions()}
          onConfirm={(sessionId: string) => {
            setShowRecovery(false);
            clearAgentState(sessionId);
            eventBus.publish(AppEvent.SessionSwitched, { sessionId });
            route.navigate({ sessionId, type: "session" });
          }}
          onDismiss={() => {
            setShowRecovery(false);
          }}
        />
      </Show>

      <For each={dialog.stack}>
        {(item) => (
          <DialogOverlay size={dialog.size} onClose={() => dialog.close(item.id)}>
            <DialogHeader title="面板" />
            {renderDialogElement(item.element)}
          </DialogOverlay>
        )}
      </For>
    </>
  );
}
