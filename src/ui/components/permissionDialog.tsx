/**
 * PermissionDialog
 *
 * 职责:
 *   - 显示工具权限请求弹窗
 *   - 提供风险级别提示
 *   - 支持倒计时自动拒绝
 *
 * 模块功能:
 *   - 监听 PermissionAsked 事件显示弹窗
 *   - 轮询外部权限请求(approvalBridge)
 *   - 显示风险级别(低/中/高)和对应图标
 *   - 显示工具名称、命令详情和描述
 *   - 提供三种操作选项:允许一次、始终允许、拒绝
 *   - 30秒倒计时，超时自动拒绝
 *   - 支持键盘快捷键(Y/A/N/Enter/Esc)
 *
 * 使用场景:
 *   - AI 工具需要执行敏感操作前请求用户确认
 *   - 根据风险级别提示用户谨慎操作
 *   - 管理权限记忆(始终允许后不再询问)
 *
 * 边界:
 *   1. 仅处理通过事件总线或 approvalBridge 发送的权限请求
 *   2. 同时只能显示一个权限弹窗
 *   3. 超时后自动拒绝，不保存任何状态
 *
 * 流程:
 *   1. 订阅 PermissionAsked 事件或轮询外部请求
 *   2. 显示权限详情和风险级别
 *   3. 启动 30 秒倒计时
 *   4. 等待用户选择或超时
 *   5. 发布 PermissionResolved 事件或调用 approvalBridge
 */
import { Show, createSignal, onCleanup } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "@/ui/contexts/theme";
import { FeedbackLine } from "@/ui/components/statusFeedback";
import { useEventBus } from "@/ui/contexts/eventBus";
import { iconError, iconSuccess, iconWarning } from "@/ui/utils/icon";
import {
  buildPermissionRequestSnapshot,
  setCurrentPermissionRequest,
  setPermissionActive,
} from "@/permission/ui/permissionState";
import { AppEvent } from "@bus";
import { resolveEscape } from "../escBehavior";
import {
  listPendingExternalPermissionRequests,
  resolveExternalPermissionRequest,
} from "@/permission/store/approvalBridge";

export interface PermissionRequest {
  id: string;
  permission: string;
  tool: string;
  patterns?: string[];
  description?: string;
  riskLevel?: "low" | "medium" | "high";
  external?: boolean;
}

const RISK_CONFIG = {
  high: { color: "error" as const, icon: iconError, label: "高风险" },
  low: { color: "success" as const, icon: iconSuccess, label: "低风险" },
  medium: { color: "warning" as const, icon: iconWarning, label: "中风险" },
} as const;

const ACTION_OPTIONS = [
  { key: "once", label: "允许一次", shortcut: "Y" },
  { key: "always", label: "始终允许", shortcut: "A" },
  { key: "reject", label: "拒绝", shortcut: "N" },
] as const;

type ActionKey = "once" | "always" | "reject";
type PermissionKeyAction = ActionKey | "confirm";

const AUTO_REJECT_SECONDS = 30;

export interface PermissionDialogViewModel {
  title: string;
  countdownText: string;
  risk: { icon: string; label: string; color: "success" | "warning" | "error" };
  toolLine: string;
  command: string;
  descriptionLine?: string;
  memoryHint: string;
  actions: {
    key: ActionKey;
    label: string;
    shortcut: string;
    selected: boolean;
  }[];
  footerHint: string;
}

function firstShortcutCandidate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const cleaned = value.replace(/[\r\n\t]/g, "");
  for (const ch of cleaned) {
    if (/[A-Za-z]/.test(ch)) {
      return ch.toLowerCase();
    }
  }
  return null;
}

export function resolvePermissionDialogAction(
  event: { name?: string; key?: string; sequence?: string; value?: string; ctrl?: boolean; meta?: boolean },
  selectedIndex = 0,
): PermissionKeyAction | null {
  const name = typeof event.name === "string" ? event.name.toLowerCase() : null;
  if (name === "escape") {
    const a = resolveEscape({ pendingPermission: true });
    if (a.kind === "rejectPendingPermission") {
      return "reject";
    }
  }
  if (name === "return" || name === "enter") {
    return "confirm";
  }
  if (event.ctrl || event.meta) {
    return null;
  }
  const candidates = new Set([
    name,
    firstShortcutCandidate(event.key),
    firstShortcutCandidate(event.sequence),
    firstShortcutCandidate(event.value),
  ]);
  if (candidates.has("y")) {
    return "once";
  }
  if (candidates.has("a")) {
    return "always";
  }
  if (candidates.has("n")) {
    return "reject";
  }
  const action = ACTION_OPTIONS[selectedIndex];
  return action && name === "space" ? (action.key as ActionKey) : null;
}

function formatPermissionCommand(req: PermissionRequest): string {
  const patterns = req.patterns?.join(" ") ?? "";
  return `${req.permission} ${patterns}`.trim();
}

function truncatePermissionCommand(cmd: string, maxLen = 60): string {
  if (cmd.length <= maxLen) {
    return cmd;
  }
  return `${cmd.slice(0, maxLen - 3)}...`;
}

export function buildPermissionDialogViewModel(
  req: PermissionRequest,
  countdown: number,
  selectedIndex = 0,
): PermissionDialogViewModel {
  const risk = RISK_CONFIG[req.riskLevel ?? "medium"];
  return {
    actions: ACTION_OPTIONS.map((opt, i) => ({
      key: opt.key as ActionKey,
      label: opt.label,
      selected: i === selectedIndex,
      shortcut: opt.shortcut,
    })),
    command: truncatePermissionCommand(formatPermissionCommand(req)),
    countdownText: `(${countdown}秒后自动拒绝)`,
    descriptionLine: req.description ? `说明: ${req.description}` : undefined,
    footerHint: "← → 切换 · Enter 确认 · 或直接按快捷键",
    memoryHint: '▪ 选择"始终允许"后，同类操作将不再询问',
    risk,
    title: "权限确认",
    toolLine: `工具: ${req.tool}`,
  };
}

export function PermissionDialog() {
  const eventBus = useEventBus();
  const theme = useTheme();
  const c = theme.colors;
  const [request, setRequest] = createSignal<PermissionRequest | null>(null);
  const [countdown, setCountdown] = createSignal(AUTO_REJECT_SECONDS);
  const [timerId, setTimerId] = createSignal<ReturnType<typeof setInterval> | null>(null);
  const [selectedIndex, setSelectedIndex] = createSignal(0);

  const unsub = eventBus.subscribe(AppEvent.PermissionAsked, (payload) => {
    const nextRequest = {
      description: payload.properties.description,
      external: false,
      id: payload.properties.id,
      patterns: payload.properties.patterns,
      permission: payload.properties.permission,
      riskLevel: payload.properties.riskLevel ?? "medium",
      sessionId: payload.properties.sessionId,
      tool: payload.properties.tool,
    };
    setRequest(nextRequest);
    setCurrentPermissionRequest(buildPermissionRequestSnapshot(nextRequest));
    setCountdown(AUTO_REJECT_SECONDS);
    setSelectedIndex(0);
    setPermissionActive(true);
    startCountdown();
  });
  onCleanup(() => {
    unsub();
    stopCountdown();
  });

  const bridgePollId = setInterval(() => {
    if (request()) {
      return;
    }
    const pending = listPendingExternalPermissionRequests()[0];
    if (!pending) {
      return;
    }
    const nextRequest = {
      description: pending.description,
      external: true,
      id: pending.id,
      patterns: pending.patterns,
      permission: pending.permission,
      riskLevel: pending.riskLevel ?? "medium",
      tool: pending.tool,
    };
    setRequest(nextRequest);
    setCurrentPermissionRequest(buildPermissionRequestSnapshot(nextRequest));
    setCountdown(AUTO_REJECT_SECONDS);
    setSelectedIndex(0);
    setPermissionActive(true);
    startCountdown();
  }, 500);
  onCleanup(() => clearInterval(bridgePollId));

  const startCountdown = () => {
    stopCountdown();
    const id = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          setPermissionActive(false);
          handleReply("reject");
          return AUTO_REJECT_SECONDS;
        }
        return c - 1;
      });
    }, 1000);
    setTimerId(id);
  };

  const stopCountdown = () => {
    const id = timerId();
    if (id) {
      clearInterval(id);
      setTimerId(null);
    }
  };

  const handleReply = (action: ActionKey) => {
    const req = request();
    if (!req) {
      return;
    }
    stopCountdown();
    setPermissionActive(false);
    if (req.external) {
      resolveExternalPermissionRequest(req.id, action);
    } else {
      eventBus.publish(AppEvent.PermissionResolved, {
        action,
        allowed: action !== "reject",
        id: req.id,
      });
    }
    setRequest(null);
  };

  useKeyboard((event) => {
    if (!request()) {
      return;
    }
    const idx = selectedIndex();
    if (event.name === "left" || event.name === "up") {
      setSelectedIndex(idx > 0 ? idx - 1 : ACTION_OPTIONS.length - 1);
      event.stopPropagation();
      return;
    }
    if (event.name === "right" || event.name === "down") {
      setSelectedIndex(idx < ACTION_OPTIONS.length - 1 ? idx + 1 : 0);
      event.stopPropagation();
      return;
    }
    const resolved = resolvePermissionDialogAction(event, idx);
    if (resolved === "confirm") {
      const action = ACTION_OPTIONS[idx];
      if (action) {
        handleReply(action.key as ActionKey);
      }
      event.stopPropagation();
      return;
    }
    if (resolved) {
      handleReply(resolved);
      event.stopPropagation();
    }
  });

  return (
    <Show when={request() !== null}>
      {(_r: any) => {
        const req = request()!;
        const vm = buildPermissionDialogViewModel(req, countdown(), selectedIndex());

        return (
          <box
            flexDirection="column"
            border={true}
            borderStyle="double"
            borderColor={c.warning}
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            paddingBottom={1}
            width={70}
            gap={1}
          >
            {/* 标题 */}
            <box flexDirection="row" justifyContent="space-between">
              <FeedbackLine tone="warning" title={vm.title} message="工具请求执行权限" />
              <text fg={c.muted}>{vm.countdownText}</text>
            </box>

            {/* 风险级别 */}
            <text fg={c[vm.risk.color]}>{`风险级别: ${vm.risk.icon} ${vm.risk.label}`}</text>

            {/* 工具信息 */}
            <text fg={c.text}>{vm.toolLine}</text>

            {/* 命令 */}
            <box flexDirection="column" gap={1}>
              <text fg={c.muted}>{"命令:"}</text>
              <box borderStyle="single" borderColor={c.muted} paddingLeft={1} paddingRight={1} width={68}>
                <text fg={c.text}>{vm.command}</text>
              </box>
            </box>

            {/* 描述 */}
            <Show when={vm.descriptionLine}>
              <text fg={c.muted}>{vm.descriptionLine}</text>
            </Show>

            {/* 权限记忆提示 */}
            <text fg={c.info}>{vm.memoryHint}</text>

            {/* 操作按钮 */}
            <box flexDirection="row" gap={2}>
              {vm.actions.map((opt) => {
                const { selected } = opt;
                return (
                  <box
                    border={true}
                    borderStyle={selected ? "double" : "single"}
                    borderColor={selected ? c.primary : c.muted}
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={selected ? c.primary : undefined}
                    {...({} as any)}
                  >
                    <text fg={selected ? theme.selectedForeground(c.primary) : c.muted} {...({} as any)}>
                      <Show when={selected}>
                        <b>{`[${opt.shortcut}] ${opt.label}`}</b>
                      </Show>
                      <Show when={!selected}>{`[${opt.shortcut}] ${opt.label}`}</Show>
                    </text>
                  </box>
                );
              })}
            </box>

            {/* 提示 */}
            <text fg={c.muted}>{vm.footerHint}</text>
          </box>
        );
      }}
    </Show>
  );
}
