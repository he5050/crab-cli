/**
 * TaskPanel 组件
 *
 * 职责:
 *   - 提供任务和目标管理界面，显示异步任务和 Goal 执行状态
 *   - 支持 Tab 切换查看任务列表和目标列表
 *
 * 模块功能:
 *   - 任务列表:显示任务状态、持续时间、Token 使用量、错误信息
 *   - Goal 列表:显示目标状态、进度条、Token 预算使用情况
 *   - 自动刷新运行中任务的持续时间(每 2 秒)
 *   - 支持键盘快捷键切换 Tab 和关闭面板
 *
 * 使用场景:
 *   - 用户需要查看正在运行的异步任务时
 *   - 需要监控 Goal 执行进度和 Token 消耗时
 *   - 需要查看任务执行结果或错误信息时
 *
 * 边界:
 *   1. 任务状态:○ pending / ⏳ running / ✓ completed / ✗ failed / ⊘ cancelled
 *   2. Goal 状态:⏳ pursuing / ⏸ paused / ✓ achieved / ✗ unmet / ⚠ budget-limited
 *   3. 自动刷新间隔固定为 2 秒
 *   4. 显示最大宽度限制为 70 字符
 *
 * 流程:
 *   1. 订阅 TaskPanelShow 事件显示面板
 *   2. 定时刷新任务列表和 Goal 列表
 *   3. 按 1 切换到任务 Tab，按 2 切换到 Goal Tab
 *   4. 按 Esc 或 q 关闭面板
 */
import { createSignal, onCleanup } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { taskManager, goalManager } from "@mission";
import { useEventBus } from "@/ui/contexts/eventBus";
import { AppEvent } from "@bus";
import type { AsyncTask, GoalRecord, GoalStatus, TaskStatus } from "@/mission/type";
import { useTheme } from "@/ui/contexts/theme";
import { createStatusColorMap } from "@/ui/utils/statusColors";
import { iconError, iconIdle, iconLoading, iconLsp, iconPause, iconSuccess, iconWarning } from "@/ui/utils/icon";

interface TaskPanelProps {
  onClose?: () => void;
}

// ─── 状态图标与颜色 ─────────────────────────────────────────

function taskIcon(status: TaskStatus): string {
  switch (status) {
    case "pending": {
      return iconIdle;
    }
    case "running": {
      return iconLoading;
    }
    case "completed": {
      return iconSuccess;
    }
    case "failed": {
      return iconError;
    }
    case "cancelled": {
      return "⊘";
    }
  }
}

function taskColor(status: TaskStatus, colors: any): string {
  return createStatusColorMap<TaskStatus>(
    {
      cancelled: colors.muted,
      completed: colors.success,
      failed: colors.error,
      pending: colors.muted,
      running: colors.warning,
    },
    colors.muted,
  )(status);
}

function goalIcon(status: GoalStatus): string {
  switch (status) {
    case "pursuing": {
      return iconLoading;
    }
    case "paused": {
      return iconPause;
    }
    case "achieved": {
      return iconSuccess;
    }
    case "unmet": {
      return iconError;
    }
    case "budget-limited": {
      return iconWarning;
    }
    case "cleared": {
      return "⊘";
    }
  }
}

function goalColor(status: GoalStatus, colors: any): string {
  return createStatusColorMap<GoalStatus>(
    {
      achieved: colors.success,
      "budget-limited": colors.warning,
      paused: colors.muted,
      pursuing: colors.warning,
      unmet: colors.error,
    },
    colors.muted,
  )(status);
}

/** 格式化时间 */
function fmtTime(ts?: number): string {
  if (!ts) {
    return "-";
  }
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
}

/** 格式化持续时间 */
function fmtDuration(startMs?: number, endMs?: number): string {
  if (!startMs) {
    return "-";
  }
  const end = endMs ?? Date.now();
  const diff = Math.floor((end - startMs) / 1000);
  if (diff < 60) {
    return `${diff}s`;
  }
  if (diff < 3600) {
    return `${Math.floor(diff / 60)}m${diff % 60}s`;
  }
  return `${Math.floor(diff / 3600)}h${Math.floor((diff % 3600) / 60)}m`;
}

/** 截断字符串 */
function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

// ─── 组件 ────────────────────────────────────────────────────

export function TaskPanel(props?: TaskPanelProps) {
  const eventBus = useEventBus();
  const [visible, setVisible] = createSignal(false);
  const [tab, setTab] = createSignal<"tasks" | "goals">("tasks");
  const [tick, setTick] = createSignal(0);
  const theme = useTheme();

  // 订阅 TaskPanelShow 事件
  const unsubShow = eventBus.subscribe(AppEvent.TaskPanelShow, () => {
    setVisible(true);
    setTick((t) => t + 1);
  });

  // 定时刷新(运行中的任务需要更新持续时间)
  const timer = setInterval(() => setTick((t) => t + 1), 2000);
  onCleanup(() => {
    unsubShow();
    clearInterval(timer);
  });

  const handleKey = (key: string) => {
    if (key === "Escape" || key === "q") {
      setVisible(false);
      props?.onClose?.();
      return true;
    }
    if (key === "1") {
      setTab("tasks");
      return true;
    }
    if (key === "2") {
      setTab("goals");
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

  // 获取数据
  const tasks = () => {
    tick();
    return taskManager.list();
  };
  const goals = () => {
    tick();
    return goalManager.loadAllGoals();
  };

  if (!visible()) {
    return null;
  }

  return (
    <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; z-index: 100;">
      <div style="position: absolute; inset: 0; background: rgba(0,0,0,0.5);" />
      <div
        style={`position: relative; margin: auto; max-width: 70; border: 1px solid ${theme.colors.border}; padding: 1 2;`}
      >
        {/* 标题栏 */}
        <div style="bold: true; margin-bottom: 1;">{iconLsp} 任务管理</div>

        {/* Tab 切换 */}
        <div style="margin-bottom: 1;">
          <span
            style={`color: ${tab() === "tasks" ? theme.colors.text : theme.colors.muted}; ${tab() === "tasks" ? "bold: true;" : ""}`}
          >
            [1] 任务 ({tasks().length})
          </span>
          {"  "}
          <span
            style={`color: ${tab() === "goals" ? theme.colors.text : theme.colors.muted}; ${tab() === "goals" ? "bold: true;" : ""}`}
          >
            [2] 目标 ({goals().length})
          </span>
        </div>

        {/* 任务列表 */}
        {tab() === "tasks" &&
          (() => {
            const list = tasks();
            if (list.length === 0) {
              return (
                <div style={`color: ${theme.colors.muted}; padding: 1;`}>暂无任务。使用 /loop 或 Goal 工具创建。</div>
              );
            }
            return (
              <div>
                {list.map((task: AsyncTask) => (
                  <div style="margin-bottom: 1; padding-left: 1;">
                    <span style={`color: ${taskColor(task.status, theme.colors)};`}>{taskIcon(task.status)}</span>{" "}
                    <span style="bold: true;">{task.id}</span>
                    <span style={`color: ${theme.colors.muted};`}>
                      {" "}
                      — {fmtDuration(task.startedAt, task.completedAt)}
                    </span>
                    <div style={`padding-left: 2; color: ${theme.colors.muted};`}>{truncate(task.prompt, 55)}</div>
                    {/* Token 使用量 */}
                    {task.tokenUsage && (
                      <div style={`padding-left: 2; color: ${theme.colors.muted};`}>
                        tokens: {task.tokenUsage.input}in / {task.tokenUsage.output}out
                      </div>
                    )}
                    {/* 错误 */}
                    {task.error && (
                      <div style={`padding-left: 2; color: ${theme.colors.error};`}>
                        {iconError} {truncate(task.error, 50)}
                      </div>
                    )}
                    {/* 结果预览 */}
                    {task.result && (
                      <div style={`padding-left: 2; color: ${theme.colors.success};`}>{truncate(task.result, 50)}</div>
                    )}
                  </div>
                ))}

                {/* 汇总 */}
                <div
                  style={`color: ${theme.colors.muted}; margin-top: 1; border-top: 1px solid ${theme.colors.border}; padding-top: 1;`}
                >
                  运行中: {taskManager.runningCount()} / 总计: {list.length}
                </div>
              </div>
            );
          })()}

        {/* Goal 列表 */}
        {tab() === "goals" &&
          (() => {
            const list = goals();
            if (list.length === 0) {
              return (
                <div style={`color: ${theme.colors.muted}; padding: 1;`}>暂无目标。使用 /loop 或 /goal 创建。</div>
              );
            }
            return (
              <div>
                {list.map((goal: GoalRecord) => {
                  const budget = goal.tokenBudget ?? 2_000_000;
                  const pct = budget > 0 ? Math.min(100, (goal.tokensUsed / budget) * 100) : 0;
                  return (
                    <div style="margin-bottom: 1; padding-left: 1;">
                      <span style={`color: ${goalColor(goal.status, theme.colors)};`}>{goalIcon(goal.status)}</span>{" "}
                      <span style="bold: true;">{goal.id}</span>
                      <span style={`color: ${theme.colors.muted};`}> — {goal.status}</span>
                      <div style={`padding-left: 2; color: ${theme.colors.muted};`}>{truncate(goal.objective, 55)}</div>
                      {/* 进度条 */}
                      <div style="padding-left: 2;">
                        <span style={`color: ${theme.colors.muted};`}>
                          轮次: {goal.runCount} | tokens: {goal.tokensUsed}/{budget} ({pct.toFixed(1)}%)
                        </span>
                      </div>
                      {/* 文本进度条 */}
                      <div style="padding-left: 2;">
                        {"▕"}
                        {(() => {
                          const filled = Math.floor(pct / 5);
                          const empty = 20 - filled;
                          return "█".repeat(filled) + "░".repeat(empty);
                        })()}
                        {"▏"}
                      </div>
                      {/* 说明 */}
                      {goal.lastExplanation && (
                        <div style={`padding-left: 2; color: ${theme.colors.muted};`}>
                          {truncate(goal.lastExplanation, 50)}
                        </div>
                      )}
                      {/* 时间 */}
                      <div style={`padding-left: 2; color: ${theme.colors.muted};`}>
                        创建: {fmtTime(goal.createdAt)} | 更新: {fmtTime(goal.updatedAt)}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}

        {/* 底部提示 */}
        <div style={`color: ${theme.colors.muted}; margin-top: 1;`}>1/2 切换 Tab | Esc 返回</div>
      </div>
    </div>
  );
}
