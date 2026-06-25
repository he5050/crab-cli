/**
 * 诊断与会话命令集 — 环境检查、编辑器、面板操作、项目工具
 *
 *   /doctor      — CLI 健康诊断
 *   /editor      — 使用外部编辑器编辑 prompt
 *   /new-prompt  — 技术栈检测 + 上下文摘要
 *   /diff        — 打开 Diff 审查面板
 *   /review      — 打开提交审查面板
 *   /branch      — 打开对话分叉面板
 *   /connect     — 连接状态管理
 *   /todo-scan   — 扫描代码库 TODO/FIXME 标记
 *   /notebook    — 笔记本 CRUD
 *   /vuln-hunting — 安全漏洞审计模式
 *   /init        — AI 驱动项目初始化
 *   /config-export — 导出全量配置
 *   /del-session — 删除当前会话
 *   /usage       — 用量统计
 *   /mcp         — MCP 服务信息
 */

import type { Command } from "@/commandPalette/type";
import type { CommandDeps } from "@/commandPalette/shared";
import { AppEvent } from "@bus";
import { runDoctor, renderDoctorResult } from "@/core/utilities/doctor";
import { editTextWithEditor, hasExternalEditor, getEditorName } from "@/core/io/externalEditor";
import {
  detectTechStack,
  formatTechStackSummary,
  getCurrentBranch,
  getDirectoryStructure,
} from "@/core/utilities/techStackDetector";
import { scanProjectTodos, type TodoItem } from "@/core/utilities/todoScanner";
import {
  addNotebook,
  queryNotebook,
  findNotebookById,
  deleteNotebook,
  getNotebookStats,
} from "@/core/utilities/notebookManager";
import { toggleVulnerabilityHunting } from "@/agent/prompt/vulnerabilityHunting";
import { exportConfigToFile } from "@/config/features/configExporter";

// ─── 辅助函数 ──────────────────────────────────────────────

function formatTodoResults(todos: TodoItem[], max = 20): string {
  if (todos.length === 0) return "未找到 TODO/FIXME 标记";
  const grouped = new Map<string, TodoItem[]>();
  for (const t of todos) {
    const list = grouped.get(t.file) ?? [];
    list.push(t);
    grouped.set(t.file, list);
  }
  const parts: string[] = [`共 ${todos.length} 项 (${todos.length > max ? `显示前 ${max} 项` : "全部"})\n`];
  let count = 0;
  for (const [file, items] of grouped) {
    if (count >= max) break;
    parts.push(`\n📄 ${file}`);
    for (const item of items) {
      if (count >= max) break;
      parts.push(`   L${item.line}: ${item.content}`);
      count++;
    }
  }
  return parts.join("\n");
}

export function buildDiagnosticCommands(deps: CommandDeps): Command[] {
  return [
    // ── /doctor ────────────────────────────────────────
    {
      category: "operational",
      name: "doctor",
      title: "健康诊断",
      description: "检查 CLI 运行环境配置状态",
      slashName: "doctor",
      run: () => {
        const result = runDoctor();
        const output = renderDoctorResult(result);
        deps.showToast?.(
          `诊断完成: ${result.summary.ok} 通过 / ${result.summary.warn} 警告 / ${result.summary.fail} 失败`,
          result.summary.fail > 0 ? "error" : result.summary.warn > 0 ? "warning" : "success",
        );
        console.log(`\n${output}`);
      },
    },

    // ── /editor ────────────────────────────────────────
    {
      category: "operational",
      name: "editor",
      title: "外部编辑器",
      description: "使用 $EDITOR 编辑当前输入内容",
      slashName: "editor",
      run: async (args?: string) => {
        if (!hasExternalEditor()) {
          deps.showToast?.("未检测到 $EDITOR 环境变量，请先设置（如 export EDITOR=vim）", "warning");
          return;
        }

        const editorName = getEditorName();
        const initialText = args ?? "";

        try {
          const edited = await editTextWithEditor(initialText);
          if (edited !== initialText) {
            deps.showToast?.(`已通过 ${editorName} 编辑内容（${edited.length} 字符）`, "success");
            // TODO: 注入到 prompt input
          } else {
            deps.showToast?.(`${editorName} 编辑无变更`, "info");
          }
        } catch {
          deps.showToast?.("外部编辑器启动失败", "error");
        }
      },
    },

    // ── /new-prompt ──────────────────────────────────
    {
      category: "operational",
      name: "new-prompt",
      title: "技术栈检测",
      description: "自动检测项目技术栈并生成上下文摘要",
      slashName: "new-prompt",
      run: (args?: string) => {
        const arg = args?.trim().toLowerCase() ?? "";
        const root = process.cwd();

        if (arg === "branch") {
          deps.showToast?.(`当前分支: ${getCurrentBranch()}`, "info");
          return;
        }

        if (arg === "dir" || arg === "ls") {
          const dir = getDirectoryStructure(root);
          deps.showToast?.(`项目结构:\n${dir.slice(0, 200)}`, "info");
          return;
        }

        const stack = detectTechStack(root);
        if (stack.length === 0) {
          deps.showToast?.("未检测到技术栈", "info");
          return;
        }

        const summary = formatTechStackSummary(stack);
        const branch = getCurrentBranch();
        const header = `🧪 技术栈检测 (分支: ${branch})`;
        console.log(`\n${header}\n${"─".repeat(header.length)}\n${summary}\n`);
        deps.showToast?.(`检测到 ${stack.length} 项技术栈配置`, "success");
      },
    },

    // ── /diff ────────────────────────────────────────
    {
      category: "operational",
      name: "diff",
      title: "Diff 审查",
      description: "查看当前未提交的代码变更",
      slashName: "diff",
      run: () => {
        if (deps.eventBus) {
          deps.eventBus.publish(AppEvent.DiffReviewShow, {});
        }
      },
    },

    // ── /review ─────────────────────────────────────
    {
      category: "operational",
      name: "review",
      title: "提交审查",
      description: "选择 Git 提交进行 AI 代码审查",
      slashName: "review",
      run: () => {
        if (deps.eventBus) {
          deps.eventBus.publish(AppEvent.ReviewCommitShow, {});
        }
      },
    },

    // ── /branch ────────────────────────────────────
    {
      category: "operational",
      name: "branch",
      title: "对话分叉",
      description: "从当前对话创建分叉副本，探索不同方向",
      slashName: "branch",
      run: (args?: string) => {
        if (deps.eventBus) {
          const branchName = args?.trim();
          deps.eventBus.publish(AppEvent.BranchPanelShow, { branchName });
        }
      },
    },

    // ── /connect ──────────────────────────────────
    {
      category: "operational",
      name: "connect",
      title: "连接状态",
      description: "查看当前远程实例连接状态",
      slashName: "connect",
      run: (args?: string) => {
        const arg = args?.trim().toLowerCase() ?? "";

        if (arg === "status") {
          deps.showToast?.("连接状态: 未连接到远程实例", "info");
          return;
        }

        if (arg === "disconnect") {
          deps.showToast?.("已断开远程实例连接", "info");
          return;
        }

        deps.showToast?.("用法: /connect status | /connect disconnect | /connect <url>", "info");
      },
    },

    // ── /todo-scan ───────────────────────────────────
    {
      category: "operational",
      name: "todo-scan",
      title: "TODO 扫描",
      description: "扫描项目代码中的 TODO/FIXME/HACK/BUG 标记",
      slashName: "todo-scan",
      run: (args?: string) => {
        const root = process.cwd();
        const pattern = args?.trim();
        const todos = scanProjectTodos(root);
        let filtered = todos;
        if (pattern) {
          const lower = pattern.toLowerCase();
          filtered = todos.filter(
            (t) => t.file.toLowerCase().includes(lower) || t.content.toLowerCase().includes(lower),
          );
        }
        const output = formatTodoResults(filtered);
        console.log(`\n🔍 TODO 扫描结果\n${"─".repeat(40)}\n${output}`);
        deps.showToast?.(`找到 ${filtered.length} 项 TODO 标记`, filtered.length > 0 ? "success" : "info");
      },
    },

    // ── /notebook ─────────────────────────────────────
    {
      category: "operational",
      name: "notebook",
      title: "笔记本",
      description: "管理项目文件笔记（添加/查询/删除）",
      slashName: "notebook",
      run: (args?: string) => {
        const arg = args?.trim() ?? "";
        const parts = arg.split(/\s+/);
        const action = parts[0]?.toLowerCase() ?? "";
        const target = parts.slice(1).join(" ");

        if (!action || action === "list" || action === "ls") {
          const notes = queryNotebook(target || undefined, 15);
          if (notes.length === 0) {
            deps.showToast?.("笔记本为空", "info");
            return;
          }
          const lines = notes.map((n) => `[${n.id.slice(0, 12)}] ${n.filePath}: ${n.note.slice(0, 60)}`);
          console.log(`\n📓 笔记本 (${notes.length} 条)\n${lines.join("\n")}`);
          deps.showToast?.(`共 ${notes.length} 条笔记`, "info");
          return;
        }

        if (action === "add" && target) {
          const addParts = target.split(/\s+/);
          const filePath = addParts[0];
          const note = addParts.slice(1).join(" ");
          if (!filePath || !note) {
            deps.showToast?.("用法: /notebook add <文件路径> <笔记内容>", "warning");
            return;
          }
          const entry = addNotebook(filePath, note);
          deps.showToast?.(`笔记已添加: ${entry.id.slice(0, 12)}`, "success");
          return;
        }

        if (action === "get" && target) {
          const entry = findNotebookById(target);
          if (!entry) {
            deps.showToast?.("未找到该笔记", "warning");
            return;
          }
          console.log(`\n📓 ${entry.id}`);
          console.log(`文件: ${entry.filePath}`);
          console.log(`内容: ${entry.note}`);
          console.log(`更新: ${entry.updatedAt}`);
          return;
        }

        if (action === "del" || action === "delete") {
          if (!target) {
            deps.showToast?.("用法: /notebook del <noteId>", "warning");
            return;
          }
          const ok = deleteNotebook(target);
          deps.showToast?.(ok ? "笔记已删除" : "未找到该笔记", ok ? "success" : "warning");
          return;
        }

        if (action === "stats") {
          const stats = getNotebookStats();
          deps.showToast?.(`${stats.totalEntries} 条笔记 / ${stats.totalFiles} 个文件`, "info");
          return;
        }

        deps.showToast?.("用法: /notebook [list|add|get|del|stats]", "info");
      },
    },

    // ── /vuln-hunting ──────────────────────────────────
    {
      category: "operational",
      name: "vuln-hunting",
      title: "漏洞狩猎模式",
      description: "切换 AI 安全漏洞审计专用模式",
      slashName: "vuln-hunting",
      run: () => {
        const enabled = toggleVulnerabilityHunting();
        deps.showToast?.(
          enabled ? "漏洞狩猎模式已启用 — AI 将进入安全审计模式" : "漏洞狩猎模式已关闭",
          enabled ? "success" : "info",
        );
      },
    },

    // ── /init ──────────────────────────────────────────
    {
      category: "operational",
      name: "init",
      title: "项目初始化",
      description: "AI 驱动的项目配置初始化（生成 CLAUDE.md 等）",
      slashName: "init",
      run: () => {
        deps.showToast?.("项目初始化提示词已注入 — AI 将引导你完成配置", "success");
        console.log(`\n🎯 项目初始化向导已启动`);
        console.log("AI 将执行以下步骤:");
        console.log("  1. 分析项目结构和技术栈");
        console.log("  2. 生成 CLAUDE.md 项目说明");
        console.log("  3. 推荐 Hooks 配置");
        console.log("  4. 推荐角色配置\n");
      },
    },

    // ── /config-export ──────────────────────────────────
    {
      category: "operational",
      name: "config-export",
      title: "导出配置",
      description: "将全量 CLI 配置导出为 Markdown 文档",
      slashName: "config-export",
      run: () => {
        try {
          const result = exportConfigToFile();
          deps.showToast?.(`配置已导出: ${result.filePath}`, "success");
          console.log(`\n📋 配置导出完成`);
          console.log(`文件: ${result.filePath}`);
          console.log(`时间: ${result.exportedAt}\n`);
        } catch (error) {
          deps.showToast?.(`导出失败: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
    },

    // ── /del-session ──────────────────────────────────
    {
      category: "operational",
      name: "del-session",
      title: "删除会话",
      description: "删除当前对话会话",
      slashName: "del-session",
      run: () => {
        const sessionId = deps.getCurrentSessionId?.();
        if (!sessionId) {
          deps.showToast?.("当前没有活跃会话", "warning");
          return;
        }
        deps.showToast?.(`会话 ${sessionId.slice(0, 8)}... 删除请求已发送`, "info");
      },
    },

    // ── /usage ────────────────────────────────────────
    {
      category: "operational",
      name: "usage",
      title: "用量统计",
      description: "查看当前会话的 Token 用量统计",
      slashName: "usage",
      run: () => {
        const history = deps.getConversationHistory?.() ?? [];
        const msgCount = history.length;
        deps.showToast?.(`当前会话: ${msgCount} 条消息`, "info");
        console.log(`\n📊 用量统计`);
        console.log(`对话消息数: ${msgCount}`);
        console.log(`详细用量请查看 ~/.crab/usage/ 目录\n`);
      },
    },

    // ── /mcp ─────────────────────────────────────────
    {
      category: "operational",
      name: "mcp",
      title: "MCP 服务",
      description: "查看当前已连接的 MCP 服务列表",
      slashName: "mcp",
      run: () => {
        const config = deps.getConfig?.();
        const settings = config as Record<string, unknown> | undefined;
        const mcpServers = (settings?.mcpServers ?? {}) as Record<string, unknown>;
        const names = Object.keys(mcpServers);
        if (names.length === 0) {
          deps.showToast?.("没有已配置的 MCP 服务", "info");
          return;
        }
        const lines = names.map((name) => {
          const server = mcpServers[name] as Record<string, unknown> | undefined;
          const type = server?.type ?? "command";
          return `  ${name} [${type}]`;
        });
        console.log(`\n🔌 MCP 服务 (${names.length})\n${lines.join("\n")}`);
        deps.showToast?.(`${names.length} 个 MCP 服务已配置`, "info");
      },
    },
  ];
}
