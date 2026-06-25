/**
 * MCP 管理页面
 *
 * 职责:
 *   - 管理 MCP(Model Context Protocol)服务
 *   - 显示服务状态和工具列表
 *   - 支持服务启停和重连
 *
 * 模块功能:
 *   - 服务列表:统一列表展示内置和外部服务
 *   - 状态显示:已连接/连接中/错误/已停止
 *   - 服务详情:类型、来源、配置路径、工具列表
 *   - 操作支持:Enter 重连、E 启停、R 刷新、A OAuth
 *   - 统计信息:服务总数、已连接数、错误数
 *
 * 使用场景:
 *   - 管理外部 MCP 服务连接
 *   - 查看服务状态和工具
 *   - 配置 OAuth 认证
 *
 * 边界:
 *   1. 内置服务始终启用，不可停止
 *   2. 外部服务支持启用/禁用
 *   3. 通过事件总线接收状态更新
 *
 * 流程:
 *   1. 页面挂载时启动 MCP Runtime
 *   2. 加载服务列表和状态
 *   3. 监听状态更新事件
 *   4. 处理用户操作(重连/启停/刷新)
 */
import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "@/ui/contexts/theme";
import { useEventBus } from "@/ui/contexts/eventBus";
import { AppEvent } from "@bus";
import { createLogger } from "@/core/logging/logger";
import { connectionIcon, iconPause } from "@/ui/utils/icon";
const log = createLogger("ui:mcp");

import {
  getMcpRuntimeDisplaySnapshot,
  refreshMcpRuntime,
  restartMcpRuntimeServer,
  setMcpRuntimeServerEnabled,
  startMcpRuntimeAuth,
  waitForMcpRuntimeAuthCode,
  finishMcpRuntimeAuthCode,
  type McpRuntimeServerSnapshot,
} from "@/mcp/manager/runtime";

function stateEmoji(s: McpRuntimeServerSnapshot["state"]): string {
  if (s === "connected") {
    return connectionIcon("connected");
  }
  if (s === "connecting") {
    return connectionIcon("connecting");
  }
  if (s === "error") {
    return connectionIcon("error");
  }
  if (s === "disabled") {
    return `${iconPause} `;
  }
  return connectionIcon("disconnected");
}

function stateClr(
  s: McpRuntimeServerSnapshot["state"],
  c: { success: string; warning: string; error: string; muted: string; accent: string },
): string {
  if (s === "connected") {
    return c.success;
  }
  if (s === "connecting") {
    return c.warning;
  }
  if (s === "error") {
    return c.error;
  }
  if (s === "disabled") {
    return c.muted;
  }
  return c.accent;
}

function connText(s: McpRuntimeServerSnapshot["state"]): string {
  if (s === "connected") {
    return "已连接";
  }
  if (s === "connecting") {
    return "连接中";
  }
  if (s === "error") {
    return "错误";
  }
  if (s === "disabled") {
    return "已停止";
  }
  return "未连接";
}

function fmtDur(ms: number | undefined): string {
  if (!ms || ms <= 0) {
    return "";
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

function pad(t: string, w: number): string {
  return t + " ".repeat(Math.max(0, w - t.length));
}

function tagLbl(t: "builtin" | "external"): string {
  return t === "builtin" ? "内置" : "外部";
}

function tagClr(t: "builtin" | "external", c: { accent: string; secondary: string }): string {
  return t === "builtin" ? c.accent : c.secondary;
}

export function McpPage() {
  const eventBus = useEventBus();
  const theme = useTheme();
  const c = theme.colors;

  const [servers, setServers] = createSignal<McpRuntimeServerSnapshot[]>(getMcpRuntimeDisplaySnapshot());
  const [selIdx, setSelIdx] = createSignal(0);
  const [busy, setBusy] = createSignal<string | null>(null);

  const activeCount = createMemo(() => servers().filter((s) => s.state === "connected").length);
  const errorCount = createMemo(() => servers().filter((s) => s.state === "error").length);
  const isBuiltin = (s: McpRuntimeServerSnapshot) => s.tag === "builtin";
  const isDisabled = (s: McpRuntimeServerSnapshot) => s.enabled === false || s.state === "disabled";

  const sync = () => {
    const next = getMcpRuntimeDisplaySnapshot();
    log.info(`同步快照: ${next.length} 个服务`);
    setServers(next);
    if (selIdx() >= next.length) {
      setSelIdx(Math.max(0, next.length - 1));
    }
  };

  onMount(() => {
    log.info("MCP 页面挂载，启动 Runtime");
    refreshMcpRuntime()
      .then(() => {
        log.info("MCP Runtime 启动成功");
        sync();
      })
      .catch((error) => {
        log.error(`MCP Runtime 启动失败: ${error instanceof Error ? error.message : String(error)}`);
        sync();
      });
  });

  const unsub = eventBus.subscribe(AppEvent.McpStatusUpdated, (evt) => {
    const display = [...evt.properties.servers, ...evt.properties.builtinGroups];
    log.info(`收到状态更新: ${display.length} 个展示项`);
    setServers(display);
    if (selIdx() >= display.length) {
      setSelIdx(Math.max(0, display.length - 1));
    }
  });
  onCleanup(() => {
    unsub();
  });

  useKeyboard((event) => {
    const n = event.name;
    // ESC 由全局 CrabApp 统一处理 route.back()，此处不再处理
    if (n === "up") {
      setSelIdx((i) => Math.max(0, i - 1));
      return;
    }
    if (n === "down") {
      setSelIdx((i) => Math.min(servers().length - 1, i + 1));
      return;
    }

    if (n === "return" || n === "enter") {
      const selectedServer = servers()[selIdx()];
      if (!selectedServer || isBuiltin(selectedServer) || isDisabled(selectedServer)) {
        return;
      }
      log.info(`重连服务: ${selectedServer.name}`);
      setBusy("连接中...");
      void restartMcpRuntimeServer(selectedServer.name)
        .then(() => {
          log.info(`重连成功: ${selectedServer.name}`);
        })
        .catch((error) => {
          log.error(`重连失败: ${selectedServer.name} — ${error instanceof Error ? error.message : String(error)}`);
        })
        .finally(() => {
          setBusy(null);
          sync();
        });
      return;
    }

    if (n === "e") {
      const selectedServer = servers()[selIdx()];
      if (!selectedServer || isBuiltin(selectedServer)) {
        return;
      }
      const willEnable = isDisabled(selectedServer);
      log.info(`${willEnable ? "启用" : "禁用"}服务: ${selectedServer.name}`);
      setBusy("加载中...");
      void setMcpRuntimeServerEnabled(selectedServer.name, willEnable)
        .then(() => {
          log.info(`${willEnable ? "启用" : "禁用"}成功: ${selectedServer.name}`);
        })
        .catch((error) => {
          log.error(
            `${willEnable ? "启用" : "禁用"}失败: ${selectedServer.name} — ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        })
        .finally(() => {
          setBusy(null);
          sync();
        });
      return;
    }

    if (n === "r") {
      log.info("刷新 MCP 服务列表");
      setBusy("加载中...");
      void refreshMcpRuntime()
        .then(() => {
          log.info(`刷新完成, ${servers().length} 个服务`);
        })
        .catch((error) => {
          log.error(`刷新失败: ${error instanceof Error ? error.message : String(error)}`);
        })
        .finally(() => {
          setBusy(null);
          sync();
        });
      return;
    }

    if (n === "a") {
      const selectedServer = servers()[selIdx()];
      if (!selectedServer || !selectedServer.supportsOAuth || isBuiltin(selectedServer)) {
        return;
      }
      setBusy("加载中...");
      void startMcpRuntimeAuth(selectedServer.name)
        .then(() => {
          void waitForMcpRuntimeAuthCode(selectedServer.name)
            .then((code) => finishMcpRuntimeAuthCode(selectedServer.name, code))
            .catch((error) => {
              log.error(`OAuth 失败: ${error instanceof Error ? error.message : String(error)}`);
            });
        })
        .catch((error) => {
          log.error(`OAuth 启动失败: ${error instanceof Error ? error.message : String(error)}`);
        })
        .finally(() => {
          setBusy(null);
          sync();
        });
    }
  });

  // 列宽常量
  const WN = 26,
    WT = 7,
    WW = 8,
    WS = 9,
    WD = 9;

  return (
    <box flexDirection="column" flexGrow={1} paddingTop={1} paddingLeft={2} paddingRight={2}>
      {/* 顶栏 */}
      <box flexDirection="row" justifyContent="space-between">
        <text>
          <span style={{ bold: true, fg: c.primary }}>MCP 服务管理</span>
        </text>
        <text fg={c.muted}>
          {`${servers().length} MCP 服务 · `}
          <span style={{ fg: c.success }}>{`${activeCount()} 已连接`}</span>
          <Show when={errorCount() > 0}>
            <span style={{ fg: c.error }}>{` · ${errorCount()} 错误`}</span>
          </Show>
          <Show when={busy()}>
            <span style={{ fg: c.accent }}>{` · ${busy()}`}</span>
          </Show>
        </text>
      </box>
      <box height={1}>
        <text fg={c.border}>──────────────────────────────────────────────────────────────────────</text>
      </box>

      {/* 主体 */}
      <box flexDirection="row" flexGrow={1} minHeight={0}>
        {/* 左:列表 70% */}
        <box width="70%" flexDirection="column" paddingRight={1}>
          {/* 表头 */}
          <text fg={c.muted}>{`  ${pad("名称", WN)}${pad("类型", WT)}${pad("工具", WW)}${pad("状态", WS)}耗时`}</text>
          <box height={1}>
            <text fg={c.border}>────────────────────────────────────────────────────</text>
          </box>

          {/* 列表 — 所有动态值直接在 JSX 中计算 */}
          <For each={servers()}>
            {(server, idx) => (
              <text>
                <span style={{ fg: idx() === selIdx() ? c.success : undefined }}>
                  {idx() === selIdx() ? "▸ " : "  "}
                </span>
                <span style={{ fg: stateClr(server.state, c) }}>{`${stateEmoji(server.state)} `}</span>
                <span style={{ fg: idx() === selIdx() ? c.success : c.text }}>{pad(server.name, WN)}</span>
                <span style={{ fg: tagClr(server.tag, c) }}>{pad(tagLbl(server.tag), WT)}</span>
                <span style={{ fg: c.muted }}>{pad(`${server.toolCount} 工具`, WW)}</span>
                <span
                  style={{
                    fg: isDisabled(server)
                      ? c.muted
                      : server.state === "connected"
                        ? c.success
                        : stateClr(server.state, c),
                  }}
                >
                  {pad(
                    isDisabled(server) ? "已停止" : server.state === "connected" ? "运行中" : connText(server.state),
                    WS,
                  )}
                </span>
                <span style={{ fg: c.warning }}>{pad(fmtDur(server.connectDurationMs), WD)}</span>
              </text>
            )}
          </For>

          <Show when={servers().length === 0}>
            <text fg={c.muted}> 暂无 MCP 服务</text>
          </Show>
        </box>

        {/* 分隔 */}
        <box width={1} flexDirection="column">
          <text fg={c.border}>│</text>
        </box>

        {/* 右:详情 30% */}
        <box width="30%" flexDirection="column" paddingLeft={2} paddingRight={1}>
          <Show
            when={servers().length > 0 && selIdx() < servers().length}
            fallback={<text fg={c.muted}>选择服务查看详情</text>}
          >
            {(() => {
              const s = servers()[selIdx()]!;
              const color = stateClr(s.state, c);
              const tc = tagClr(s.tag, c);
              const dur = fmtDur(s.connectDurationMs);
              const builtin = isBuiltin(s);

              return (
                <box flexDirection="column" paddingBottom={1}>
                  <text>
                    <span style={{ fg: color }}>{`${stateEmoji(s.state)} `}</span>
                    <span style={{ bold: true, fg: c.text }}>{s.name}</span>
                    <span style={{ fg: tc }}>{` [${tagLbl(s.tag)}]`}</span>
                  </text>

                  <box height={1} />
                  <text>
                    <span style={{ fg: c.muted }}>{"状态 "}</span>
                    <span style={{ fg: color }}>{connText(s.state)}</span>
                    <Show when={dur.length > 0}>
                      <span style={{ fg: c.warning }}>{` · ${dur}`}</span>
                    </Show>
                  </text>
                  <text>
                    <span style={{ fg: c.muted }}>{"类型 "}</span>
                    <span style={{ fg: c.text }}>{s.type}</span>
                  </text>
                  <Show when={!builtin}>
                    <text>
                      <span style={{ fg: c.muted }}>{"来源 "}</span>
                      <span style={{ fg: c.text }}>{s.source}</span>
                    </text>
                    <text>
                      <span style={{ fg: c.muted }}>{"配置 "}</span>
                      <span style={{ fg: c.secondary }}>{s.configPath}</span>
                    </text>
                  </Show>
                  <Show when={s.error}>
                    <text>
                      <span style={{ fg: c.muted }}>{"错误 "}</span>
                      <span style={{ fg: c.error }}>{s.error ?? ""}</span>
                    </text>
                  </Show>

                  <box height={1}>
                    <text fg={c.border}>──────────────────</text>
                  </box>
                  <Show when={builtin}>
                    <text fg={c.muted}>内置服务，始终启用</text>
                  </Show>
                  <Show when={!builtin && !isDisabled(s)}>
                    <text fg={c.muted}>
                      <span style={{ fg: c.text }}>{"Enter"}</span>重启
                      <span style={{ fg: c.text }}>{"E"}</span> 停止
                    </text>
                  </Show>
                  <Show when={!builtin && isDisabled(s)}>
                    <text fg={c.muted}>
                      <span style={{ fg: c.text }}>{"E"}</span> 启动
                    </text>
                  </Show>

                  <Show when={s.toolNames.length > 0}>
                    <box height={1}>
                      <text fg={c.border}>──────────────────</text>
                    </box>
                    <text>
                      <span style={{ bold: true, fg: c.accent }}>{`工具 (${s.toolNames.length})`}</span>
                    </text>
                    <box flexDirection="column" paddingLeft={1}>
                      <For each={s.toolNames}>
                        {(tn) => (
                          <text>
                            <span style={{ fg: c.muted }}>{"· "}</span>
                            <span style={{ fg: c.text }}>{tn}</span>
                          </text>
                        )}
                      </For>
                    </box>
                  </Show>
                </box>
              );
            })()}
          </Show>
        </box>
      </box>

      {/* 底栏 */}
      <box height={1}>
        <text fg={c.border}>──────────────────────────────────────────────────────────────────────</text>
      </box>
      <text fg={c.muted}>
        <span style={{ fg: c.text }}>{"↑↓"}</span>确认
        <span style={{ fg: c.text }}>{"Enter"}</span>重启
        <span style={{ fg: c.text }}>{"E"}</span> 停止
        <span style={{ fg: c.text }}>{"R"}</span> ↻ 重启
        <span style={{ fg: c.text }}>{"Esc"}</span> 返回
      </text>
    </box>
  );
}
