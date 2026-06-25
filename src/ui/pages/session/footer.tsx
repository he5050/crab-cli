/**
 * Session Footer 组件
 *
 * 职责:
 *   - 在 Session 页输入框上方显示上下文信息
 *   - 监听并展示 MCP、LSP、权限等系统状态
 *   - 提供侧边栏切换入口
 *
 * 模块功能:
 *   - 显示当前工作目录(缩短路径)
 *   - 显示 MCP 服务连接数和状态
 *   - 显示 LSP 客户端连接状态
 *   - 显示待处理权限请求数量
 *
 * 使用场景:
 *   - Session 页面底部状态栏
 *   - 需要实时了解系统连接状态时
 *
 * 边界:
 *   1. 仅展示状态，不处理业务逻辑
 *   2. 通过事件总线监听状态变化
 *   3. LSP 状态定时轮询(5秒)
 *
 * 流程:
 *   1. 组件挂载时订阅相关事件
 *   2. 接收事件更新对应状态
 *   3. 渲染状态信息到状态栏
 */
import { onCleanup } from "solid-js";
import { useRenderer } from "@opentui/solid";
import { useEventBus } from "@/ui/contexts/eventBus";
import { AppEvent } from "@bus";
import type { TokenUsage } from "@/session/token";
import { SURFACE_PANEL, TEXT_MUTED, TEXT_PRIMARY } from "@/ui/themes/sessionTokens";
import { iconSidebar } from "@/ui/utils/icon";
import type { MutableTextRenderable } from "@/ui/types/renderable";
import { createDeferredSync } from "@/ui/utils/deferredSync";
import { useCurrentMode, useLeaderActive, CRAB_BASE_MODE } from "@/ui/keymap";
import { getInstallationChannelLabel } from "@/core/installationChannel";
import { getCurrentWorkspace, getWorkspaceDisplay } from "@/config/workspace/workspaceManager";

interface SessionFooterProps {
  config: any;
  toggleSidebar: () => void;
}

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}K`;
  }
  return String(n);
}

export function formatTokenUsageLabel(usage: TokenUsage | null | undefined): string {
  if (!usage) {
    return "";
  }
  const total = usage.inputTokens + usage.outputTokens;
  const cacheParts: string[] = [];
  if (usage.cacheReadInputTokens !== undefined) {
    cacheParts.push(`read ${formatTokenCount(usage.cacheReadInputTokens)}`);
  }
  if (usage.cacheCreationInputTokens !== undefined) {
    cacheParts.push(`write ${formatTokenCount(usage.cacheCreationInputTokens)}`);
  }
  if (usage.cachedTokens !== undefined && usage.cachedTokens !== usage.cacheReadInputTokens) {
    cacheParts.push(`cached ${formatTokenCount(usage.cachedTokens)}`);
  }
  return cacheParts.length > 0
    ? ` · ${formatTokenCount(total)} tok · cache ${cacheParts.join("/")}`
    : ` · ${formatTokenCount(total)} tok`;
}

export function SessionFooter(_props: SessionFooterProps) {
  const eventBus = useEventBus();
  const renderer = useRenderer();
  const currentMode = useCurrentMode();
  const leaderActive = useLeaderActive();
  const snapshot: {
    mcpCount: number;
    mcpHasError: boolean;
    lspCount: number;
    permissionCount: number;
    tokenUsage: TokenUsage | null;
    revertedCount: number;
  } = {
    lspCount: 0,
    mcpCount: 0,
    mcpHasError: false,
    permissionCount: 0,
    tokenUsage: null,
    revertedCount: 0,
  };
  let tokenText: MutableTextRenderable | undefined;
  let permissionText: MutableTextRenderable | undefined;
  let lspText: MutableTextRenderable | undefined;
  let mcpText: MutableTextRenderable | undefined;
  let revertText: MutableTextRenderable | undefined;
  const { disposed, schedule: scheduleTextSync } = createDeferredSync(() => {
    syncTextRefs();
  });

  // 低频读取本地 LSP 状态；MCP 状态由事件驱动，避免被定时清零导致闪烁。
  const timer = setInterval(() => {
    refreshLspCount();
  }, 5000);

  const refreshLspCount = () => {
    void import("../../../lsp/manager")
      .then(({ lspManager }) => {
        if (disposed.current) {
          return;
        }
        const active = lspManager
          .getClients()
          .filter((client) => client.state === "running" || client.state === "starting");
        snapshot.lspCount = active.length;
        scheduleTextSync();
      })
      .catch(() => {
        if (disposed.current) {
          return;
        }
        snapshot.lspCount = 0;
        scheduleTextSync();
      });
  };
  refreshLspCount();

  // 监听 MCP 状态更新
  const unsubMcp = eventBus.subscribe(AppEvent.McpStatusUpdated, (evt) => {
    const servers = evt.properties.servers ?? [];
    const connected = servers.filter((s: any) => s.state === "connected");
    snapshot.mcpCount = connected.length;
    snapshot.mcpHasError = servers.some((s: any) => s.state === "error");
    scheduleTextSync();
  });
  const unsubPermissionAsked = eventBus.subscribe(AppEvent.PermissionAsked, () => {
    snapshot.permissionCount += 1;
    scheduleTextSync();
  });
  const unsubPermissionResolved = eventBus.subscribe(AppEvent.PermissionResolved, () => {
    snapshot.permissionCount = Math.max(0, snapshot.permissionCount - 1);
    scheduleTextSync();
  });
  const unsubConversationCompleted = eventBus.subscribe(AppEvent.ConversationCompleted, (evt) => {
    if (disposed) {
      return;
    }
    if (evt.properties.usage) {
      snapshot.tokenUsage = evt.properties.usage as TokenUsage;
      scheduleTextSync();
    }
  });
  // 监听 Revert 状态变更
  const unsubRevertChanged = eventBus.subscribe(AppEvent.SessionRevertChanged, (evt) => {
    snapshot.revertedCount = evt.properties.revertedCount;
    scheduleTextSync();
  });
  onCleanup(() => {
    disposed.current = true;
    unsubMcp();
    unsubPermissionAsked();
    unsubPermissionResolved();
    unsubConversationCompleted();
    unsubRevertChanged();
    clearInterval(timer);
    tokenText = undefined;
    permissionText = undefined;
    lspText = undefined;
    mcpText = undefined;
    revertText = undefined;
  });

  const directory = () => {
    try {
      return process.cwd();
    } catch {
      return "";
    }
  };

  const shortDir = () => {
    const dir = directory();
    if (!dir) {
      return "";
    }
    const parts = dir.split("/");
    return parts.length > 3 ? `.../${parts.slice(-2).join("/")}` : dir;
  };

  // Workspace 显示
  const workspaceLabel = () => {
    try {
      // 延迟加载配置以避免循环依赖
      const { getConfig } = require("@/config/loader/config") as {
        getConfig: () => { workspaces?: unknown[]; currentWorkspaceId?: string } | null;
      };
      const config = getConfig();
      if (!config) {
        return shortDir();
      }
      const ws = getCurrentWorkspace(config as never);
      return ws ? `[${ws.name}] ${shortDir()}` : shortDir();
    } catch {
      return shortDir();
    }
  };

  const tokenLabel = () => formatTokenUsageLabel(snapshot.tokenUsage);
  const permissionLabel = () => (snapshot.permissionCount > 0 ? `${snapshot.permissionCount} 权限` : "");
  const lspLabel = () => `${snapshot.lspCount} LSP`;
  const mcpLabel = () => (snapshot.mcpCount > 0 ? `${snapshot.mcpCount} MCP` : "");
  const revertLabel = () => (snapshot.revertedCount > 0 ? `Revert: ${snapshot.revertedCount}条` : "");
  const syncTextRefs = () => {
    if (disposed) {
      return;
    }
    if (tokenText) {
      tokenText.content = tokenLabel();
    }
    if (permissionText) {
      permissionText.content = permissionLabel();
    }
    if (lspText) {
      lspText.content = lspLabel();
    }
    if (mcpText) {
      mcpText.content = mcpLabel();
    }
    if (revertText) {
      revertText.content = revertLabel();
    }
    renderer.requestRender();
  };

  return (
    <box
      flexDirection="row"
      justifyContent="space-between"
      gap={1}
      flexShrink={0}
      height={1}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={SURFACE_PANEL}
    >
      <box flexDirection="row" gap={1} flexShrink={0}>
        <text fg={TEXT_MUTED}>{workspaceLabel()}</text>
        {/* 当前模式指示（非 base 模式时显示） */}
        {currentMode() !== CRAB_BASE_MODE && (
          <text fg={TEXT_PRIMARY} backgroundColor={SURFACE_PANEL}>
            [{currentMode()}]
          </text>
        )}
        {/* Leader 键等待提示 */}
        {leaderActive() && <text fg={TEXT_PRIMARY}>⎵ Leader…</text>}
      </box>
      <text
        ref={(node) => {
          tokenText = node as MutableTextRenderable;
        }}
        fg={TEXT_MUTED}
        content={tokenLabel()}
      />
      <box gap={2} flexDirection="row" flexShrink={0}>
        <text
          ref={(node) => {
            permissionText = node as MutableTextRenderable;
          }}
          fg={TEXT_MUTED}
          content={permissionLabel()}
        />
        <text
          ref={(node) => {
            lspText = node as MutableTextRenderable;
          }}
          fg={TEXT_MUTED}
          content={lspLabel()}
        />
        <text
          ref={(node) => {
            mcpText = node as MutableTextRenderable;
          }}
          fg={TEXT_MUTED}
          content={mcpLabel()}
        />
        <text fg={TEXT_MUTED}>{getInstallationChannelLabel()}</text>
        <text
          ref={(node) => {
            revertText = node as MutableTextRenderable;
          }}
          fg={TEXT_MUTED}
          content={revertLabel()}
        />
        <text fg={TEXT_MUTED} onMouseDown={() => _props.toggleSidebar()}>
          {iconSidebar} Sidebar [Ctrl+P b]
        </text>
      </box>
    </box>
  );
}
