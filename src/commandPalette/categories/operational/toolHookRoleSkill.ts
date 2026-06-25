/**
 * 工具 + Hook + 角色命令。
 *
 * 职责:
 *   - 提供工具管理命令(搜索、自动格式化、E2E、权限等)
 *   - 提供 Hook 管理命令(列表、日志、添加)
 *   - 提供角色管理命令(切换、列表、保存)
 *   - 提供 Skill 管理命令
 *
 * 模块功能:
 *   - buildToolHookRoleSkillCommands: 构建工具、Hook、角色和 Skill 命令
 *   - tool.search: 工具搜索
 *   - tool.auto-format: 自动格式化
 *   - tool.e2e: E2E 测试
 *   - tool.permission: 权限管理
 *   - skill.manage: Skill 管理
 *   - hook.list: Hook 列表
 *   - hook.logs: Hook 日志
 *   - role.switch: 角色切换
 *   - role.list: 角色列表
 *
 * 使用场景:
 *   - 用户需要搜索可用工具
 *   - 用户需要管理 Hook
 *   - 用户需要切换角色
 *   - 用户需要管理 Skill
 *
 * 边界:
 *   1. 工具命令依赖 toolRegistry 模块
 *   2. Hook 命令依赖 hook 模块
 *   3. 角色命令依赖 role 模块
 *   4. Skill 命令依赖 skill 模块
 *
 * 流程:
 *   1. 接收 CommandDeps 依赖
 *   2. 构建工具、Hook、角色和 Skill 命令数组
 *   3. 各命令调用对应模块的功能
 *   4. 通过 EventBus 通知状态变更
 */
import type { Command } from "@/commandPalette/types";
import type { CommandDeps } from "../../shared";
import { globalBus, type EventBus } from "@/bus";
import { AppEvent } from "@/bus";
import type { HookDefinition, HookResult } from "@/hooks/types";
import { symCheck, symCross, symDot } from "@/core/icons/icon";

export function buildToolHookRoleSkillCommands(deps: CommandDeps, eventBus: EventBus = globalBus): Command[] {
  return [
    // ─── 工具命令 ────────────────────────────────────────
    {
      category: "工具",
      description: "列出所有已注册的工具",
      name: "tool.search",
      run: async () => {
        try {
          const { getRegisteredTools } = await import("@/tool/registry/toolRegistry");
          const tools = getRegisteredTools();
          const names = Object.keys(tools).toSorted();
          const lines = names.map((n, i) => {
            const t = tools[n]!;
            const desc = t.description ? ` — ${t.description.slice(0, 50)}` : "";
            return `  ${i + 1}. ${n}${desc}`;
          });
          eventBus.publish(AppEvent.Log, {
            level: "info",
            message: `已注册工具 (${names.length}):\n${lines.join("\n")}`,
          });
        } catch {
          deps.showToast?.("工具注册表未加载", "error");
        }
      },
      slashName: "tool-search",
      title: "工具搜索",
    },
    {
      category: "工具",
      description: "切换自动格式化开关",
      name: "tool.autoformat",
      run: async () => {
        const config = deps.getConfig?.() as import("@/schema/config").AppConfigSchema | undefined;
        const current = config?.autoformat ?? true;
        const { saveConfig } = await import("@config");
        await saveConfig({ autoformat: !current });
        deps.showToast?.(`自动格式化: ${!current ? "已启用" : "已禁用"}`, "success");
      },
      slashName: "autoformat",
      title: "自动格式化",
    },
    {
      category: "工具",
      description: "在主进程/TUI 内直接启动一个受控子代理，验证 MCP 审批闭环",
      hidden: true,
      name: "tool.e2e-subagent-mcp",
      run: async (args?: string) => {
        const config = deps.getConfig?.() as import("@/schema/config").AppConfigSchema | undefined;
        if (!config) {
          deps.showToast?.("当前配置不可用，无法执行 E2E 验证", "error");
          return;
        }

        const toolName = args?.trim() || "zread_get_trending";
        deps.showToast?.(`开始主进程子代理 MCP E2E: ${toolName}`, "info");

        const { runSubagentMcpApprovalE2E } = await import("test/e2e/agent/mcpE2e");

        try {
          const result = await runSubagentMcpApprovalE2E(config, {
            toolName,
          });

          if (result.ok) {
            deps.showToast?.(`E2E 完成: ${result.text.slice(0, 80) || "子代理成功返回结果"}`, "success");
          } else {
            deps.showToast?.(`E2E 失败: ${result.error ?? "未知错误"}`, "error");
          }
        } catch (error) {
          deps.showToast?.(`E2E 失败: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
      slashName: "e2e-subagent-mcp",
      title: "子代理 MCP E2E",
    },
    {
      category: "工具",
      description: "显示当前权限状态",
      name: "tool.permissions",
      run: async () => {
        try {
          const { permissionActive } = await import("@/permission/ui/permissionState");
          const active = permissionActive();
          if (active) {
            eventBus.publish(AppEvent.Log, {
              level: "info",
              message: `权限状态:\n  当前等待审批: ${active}\n\n工具权限通过对话中的确认对话框管理。`,
            });
          } else {
            eventBus.publish(AppEvent.Log, {
              level: "info",
              message: `权限状态:\n  无待审批请求\n  YOLO 模式可跳过确认: /yolo`,
            });
          }
        } catch {
          deps.showToast?.("权限模块未加载", "error");
        }
      },
      slashName: "permissions",
      title: "权限管理",
    },

    // ─── Skill 命令(category "工具") ───────────────────────
    {
      category: "工具",
      description: "显示所有可用的 Skill(技能模板)",
      name: "skills",
      run: () => {
        eventBus.publish(AppEvent.SkillPickerShow, {});
      },
      slashAliases: ["skill"],
      slashName: "skills",
      suggested: true,
      title: "Skill 列表",
    },
    {
      category: "工具",
      description: "打开 Skill 列表管理面板",
      name: "skills.list",
      run: () => {
        eventBus.publish(AppEvent.SkillListShow, {});
      },
      slashName: "skills-list",
      title: "Skill 列表面板",
    },
    {
      category: "工具",
      description: "打开 Skill 创建面板，或用 /skills-create ai <需求> 生成草稿",
      name: "skills.create",
      run: async (args?: string) => {
        const input = args?.trim() ?? "";
        if (!input || !input.toLowerCase().startsWith("ai ")) {
          eventBus.publish(AppEvent.SkillCreationShow, {});
          return;
        }

        const requirement = input.slice(3).trim();
        if (!requirement) {
          deps.showToast?.("用法: /skills-create ai <需求>", "info");
          return;
        }

        try {
          const config = ((deps.getConfig?.() as import("@/schema/config").AppConfigSchema | undefined) ??
            (await import("@config").then((m) => m.loadConfig()))) as import("@/schema/config").AppConfigSchema;
          const { generateSkillDraftWithAI, writeSkillDraft } = await import("@/extension/skill");
          const draft = await generateSkillDraftWithAI(requirement, config);
          const result = writeSkillDraft(draft, {
            overwrite: input.includes("--overwrite"),
            projectDir: process.cwd(),
            scope: "project",
          });

          const { skillManager } = await import("@/extension/skill");
          await skillManager.reload(process.cwd());

          eventBus.publish(AppEvent.SkillExecuted, {
            ok: true,
            promptLength: draft.content.length,
            skillName: result.skillName,
          });
          eventBus.publish(AppEvent.Log, {
            level: "info",
            message: `AI Skill 已生成: ${result.skillName}\n${result.files.join("\n")}`,
          });
          deps.showToast?.(`AI Skill 已生成: ${result.skillName}`, "success");
        } catch (error) {
          deps.showToast?.(`AI Skill 生成失败: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
      slashAliases: ["skill-create"],
      slashName: "skills-create",
      title: "创建 Skill",
    },

    // ─── 用量统计(category "工具") ─────────────────────────
    {
      category: "工具",
      description: "查看 Token 使用统计和会话用量",
      name: "usage.stats",
      run: async () => {
        try {
          const sessionId = deps.getCurrentSessionId?.();
          const { getSessionUsageStats, getGlobalUsageStats } = await import("@session");

          // 获取全局用量统计
          const globalStats = getGlobalUsageStats();

          // 获取当前会话用量
          const sessionStats = sessionId ? await getSessionUsageStats(sessionId) : null;
          const globalUsage = globalStats as import("@/session/type").GlobalUsageStats;
          const currentUsage = sessionStats as import("@/session/type").UsageStats | null;

          const lines = [
            "📊 Token 使用统计",
            "",
            "【全局统计】",
            `  总会话数: ${globalUsage.sessionCount ?? 0}`,
            `  总消息数: ${globalUsage.messageCount ?? 0}`,
            `  总输入 Token: ${globalUsage.totalInputTokens ?? 0}`,
            `  总输出 Token: ${globalUsage.totalOutputTokens ?? 0}`,
            `  总 Token: ${(globalUsage.totalInputTokens ?? 0) + (globalUsage.totalOutputTokens ?? 0)}`,
            "",
          ];

          if (currentUsage) {
            lines.push(
              "【当前会话】",
              `  消息数: ${currentUsage.messageCount ?? 0}`,
              `  输入 Token: ${currentUsage.inputTokens ?? 0}`,
              `  输出 Token: ${currentUsage.outputTokens ?? 0}`,
              `  总 Token: ${(currentUsage.inputTokens ?? 0) + (currentUsage.outputTokens ?? 0)}`,
              "",
            );
          }

          lines.push(
            "提示:",
            "  - Token 统计基于实际 API 调用计算",
            "  - 不同模型的 Token 计算方式可能不同",
            "  - 工具调用和结果也会计入 Token",
          );

          eventBus.publish(AppEvent.Log, {
            level: "info",
            message: lines.join("\n"),
          });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          deps.showToast?.(`获取用量统计失败: ${msg}`, "error");
        }
      },
      slashName: "usage",
      title: "用量统计",
    },

    // ─── Hook 命令 ──────────────────────────────────────────
    {
      category: "Hook",
      description: "查看所有已注册的 Hook",
      name: "hook.list",
      run: async () => {
        try {
          const { hookRegistry } = await import("@/hooks/hookRegistry");
          const hooks = hookRegistry.getAll();
          if (hooks.length === 0) {
            deps.showToast?.("暂无已注册的 Hook", "info");
            return;
          }
          const lines = hooks.map(
            (h: HookDefinition) =>
              `  ${h.enabled ? symCheck : symCross} [${h.event}] ${h.name} (${h.type}, priority=${h.priority})`,
          );
          eventBus.publish(AppEvent.Log, {
            level: "info",
            message: `已注册 ${hooks.length} 个 Hook:\n${lines.join("\n")}`,
          });
        } catch {
          deps.showToast?.("Hook 模块未加载", "error");
        }
      },
      slashName: "hooks",
      title: "Hook 列表",
    },
    {
      category: "Hook",
      description: "查看最近的 Hook 执行记录",
      name: "hook.log",
      run: async () => {
        try {
          const { hookExecutor } = await import("@/hooks/hookExecutor");
          const hookLog = hookExecutor.getLog(20);
          if (hookLog.length === 0) {
            deps.showToast?.("暂无 Hook 执行记录", "info");
            return;
          }
          const lines = hookLog.map(
            (r: HookResult) =>
              `  ${r.success ? symCheck : symCross} [${r.event}] ${r.hookName} (${r.duration}ms)${r.error ? ` - ${r.error.slice(0, 60)}` : ""}`,
          );
          eventBus.publish(AppEvent.Log, {
            level: "info",
            message: `最近 ${hookLog.length} 条 Hook 执行记录:\n${lines.join("\n")}`,
          });
        } catch {
          deps.showToast?.("Hook 模块未加载", "error");
        }
      },
      slashName: "hook-log",
      title: "Hook 日志",
    },
    {
      category: "Hook",
      description: "添加新的 Shell Hook",
      name: "hook.add",
      run: () => {
        eventBus.publish(AppEvent.Log, {
          level: "info",
          message: `添加 Hook — 在对话中直接告诉 AI:\n\n  "添加一个 Hook: 在 bash 工具调用前运行 check-security.sh"\n\n或手动创建 .crab/hooks.json:\n\`\`\`json\n{\n  "hooks": [{\n    "id": "my-hook",\n    "name": "My Hook",\n    "event": "PreToolUse",\n    "command": "my-script.sh",\n    "condition": { "toolName": "bash" },\n    "enabled": true,\n    "priority": 100\n  }]\n}\n\`\`\`\n\n支持的事件: PreToolUse, PostToolUse, Notification, Stop, SubAgentStart, SubAgentStop, SessionStart, SessionEnd, UserMessage, Compress, ToolConfirmation, OnError, SkillExecute\n\nOnError 事件: 当工具执行或 API 调用发生错误时触发，可用于错误通知、日志记录等。`,
        });
      },
      slashName: "hook-add",
      title: "添加 Hook",
    },

    // ─── 角色命令 ─────────────────────────────────────────
    {
      category: "角色",
      description: "选择 ROLE.md prompt role，仅改变系统提示词，不改变 Agent、工具、模型或权限",
      name: "roles",
      run: () => {
        eventBus.publish(AppEvent.RolePickerShow, {});
      },
      slashAliases: ["role"],
      slashName: "roles",
      suggested: true,
      title: "选择 Role",
    },
    {
      category: "角色",
      description: "显示项目级和全局 ROLE.md prompt role 文件",
      name: "roles.list",
      run: async () => {
        try {
          const { listAllRoles } = await import("@/agent/roles/roleManager");
          const roles = listAllRoles();
          if (roles.length === 0) {
            deps.showToast?.("没有 ROLE.md 文件，请先用 /role-create 创建", "info");
            return;
          }
          const lines = roles.map((r) => {
            const marker = r.isActive ? symDot : " ";
            const mode = r.isOverride ? "override" : "append";
            return `${marker} [${r.location}] ${r.id} ${r.filename} (${mode}) — ${r.path}`;
          });
          eventBus.publish(AppEvent.Log, {
            level: "info",
            message: `ROLE.md 文件 (${roles.length}):\n${lines.join("\n")}`,
          });
        } catch {
          deps.showToast?.("Role 模块未加载", "error");
        }
      },
      slashName: "roles-list",
      title: "Role 文件列表",
    },
    {
      category: "Agent",
      description: "将当前活跃 Agent 保存为自定义 Agent(兼容旧 roles.json 格式)",
      name: "roles.save",
      run: async () => {
        try {
          const { getActiveAgent } = await import("@agent");
          const { createCustomAgent, getDefaultAgentsPath } = await import("@/config/agents/agentLoader");
          const active = getActiveAgent();
          if (!active) {
            deps.showToast?.("没有活跃 Agent 可保存", "warning");
            return;
          }
          const filePath = getDefaultAgentsPath();
          const result = await createCustomAgent(
            {
              availableTools: active.allowedTools,
              color: active.color,
              description: active.description,
              icon: active.icon,
              id: active.id ?? active.name,
              maxSteps: active.steps,
              name: active.label,
              systemPrompt: active.customSystemPrompt ?? active.prompt,
              tags: active.tags,
            },
            filePath,
          );
          if (result.ok) {
            deps.showToast?.(`Agent "${active.label}" 已保存`, "success");
          } else {
            deps.showToast?.(`保存失败: ${result.error}`, "error");
          }
        } catch {
          deps.showToast?.("Agent 模块未加载", "error");
        }
      },
      slashAliases: ["roles-save"],
      slashName: "agent-save",
      title: "保存当前 Agent",
    },

    // ─── Markdown 角色文件命令 ─────────────────────────
    {
      category: "角色",
      description: "在全局或项目级创建 ROLE.md 角色文件",
      name: "role.create",
      run: async (args?: string) => {
        const location = args?.trim() === "global" ? ("global" as const) : ("project" as const);
        try {
          const { createRoleFile } = await import("@/agent/roles/roleManager");
          const result = await createRoleFile(location);
          if (result.success) {
            eventBus.publish(AppEvent.Log, {
              level: "info",
              message: `角色文件已创建: ${result.path}\n\n编辑该文件来定义自定义 AI 行为。${location === "global" ? "\n作用域: 全局(所有项目)" : "\n作用域: 当前项目"}`,
            });
            deps.showToast?.("角色文件已创建", "success");
          } else {
            deps.showToast?.(`创建失败: ${result.error}`, "error");
          }
        } catch (error) {
          deps.showToast?.(`角色模块未加载: ${String(error)}`, "error");
        }
      },
      slashName: "role-create",
      title: "创建角色文件",
    },
    {
      category: "角色",
      description: "打开当前活跃的角色文件进行编辑",
      name: "role.edit",
      run: async () => {
        try {
          const { listAllRoles } = await import("@/agent/roles/roleManager");
          const allRoles = listAllRoles();
          const active = allRoles.find((r) => r.isActive);
          if (!active) {
            deps.showToast?.("没有活跃的角色文件，请先用 /role-create 创建", "info");
            return;
          }
          eventBus.publish(AppEvent.Log, {
            level: "info",
            message: `当前活跃角色文件: ${active.path}\n\n使用编辑器打开该文件来修改角色内容。修改后将在下次对话生效。`,
          });
        } catch (error) {
          deps.showToast?.(`角色模块未加载: ${String(error)}`, "error");
        }
      },
      slashName: "role-edit",
      title: "编辑角色文件",
    },
    {
      category: "角色",
      description: "删除指定的非活跃角色文件",
      name: "role.delete",
      run: async (args?: string) => {
        const roleId = args?.trim();
        if (!roleId) {
          deps.showToast?.("请指定要删除的角色 ID: /role-delete <roleId>", "info");
          return;
        }
        try {
          const { listAllRoles, deleteRole } = await import("@/agent/roles/roleManager");
          const allRoles = listAllRoles();
          // 尝试在全局和项目中查找
          const target = allRoles.find((r) => r.id === roleId);
          if (!target) {
            deps.showToast?.(`未找到角色: ${roleId}`, "error");
            return;
          }
          const result = await deleteRole(roleId, target.location);
          if (result.success) {
            deps.showToast?.(`角色 ${roleId} 已删除`, "success");
          } else {
            deps.showToast?.(`删除失败: ${result.error}`, "error");
          }
        } catch (error) {
          deps.showToast?.(`角色模块未加载: ${String(error)}`, "error");
        }
      },
      slashName: "role-delete",
      title: "删除非活跃角色",
    },
    {
      category: "角色",
      description: "切换活跃角色的 Override 模式(替换基础身份提示 vs 追加)",
      name: "role.override",
      run: async () => {
        try {
          const { listAllRoles, toggleRoleOverride } = await import("@/agent/roles/roleManager");
          const allRoles = listAllRoles();
          const active = allRoles.find((r) => r.isActive);
          if (!active) {
            deps.showToast?.("没有活跃角色可切换 Override", "info");
            return;
          }
          const result = await toggleRoleOverride(active.id, active.location);
          if (result.success) {
            const state = result.isOverride ? "已启用(角色将替换基础身份提示)" : "已关闭(角色将追加到系统提示词末尾)";
            deps.showToast?.(`Override 模式: ${state}`, "success");
            eventBus.publish(AppEvent.Log, {
              level: "info",
              message: `角色 ${active.id} Override 模式: ${state}`,
            });
          } else {
            deps.showToast?.(`切换失败: ${result.error}`, "error");
          }
        } catch (error) {
          deps.showToast?.(`角色模块未加载: ${String(error)}`, "error");
        }
      },
      slashName: "role-override",
      title: "切换 Override 模式",
    },
  ];
}
