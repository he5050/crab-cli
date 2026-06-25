/**
 * 自定义命令注册 — /custom 及用户自定义命令的 slash 命令注册
 *
 *
 *   /custom       — 显示自定义命令帮助
 *   /custom add   — 创建自定义命令
 *   /custom ls    — 列出所有自定义命令
 *   /custom del   — 删除自定义命令
 */

import type { Command } from "@/commandPalette/type";
import type { CommandDeps } from "@/commandPalette/shared";
import { saveCustomCommand, deleteCustomCommand, listCustomCommands, type CommandLocation } from "./customCommandsCore";
import { spawnSync } from "node:child_process";

// ─── 辅助函数 ──────────────────────────────────────────────

function executeTerminalCommand(command: string, args: string): string {
  const fullCmd = args ? `${command} ${args}` : command;
  const result = spawnSync(fullCmd, {
    shell: true,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  });
  return result.stdout || result.stderr || "(no output)";
}

// ─── 命令注册 ──────────────────────────────────────────────

export function buildCustomCommands(deps: CommandDeps): Command[] {
  return [
    // ── /custom ──────────────────────────────────────
    {
      category: "operational",
      name: "custom",
      title: "自定义命令",
      description: "管理用户自定义 slash 命令",
      slashName: "custom",
      run: (args?: string) => {
        const arg = args?.trim() ?? "";

        if (!arg || arg === "help") {
          deps.showToast?.("用法: /custom [add|ls|del] — 管理自定义命令", "info");
          return;
        }

        if (arg === "ls" || arg === "list") {
          const { global, project } = listCustomCommands();
          const all = [...project, ...global];
          if (all.length === 0) {
            deps.showToast?.("没有自定义命令", "info");
            return;
          }
          const lines = all.map((c) => `/${c.name} [${c.type}] ${c.description ? `- ${c.description}` : ""}`);
          console.log(`\n📋 自定义命令 (${all.length})\n${lines.join("\n")}`);
          deps.showToast?.(`共 ${all.length} 个自定义命令`, "info");
          return;
        }

        if (arg.startsWith("add ")) {
          // /custom add <name> <command> <type:execute|prompt> [description] [location:global|project]
          const parts = arg.slice(4).trim().split(/\s+/);
          if (parts.length < 3) {
            deps.showToast?.("用法: /custom add <name> <command> <execute|prompt> [描述] [global|project]", "warning");
            return;
          }
          const name = parts[0] ?? "";
          const command = parts[1] ?? "";
          const type = parts[2] === "prompt" ? "prompt" : "execute";
          const location: CommandLocation = parts.includes("project") ? "project" : "global";
          const desc = parts[3] || undefined;

          try {
            saveCustomCommand(name, command, type, desc, location);
            deps.showToast?.(`自定义命令 /${name} 已创建 (${location})`, "success");
          } catch (error) {
            deps.showToast?.(`创建失败: ${error instanceof Error ? error.message : String(error)}`, "error");
          }
          return;
        }

        if (arg.startsWith("del ") || arg.startsWith("delete ")) {
          const name = arg.split(/\s+/)[2]?.trim();
          if (!name) {
            deps.showToast?.("用法: /custom del <name>", "warning");
            return;
          }
          // 尝试项目，再尝试全局
          const projectOk = deleteCustomCommand(name, "project");
          const globalOk = !projectOk && deleteCustomCommand(name, "global");
          if (projectOk || globalOk) {
            deps.showToast?.(`自定义命令 /${name} 已删除`, "success");
          } else {
            deps.showToast?.(`未找到自定义命令 /${name}`, "warning");
          }
          return;
        }

        deps.showToast?.("用法: /custom [add|ls|del]", "info");
      },
    },
  ];
}

/** 为自定义命令生成命令注册项（动态注册到命令系统） */
export function buildDynamicCustomCommands(deps: CommandDeps): Command[] {
  const customCmds = listCustomCommands();
  const all = [...customCmds.project, ...customCmds.global];

  return all.map((cmd) => ({
    category: "custom" as const,
    name: `custom:${cmd.name}`,
    title: cmd.description || cmd.name,
    description: `自定义命令: ${cmd.type === "execute" ? "Shell" : "AI"} -> ${cmd.command}`,
    slashName: cmd.name,
    run: (args?: string) => {
      if (args?.trim() === "-d") {
        const location = customCmds.project.find((c) => c.name === cmd.name)
          ? ("project" as const)
          : ("global" as const);
        deleteCustomCommand(cmd.name, location);
        deps.showToast?.(`自定义命令 /${cmd.name} 已删除`, "success");
        return;
      }

      if (cmd.type === "execute") {
        try {
          const output = executeTerminalCommand(cmd.command, args ?? "");
          if (output.trim()) {
            console.log(`\n${output}`);
          }
          deps.showToast?.(`/${cmd.name} 执行完成`, "success");
        } catch (error) {
          deps.showToast?.(`执行失败: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      } else {
        // prompt 类型: 将命令内容作为用户输入发送
        const message = args ? `${cmd.command} ${args}` : cmd.command;
        console.log(`\n[发送给 AI] ${message}`);
        deps.showToast?.(`/${cmd.name} 已发送给 AI`, "info");
      }
    },
  }));
}
