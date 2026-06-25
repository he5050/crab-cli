/**
 * TeamPanel
 *
 * 职责:
 *   - 显示 Team 中所有队友的状态和任务信息
 *   - 展示队友角色、任务摘要、执行结果
 *   - 显示共享任务列表
 *
 * 模块功能:
 *   - 渲染队友列表(状态图标、名称、角色、任务)
 *   - 状态展示:pending / running / completed / failed
 *   - 显示队友执行结果或错误信息
 *   - 展示共享任务列表及状态
 *   - 支持键盘交互(Esc/q 关闭)
 *
 * 使用场景:
 *   - 用户需要查看 Team 成员工作状态时
 *   - 监控多代理任务执行进度时
 *   - 查看队友任务执行结果时
 *
 * 边界:
 *   1. 队友数据通过 teamExecutor 获取，组件不管理状态
 *   2. 通过 EventBus 订阅 TeamPanelShow 事件显示面板
 *   3. 不处理队友创建或任务分配，仅做展示
 *   4. 任务结果为截断显示(最多 60 字符)
 *
 * 流程:
 *   1. 订阅 TeamPanelShow 事件，触发时显示面板
 *   2. 从 teamExecutor 获取队友列表和共享任务
 *   3. 渲染队友信息(状态图标、名称、角色、任务)
 *   4. 根据状态显示不同的结果或错误信息
 *   5. 渲染共享任务列表
 *   6. 按 Esc 或 q 关闭面板
 */
import { createSignal, onCleanup } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { teamExecutor } from "@/agent/team";
import type { Teammate } from "@/agent/team/type";
import { useEventBus } from "@/ui/contexts/eventBus";
import { AppEvent } from "@bus";
import { teammateStatusIcon } from "@/core/icons/iconDerived";
import { iconSuccess, iconError, iconLoading, iconIdle } from "@/core/icons/icon";
import { useTheme } from "@/ui/contexts/theme";
import { createStatusColorMap } from "@/ui/utils/statusColors";
import { iconTeam } from "@/ui/utils/icon";

interface TeamPanelProps {
  onClose?: () => void;
}

/** 状态图标 — 已迁 @core/iconDerived.teammateStatusIcon */

/** 状态颜色 — 使用主题变量 */
function statusColor(status: Teammate["status"], colors: any): string {
  return createStatusColorMap<Teammate["status"]>(
    {
      completed: colors.success,
      failed: colors.error,
      pending: colors.muted,
      running: colors.warning,
    },
    colors.muted,
  )(status);
}

export function TeamPanel(props?: TeamPanelProps) {
  const eventBus = useEventBus();
  const [visible, setVisible] = createSignal(false);
  const theme = useTheme();

  const getTeammates = () => teamExecutor.listTeammates();

  // 订阅 TeamPanelShow 事件
  const unsub = eventBus.subscribe(AppEvent.TeamPanelShow, () => {
    setVisible(true);
  });
  onCleanup(() => unsub());

  const handleKey = (key: string) => {
    if (key === "Escape" || key === "q") {
      setVisible(false);
      props?.onClose?.();
      return true;
    }
    return false;
  };

  useKeyboard((event) => {
    if (!event.name) {
      return;
    }
    const handled = handleKey(event.name);
    if (handled) {
      event.stopPropagation?.();
    }
  });

  const teammates = getTeammates();

  if (!visible()) {
    return null;
  }

  return (
    <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; z-index: 100;">
      <div style="position: absolute; inset: 0; background: rgba(0,0,0,0.5);" />
      <div
        style={`position: relative; margin: auto; max-width: 70; border: 1px solid ${theme.colors.border}; padding: 1 2;`}
      >
        <div style="bold: true; margin-bottom: 1;">
          {iconTeam} Team ({teammates.length} 队友)
        </div>

        {teammates.length === 0 && (
          <div style={`color: ${theme.colors.muted}; padding: 1;`}>暂无队友。AI 会自动创建队友。</div>
        )}

        {teammates.map((mate) => (
          <div style="margin-bottom: 1;">
            <span style={`color: ${statusColor(mate.status, theme.colors)};`}>{teammateStatusIcon(mate.status)}</span>{" "}
            <span style="bold: true;">{mate.name}</span>
            <span style="color: ${theme.colors.muted};"> — {mate.role}</span>
            <div style="padding-left: 2; color: ${theme.colors.muted};">任务: {mate.task}</div>
            {mate.status === "completed" && mate.result && (
              <div style="padding-left: 2; color: ${theme.colors.success};">
                {iconSuccess} {mate.result.slice(0, 60)}
              </div>
            )}
            {mate.status === "failed" && mate.error && (
              <div style="padding-left: 2; color: ${theme.colors.error};">
                {iconError} {mate.error.slice(0, 60)}
              </div>
            )}
          </div>
        ))}

        {/* 共享任务 */}
        {(() => {
          const tasks = teamExecutor.getTaskList().list();
          if (tasks.length === 0) {
            return null;
          }
          return (
            <div style={`margin-top: 1; border-top: 1px solid ${theme.colors.border}; padding-top: 1;`}>
              <div style={`color: ${theme.colors.muted};`}>共享任务:</div>
              {tasks.map((task) => (
                <div style="padding-left: 1;">
                  <span
                    style={`color: ${task.status === "completed" ? theme.colors.success : task.status === "failed" ? theme.colors.error : task.status === "in-progress" ? theme.colors.warning : theme.colors.muted};`}
                  >
                    {task.status === "completed"
                      ? iconSuccess
                      : task.status === "failed"
                        ? iconError
                        : task.status === "in-progress"
                          ? iconLoading
                          : iconIdle}
                  </span>{" "}
                  {(task.description ?? task.title ?? "").slice(0, 40)}
                </div>
              ))}
            </div>
          );
        })()}

        <div style={`color: ${theme.colors.muted}; margin-top: 1;`}>Esc 返回</div>
      </div>
    </div>
  );
}
