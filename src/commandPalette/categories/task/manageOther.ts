/**
 * 任务 + 管理 + 其他 + 界面命令。
 *
 * 职责:
 *   - 提供任务管理命令(循环、深度研究、BTW、新提示、目标等)
 *   - 提供管理命令(技能管理、技能选择器、待办选择器等)
 *   - 提供其他实用命令(混合压缩、复制、Pixel 编辑器等)
 *   - 提供界面命令(主题选择)
 *
 * 模块功能:
 *   - buildTaskManageOtherCommands: 构建任务、管理、其他和界面命令
 *   - task.loop: 任务循环
 *   - task.deep-research: 深度研究
 *   - task.btw: BTW 快速任务
 *   - task.new-prompt: 新提示
 *   - task.goal: 设置目标
 *   - task.goal-list: 目标列表
 *   - task.panel: 任务面板
 *   - manage.skill: 技能管理
 *   - manage.skill-picker: 技能选择器
 *   - manage.todo-picker: 待办选择器
 *   - manage.todo-list: 待办列表
 *   - manage.team-status: Team 状态
 *   - other.hybrid-compact: 混合压缩
 *   - other.copy: 复制内容
 *   - other.pixel-editor: Pixel 编辑器
 *   - ui.theme: 主题选择
 *
 * 使用场景:
 *   - 用户需要创建循环任务
 *   - 用户需要管理技能和待办
 *   - 用户需要切换主题
 *   - 用户需要执行其他辅助操作
 *
 * 边界:
 *   1. 任务命令依赖 task 模块
 *   2. 管理命令依赖 manage 模块
 *   3. 界面命令依赖 UI 模块
 *   4. 部分命令需要特定的上下文或配置
 *
 * 流程:
 *   1. 接收 CommandDeps 依赖
 *   2. 构建任务、管理、其他和界面命令数组
 *   3. 各命令调用对应模块的功能
 *   4. 通过 EventBus 通知状态变更
 */
import type { Command } from "@/commandPalette/types";
import type { CommandDeps } from "../../shared";
import { getAppConfig } from "../../shared";
import { globalBus, type EventBus } from "@/bus";
import { AppEvent } from "@/bus";
import { createId } from "@/core/identity";
import { handleTodoPickerCommand } from "./todoPicker";
import {
  asciiTimer,
  iconLoading,
  iconPause,
  iconSettings,
  iconTasks,
  symCheck,
  symCross,
  symDot,
  toolGit,
} from "@/core/icons/icon";

export function buildTaskManageOtherCommands(deps: CommandDeps, eventBus: EventBus = globalBus): Command[] {
  return [
    // ─── 任务命令 ────────────────────────────────────────
    {
      category: "任务",
      description: "创建定时循环任务(/loop 5m 提示词)或 Goal 循环(/loop 目标描述)",
      name: "task.loop",
      run: async (args) => {
        const trimmed = args?.trim();
        if (!trimmed) {
          deps.showToast?.("用法: /loop <5m/1h/30s 提示词> 或 /loop <目标描述>", "info");
          return;
        }

        try {
          // 尝试解析为定时 Loop
          const { parseLoopSchedule, loopManager } = await import("@mission");
          const schedule = parseLoopSchedule(trimmed);
          if (schedule) {
            // 定时 Loop 模式
            const loop = loopManager.createLoop(schedule);
            const config = deps.getConfig?.();
            if (!config) {
              deps.showToast?.("创建 Loop 失败", "error");
              return;
            }
            loopManager.startLoop(loop.id, config as import("@/schema/config").AppConfigSchema);
            deps.showToast?.(
              `Loop 已创建: ${loop.id} (${loop.intervalLabel})\n下次执行: ${new Date(loop.nextRunAt).toLocaleString()}`,
              "success",
            );
            return;
          }

          // 否则视为 Goal 创建
          const { goalManager } = await import("@mission");
          const sessionId = deps.getCurrentSessionId?.() ?? `loop_${Date.now()}`;
          const goal = goalManager.createGoal({ objective: trimmed, sessionId });
          deps.showToast?.(`目标已创建: ${goal.id}(Ralph Loop 模式)`, "success");
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          deps.showToast?.(msg ?? "创建失败", "error");
        }
      },
      slashName: "loop",
      title: "任务循环",
    },
    {
      category: "任务",
      description: "执行多步深度研究，自动搜索并生成报告保存到 .crab/deepresearch/",
      name: "task.deepResearch",
      run: async (args) => {
        const query = args?.trim();
        if (!query) {
          deps.showToast?.("用法: /deep-research <研究主题>", "info");
          return;
        }

        const config = getAppConfig(deps);
        if (!config) {
          deps.showToast?.("无法获取配置", "error");
          return;
        }

        deps.showToast?.(`开始深度研究: ${query}`, "info");

        try {
          const { executeDeepResearch } = await import("@/tool/deepResearch");

          // 异步执行，通过 toast 和 event 报告进度
          executeDeepResearch(query, config, (progress) => {
            if (progress.action === "done") {
              deps.showToast?.(`深度研究完成: ${progress.message}`, "success");
              eventBus.publish(AppEvent.Log, { level: "info", message: progress.message });
            } else if (progress.action === "error") {
              deps.showToast?.(`深度研究失败: ${progress.message}`, "error");
            } else {
              deps.showToast?.(`[${progress.round}/${progress.totalRounds}] ${progress.message}`, "info");
            }
          }).catch((error) => {
            const msg = error instanceof Error ? error.message : String(error);
            deps.showToast?.(`深度研究失败: ${msg}`, "error");
          });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          deps.showToast?.(`深度研究启动失败: ${msg}`, "error");
        }
      },
      slashName: "deep-research",
      title: "深度研究",
    },
    {
      category: "任务",
      description: "在对话中顺便执行小任务(流式回答，不加入上下文历史)",
      name: "task.btw",
      run: async (args?: string) => {
        const task = args?.trim();
        if (!task) {
          deps.showToast?.("用法: /btw <问题> — 流式回答 side-question，不写入对话历史", "info");
          return;
        }

        try {
          const config = getAppConfig(deps);
          if (!config) {
            deps.showToast?.("配置不可用", "error");
            return;
          }

          // 获取当前对话历史(优先从 deps，否则从 DB 加载)
          const history = deps.getConversationHistory?.() ?? [];

          const { executeBtwStream } = await import("@/conversation/stream/btwStream");

          // 异步执行流式 btw，通过 EventBus 分发流事件
          executeBtwStream(task, config, history).catch((error) => {
            const msg = error instanceof Error ? error.message : String(error);
            deps.showToast?.(`BTW 执行失败: ${msg}`, "error");
          });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          deps.showToast?.(`BTW 执行失败: ${msg}`, "error");
        }
      },
      slashAliases: ["btwStream"],
      slashName: "btw",
      title: "顺便执行",
    },
    {
      category: "任务",
      description: "使用预设提示新建会话(/new-prompt <提示词>)",
      name: "task.newPrompt",
      run: async (args?: string) => {
        const prompt = args?.trim();
        if (!prompt) {
          deps.showToast?.("用法: /new-prompt <提示词> — 使用指定提示词创建新会话", "info");
          return;
        }

        try {
          // 创建新会话
          const sessionId = createId("ses");
          const { ensureSession } = await import("@session");
          const config = getAppConfig(deps);

          ensureSession(sessionId, {
            model: config?.defaultProvider?.model ?? "",
            projectDir: process.cwd(),
          });

          // 导航到新会话
          eventBus.publish(AppEvent.SessionCreated, { sessionId });
          deps.navigate({ sessionId, type: "session" });

          // 发送预设提示词
          setTimeout(() => {
            eventBus.publish(AppEvent.ConversationMessageSent, {
              content: prompt,
              role: "user",
              sessionId,
            });
          }, 300);

          deps.showToast?.("已使用预设提示创建新会话", "success");
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          deps.showToast?.(`创建会话失败: ${msg}`, "error");
        }
      },
      slashName: "new-prompt",
      title: "新提示",
    },
    {
      category: "任务",
      description: "为当前会话设定目标(pause/resume/clear/status/resume-id)",
      name: "task.goal",
      run: async (args) => {
        try {
          const { goalManager } = await import("@mission");
          const sessionId = deps.getCurrentSessionId?.() ?? `session_current`;
          if (!args?.trim()) {
            const goal = goalManager.loadGoal(sessionId);
            if (goal) {
              deps.showToast?.(goalManager.formatSummary(goal), "info");
            } else {
              deps.showToast?.("用法: /goal <目标> | pause | resume | clear | status | resume <goalId>", "info");
            }
            return;
          }
          const trimmed = args.trim();
          const arg = trimmed.toLowerCase();

          // /goal resume <goalId> — 跨会话恢复
          const resumeIdMatch = trimmed.match(/^resume\s+([a-f0-9]{8,})$/i);
          if (resumeIdMatch) {
            const goalId = resumeIdMatch[1]!;
            const result = goalManager.resumeGoalForSession(goalId, sessionId);
            deps.showToast?.(
              result ? `目标已恢复并关联: ${result.id}` : "未找到可恢复的目标",
              result ? "success" : "warning",
            );
            return;
          }

          if (arg === "pause") {
            const result = goalManager.pauseGoal(sessionId);
            deps.showToast?.(result ? `目标已暂停: ${result.id}` : "没有活跃目标", result ? "success" : "warning");
          } else if (arg === "resume") {
            const result = goalManager.resumeGoal(sessionId);
            deps.showToast?.(result ? `目标已恢复: ${result.id}` : "没有暂停的目标", result ? "success" : "warning");
          } else if (arg === "clear") {
            const result = goalManager.clearGoal(sessionId);
            deps.showToast?.(result ? `目标已清除: ${result.id}` : "没有目标", result ? "success" : "warning");
          } else if (arg === "status") {
            const goal = goalManager.loadGoal(sessionId);
            deps.showToast?.(goal ? goalManager.formatSummary(goal) : "没有活跃目标", "info");
          } else {
            const goal = goalManager.createGoal({ objective: trimmed, sessionId });
            deps.showToast?.(`目标已创建: ${goal.id}(Ralph Loop 模式)`, "success");
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          deps.showToast?.(msg ?? "创建失败", "error");
        }
      },
      slashName: "goal",
      title: "设定目标",
    },
    {
      category: "任务",
      description: "查看所有目标",
      name: "task.goalList",
      run: async () => {
        try {
          const { goalManager } = await import("@mission");
          const goals = goalManager.loadAllGoals();
          if (goals.length === 0) {
            deps.showToast?.("没有目标记录", "info");
            return;
          }
          const lines = goals.map((g) => {
            const statusIcon =
              g.status === "pursuing"
                ? iconLoading
                : g.status === "achieved"
                  ? symCheck
                  : g.status === "paused"
                    ? iconPause
                    : symCross;
            return `${statusIcon} ${g.objective.slice(0, 60)} (${g.id}, ${g.status})`;
          });
          deps.showToast?.(lines.join("\n"), "info");
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          deps.showToast?.(`获取目标列表失败: ${msg}`, "error");
        }
      },
      slashName: "goal-list",
      title: "目标列表",
    },
    {
      category: "任务",
      description: "浏览可恢复目标并选择恢复(/goal-picker [resume <id>])",
      name: "task.goalPicker",
      run: async (args) => {
        try {
          const { goalManager } = await import("@mission");
          const trimmed = args?.trim();
          const resumeMatch = trimmed?.match(/^resume\s+([a-f0-9]{8,})$/i);
          if (resumeMatch) {
            const goalId = resumeMatch[1]!;
            const sessionId = deps.getCurrentSessionId?.() ?? `session_current`;
            const result = goalManager.resumeGoalForSession(goalId, sessionId);
            deps.showToast?.(
              result ? `目标已恢复: ${result.id}` : "未找到可恢复的目标",
              result ? "success" : "warning",
            );
            return;
          }

          const goals = goalManager.loadAllGoals();
          const resumable = goals.filter(
            (g) => g.status === "pursuing" || g.status === "paused" || g.status === "budget-limited",
          );
          if (resumable.length === 0) {
            deps.showToast?.("没有可恢复的目标(需要 pursuing/paused/budget-limited 状态)", "info");
            return;
          }

          const statusIcon: Record<string, string> = {
            "budget-limited": asciiTimer,
            paused: iconPause,
            pursuing: iconLoading,
          };
          const lines = [
            "🎯 目标选择器(可恢复)",
            "",
            ...resumable.map((g, i) => {
              const icon = statusIcon[g.status] ?? iconLoading;
              return `  ${i + 1}. ${icon} ${g.objective.slice(0, 50)} (id=${g.id}, ${g.status})`;
            }),
            "",
            "用法:",
            "  /goal-picker — 列出可恢复目标",
            "  /goal-picker resume <goalId> — 恢复指定目标到当前会话",
          ];

          eventBus.publish(AppEvent.Log, { level: "info", message: lines.join("\n") });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          deps.showToast?.(`目标选择器失败: ${msg}`, "error");
        }
      },
      slashName: "goal-picker",
      title: "目标选择器",
    },
    {
      category: "任务",
      description: "打开任务管理面板(查看任务和目标)",
      name: "task.panel",
      run: () => {
        eventBus.publish(AppEvent.TaskPanelShow, {});
      },
      slashName: "tasks",
      title: "任务面板",
    },

    // ─── 管理命令 ────────────────────────────────────────
    {
      category: "管理",
      description: "查看队友状态和共享任务列表",
      name: "team.status",
      run: () => {
        eventBus.publish(AppEvent.TeamPanelShow, {});
      },
      slashName: "team-status",
      title: "Team 状态面板",
    },
    {
      category: "管理",
      description: "管理自定义技能(list/enable/disable/reload)",
      name: "manage.skills",
      run: async (args?: string) => {
        const { skillManager } = await import("@/extension/skill");
        const action = args?.trim() || "list";

        switch (action) {
          case "list": {
            const skills = skillManager.listVisible();
            const disabled = skillManager.getDisabledList();
            const lines = [
              `${toolGit} 技能列表 (${skills.length} 个可用)`,
              "",
              "【已启用】",
              ...skills.map((s) => `  ${symCheck} ${s.name} — ${s.description || "无描述"}`),
              "",
            ];
            if (disabled.length > 0) {
              lines.push("【已禁用】");
              lines.push(...disabled.map((n) => `  ${symCross} ${n}`));
              lines.push("");
            }
            lines.push("用法: /manage-skills [list|enable <name>|disable <name>|reload]");
            eventBus.publish(AppEvent.Log, { level: "info", message: lines.join("\n") });
            break;
          }
          case "reload": {
            await skillManager.reload();
            deps.showToast?.("技能列表已重新加载", "success");
            break;
          }
          default: {
            // Enable/disable <name>
            const match = action.match(/^(enable|disable)\s+(\S+)$/);
            if (match) {
              const [, cmd, rawName] = match;
              const name = rawName ?? "";
              if (cmd === "enable") {
                const ok = skillManager.enable(name);
                deps.showToast?.(
                  ok ? `已启用技能: ${name}` : `技能未禁用或不存在: ${name}`,
                  ok ? "success" : "warning",
                );
              } else {
                const ok = skillManager.disable(name);
                deps.showToast?.(ok ? `已禁用技能: ${name}` : `技能不存在: ${name}`, ok ? "success" : "warning");
              }
            } else {
              deps.showToast?.("用法: /manage-skills [list|enable <name>|disable <name>|reload]", "info");
            }
          }
        }
      },
      slashName: "manage-skills",
      title: "技能管理",
    },
    {
      category: "管理",
      description: "浏览和选择技能(/skills-picker [category])",
      name: "manage.skillsPicker",
      run: async (args?: string) => {
        const { skillManager } = await import("@/extension/skill");
        const category = args?.trim();
        const grouped = skillManager.listGrouped();

        if (grouped.size === 0) {
          deps.showToast?.("暂无可用技能", "info");
          return;
        }

        const lines: string[] = ["🎯 技能选择器", ""];

        for (const [cat, skills] of grouped) {
          if (category && cat !== category) {
            continue;
          }
          lines.push(`【${cat}】`);
          for (const s of skills) {
            lines.push(`  /skill ${s.name} — ${s.description || "无描述"}`);
          }
          lines.push("");
        }

        lines.push("用法:");
        lines.push("  /skills-picker — 列出所有技能");
        lines.push("  /skills-picker <category> — 按分类筛选");
        lines.push("  /skill <name> — 执行指定技能");

        eventBus.publish(AppEvent.Log, { level: "info", message: lines.join("\n") });
      },
      slashName: "skills-picker",
      title: "技能选择器",
    },
    {
      category: "管理",
      description: "浏览和选择待办模板(/todo-picker [template])",
      name: "manage.todoPicker",
      run: async (args?: string) => {
        await handleTodoPickerCommand(args, deps);
      },
      slashName: "todo-picker",
      title: "待办选择器",
    },
    {
      category: "管理",
      description: "查看和管理待办列表(/todo-list [filter])",
      name: "manage.todoList",
      run: async (args?: string) => {
        const { todoUltraTool } = await import("@/tool/todo");
        const filter = args?.trim() || "all";

        const result = await todoUltraTool.execute({
          action: "list",
          filter: filter as "all" | "completed" | "pending" | "in_progress",
          scanProject: true,
        });
        const todoResult = result as { success?: boolean; error?: string; items?: unknown[]; scannedCount?: number };

        if (!todoResult.success) {
          deps.showToast?.(`获取待办列表失败: ${todoResult.error ?? "未知错误"}`, "error");
          return;
        }

        const items = (todoResult.items ?? []) as {
          status?: string;
          content?: string;
          id?: string;
          priority?: string;
          filePath?: string;
          line?: number;
        }[];
        if (items.length === 0 && (todoResult.scannedCount ?? 0) === 0) {
          deps.showToast?.("暂无待办事项", "info");
          return;
        }

        const statusIcon: Record<string, string> = {
          completed: iconTasks,
          in_progress: symDot,
          pending: iconLoading,
        };

        const lines = [
          `📋 待办列表 (${items.length} 项)`,
          "",
          ...items.map((item) => {
            const icon = item.status ? statusIcon[item.status] || iconLoading : iconLoading;
            const priority = item.priority ? `[${item.priority.toUpperCase()}] ` : "";
            const location = item.filePath ? ` @ ${item.filePath}${item.line ? `:${item.line}` : ""}` : "";
            return `  ${icon} ${priority}${item.content}${location}`;
          }),
          "",
          `扫描 TODO 注释: ${todoResult.scannedCount ?? 0} 项`,
          "",
          "用法:",
          "  /todo-list — 列出所有待办",
          "  /todo-list pending — 只看待处理",
          "  /todo-list completed — 只看已完成",
          "  /todo <内容> — 添加新待办",
        ];

        eventBus.publish(AppEvent.Log, { level: "info", message: lines.join("\n") });
      },
      slashName: "todo-list",
      title: "待办列表",
    },

    // ─── 其他命令 ────────────────────────────────────────
    {
      category: "其他",
      description: "复制 AI 上一条回复到剪贴板",
      name: "other.copyLast",
      run: () => {
        eventBus.publish(AppEvent.CopyLastMessage, {});
      },
      slashName: "copy-last", // 保持 slash 命名不变，非事件名
      suggested: true,
      title: "复制上条回复",
    },
    {
      category: "其他",
      description: "打开终端像素画编辑器",
      name: "other.pixel",
      run: () => {
        deps.navigate({ type: "pixel-editor" });
      },
      slashName: "pixel",
      suggested: true,
      title: "Pixel 编辑器",
    },
    {
      category: "其他",
      description: "执行自定义命令(/custom <name> [args])",
      name: "other.custom",
      run: async (args?: string) => {
        const input = args?.trim();
        if (!input) {
          const lines = [
            `${iconSettings} 自定义命令`,
            "",
            "用法: /custom <命令名> [参数]",
            "",
            "示例:",
            "  /custom hello — 执行 hello 命令",
            "  /custom echo hello world — 执行 echo 并传递参数",
            "",
            "自定义命令允许你快速执行预定义的脚本或操作。",
            "可以通过 ~/.crab/custom-commands.json 配置自定义命令。",
          ];
          eventBus.publish(AppEvent.Log, { level: "info", message: lines.join("\n") });
          return;
        }

        // 解析命令和参数
        const parts = input.split(/\s+/);
        const cmdName = parts[0];
        const cmdArgs = parts.slice(1).join(" ");

        // 加载自定义命令配置
        const { getCrabDir } = await import("@config");
        const { existsSync, readFileSync } = await import("node:fs");
        const { join } = await import("node:path");

        const configPath = join(getCrabDir(), "custom-commands.json");
        const customCommands: Record<string, { type: string; command: string; description?: string }> = {};

        if (existsSync(configPath)) {
          try {
            const data = JSON.parse(readFileSync(configPath, "utf8"));
            const raw = data.commands || {};
            // 校验每个自定义命令的结构
            for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
              if (typeof val !== "object" || val === null) {
                deps.showToast?.(`自定义命令 "${key}" 配置格式错误，已跳过`, "warning");
                continue;
              }
              const obj = val as Record<string, unknown>;
              if (typeof obj.type !== "string" || typeof obj.command !== "string") {
                deps.showToast?.(`自定义命令 "${key}" 缺少 type 或 command 字段，已跳过`, "warning");
                continue;
              }
              if (!["echo", "exec", "skill"].includes(obj.type as string)) {
                deps.showToast?.(
                  `自定义命令 "${key}" 的 type "${obj.type}" 不支持(支持: echo/exec/skill)，已跳过`,
                  "warning",
                );
                continue;
              }
              customCommands[key] = {
                command: obj.command as string,
                description: typeof obj.description === "string" ? obj.description : undefined,
                type: obj.type as string,
              };
            }
          } catch (error) {
            deps.showToast?.(
              `自定义命令配置解析失败: ${error instanceof Error ? error.message : String(error)}`,
              "error",
            );
          }
        }

        // 内置自定义命令
        const builtinCustom: Record<string, { type: string; command: string; description?: string }> = {
          hello: { command: "你好！这是自定义命令示例。", description: "示例命令", type: "echo" },
          pwd: { command: "pwd", description: "显示当前目录", type: "exec" },
          time: { command: "date", description: "显示当前时间", type: "exec" },
        };

        const allCommands = { ...builtinCustom, ...customCommands };
        const commandName = cmdName ?? "";
        const cmd = allCommands[commandName];

        if (!cmd) {
          const available = Object.keys(allCommands).join(", ");
          deps.showToast?.(`未知命令: ${commandName}。可用: ${available}`, "warning");
          return;
        }

        // 执行命令
        try {
          switch (cmd.type) {
            case "echo": {
              eventBus.publish(AppEvent.Log, { level: "info", message: cmd.command });
              break;
            }
            case "exec": {
              const { execFileSync } = await import("node:child_process");
              const execArgs: string[] = [...cmd.command.split(/\s+/), ...cmdArgs.split(/\s+/)].filter(Boolean);
              const result = execFileSync(execArgs[0]!, execArgs.slice(1), {
                cwd: process.cwd(),
                encoding: "utf8",
              });
              eventBus.publish(AppEvent.Log, { level: "info", message: result.trim() });
              break;
            }
            case "skill": {
              eventBus.publish(AppEvent.Log, { level: "info", message: `执行 Skill: ${cmd.command}` });
              // 可以触发 skill 执行
              break;
            }
            default: {
              deps.showToast?.(`未知命令类型: ${cmd.type}`, "error");
            }
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          deps.showToast?.(`命令执行失败: ${msg}`, "error");
        }
      },
      slashName: "custom",
      title: "自定义命令",
    },

    // ─── 界面命令 ────────────────────────────────────────
    {
      category: "界面",
      description: "打开主题选择弹窗，切换界面配色方案",
      name: "other.themes",
      run: () => {
        eventBus.publish(AppEvent.ThemePickerShow, {});
      },
      slashName: "themes",
      suggested: true,
      title: "主题选择",
    },
  ];
}
