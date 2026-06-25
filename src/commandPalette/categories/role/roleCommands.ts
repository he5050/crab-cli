/**
 * 角色命令集 — /role 和 /role-subagent 的 slash 命令注册
 *
 * 参考 snow-cli source/utils/commands/role.ts, roleSubagent.ts。
 * 适配: 使用 crab-cli Command 接口，无 UI 面板（headless 操作）。
 *
 *   /role             — 创建或管理自定义角色
 *   /role-subagent   — 管理子代理自定义角色
 */

import type { Command } from "@/commandPalette/type";
import type { CommandDeps } from "@/commandPalette/shared";
import {
  createRoleFile,
  listRoles,
  loadActiveRoleContent,
  deleteRole,
  checkRoleExists,
  type RoleLocation,
} from "./roleManager";
import { createRoleSubagentFile, listRoleSubagents, deleteRoleSubagentFile } from "./roleManager";

// ─── 命令注册 ──────────────────────────────────────────────

export function buildRoleCommands(deps: CommandDeps): Command[] {
  return [
    // ── /role ────────────────────────────────────────
    {
      category: "operational",
      name: "role",
      title: "自定义角色",
      description: "管理自定义 AI 角色 (ROLE.md)",
      slashName: "role",
      run: (args?: string) => {
        const arg = args?.trim() ?? "";

        if (!arg || arg === "help") {
          deps.showToast?.("用法: /role [create|list|show|del] [-g|-p]", "info");
          return;
        }

        // 解析作用域
        const location: RoleLocation = arg.includes("-p") || arg.includes("--project") ? "project" : "global";
        const cleanArg = arg.replace(/\s+[--]?[gp](?:lobal|roject)?\b/g, "").trim();

        if (cleanArg === "create" || cleanArg === "new") {
          if (checkRoleExists(location)) {
            deps.showToast?.("ROLE.md 已存在，请先删除再创建", "warning");
            return;
          }
          try {
            const path = createRoleFile(location);
            deps.showToast?.(`角色文件已创建: ${path} — 使用编辑器编辑内容`, "success");
          } catch (error) {
            deps.showToast?.(`创建失败: ${error instanceof Error ? error.message : String(error)}`, "error");
          }
          return;
        }

        if (cleanArg === "list" || cleanArg === "ls" || cleanArg === "l") {
          const roles = listRoles(location);
          if (roles.length === 0) {
            deps.showToast?.("没有自定义角色", "info");
            return;
          }
          const lines = roles.map((r) => `${r.isActive ? "✓" : " "} ${r.filename}${r.isActive ? " (active)" : ""}`);
          console.log(`\n📋 角色 (${location}, ${roles.length})\n${lines.join("\n")}`);
          deps.showToast?.(`共 ${roles.length} 个角色`, "info");
          return;
        }

        if (cleanArg === "show" || cleanArg === "cat") {
          const content = loadActiveRoleContent();
          if (!content) {
            deps.showToast?.("没有活跃角色内容", "info");
            return;
          }
          console.log(`\n${content}`);
          return;
        }

        if (cleanArg === "del" || cleanArg === "delete" || cleanArg === "d") {
          // 需要指定角色 ID
          const id = cleanArg.split(/\s+/)[2]?.trim() || "active";
          const ok = deleteRole(id, location);
          deps.showToast?.(ok ? `角色 ${id} 已删除` : `未找到角色 ${id}`, ok ? "success" : "warning");
          return;
        }

        deps.showToast?.("用法: /role [create|list|show|del] [-g|-p]", "info");
      },
    },

    // ── /role-subagent ──────────────────────────────────
    {
      category: "operational",
      name: "role-subagent",
      title: "子代理角色",
      description: "管理子代理自定义角色 (ROLE-<agent>.md)",
      slashName: "role-subagent",
      run: (args?: string) => {
        const arg = args?.trim() ?? "";

        if (!arg || arg === "help") {
          deps.showToast?.("用法: /role-subagent [create|list|del] <agentName> [-g|-p]", "info");
          return;
        }

        const location: RoleLocation = arg.includes("-p") || arg.includes("--project") ? "project" : "global";
        const cleanArg = arg.replace(/\s+[--]?[gp](?:lobal|roject)?\b/g, "").trim();

        if (cleanArg.startsWith("create ")) {
          const agentName = cleanArg.slice(7).trim().split(/\s+/)[0];
          if (!agentName) {
            deps.showToast?.("用法: /role-subagent create <agentName>", "warning");
            return;
          }
          try {
            const path = createRoleSubagentFile(agentName, location);
            deps.showToast?.(`子代理角色已创建: ${path}`, "success");
          } catch (error) {
            deps.showToast?.(`创建失败: ${error instanceof Error ? error.message : String(error)}`, "error");
          }
          return;
        }

        if (cleanArg === "list" || cleanArg === "ls" || cleanArg === "l") {
          const subagents = listRoleSubagents(location);
          if (subagents.length === 0) {
            deps.showToast?.("没有子代理角色", "info");
            return;
          }
          const lines = subagents.map((s) => `> ${s.filename} (${s.location})`);
          console.log(`\n📋 子代理角色 (${location}, ${subagents.length})\n${lines.join("\n")}`);
          deps.showToast?.(`共 ${subagents.length} 个子代理角色`, "info");
          return;
        }

        if (cleanArg.startsWith("del ") || cleanArg.startsWith("delete ")) {
          const agentName = cleanArg.split(/\s+/)[2]?.trim();
          if (!agentName) {
            deps.showToast?.("用法: /role-subagent del <agentName>", "warning");
            return;
          }
          const ok = deleteRoleSubagentFile(agentName, location);
          deps.showToast?.(ok ? `子代理角色 ${agentName} 已删除` : `未找到 ${agentName}`, ok ? "success" : "warning");
          return;
        }

        deps.showToast?.("用法: /role-subagent [create|list|del] <agentName> [-g|-p]", "info");
      },
    },
  ];
}
