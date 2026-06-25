/**
 * 配置 + 模式命令。
 *
 * 职责:
 *   - 提供配置管理命令(初始化、模型、Profile、后端等)
 *   - 提供模式切换命令(YOLO、Plan、Simple、Team 等)
 *   - 管理应用配置和运行模式
 *
 * 模块功能:
 *   - buildConfigModeCommands: 构建配置和模式命令
 *   - config.init: 初始化项目配置
 *   - config.model: 切换模型
 *   - config.profile: 切换 Profile
 *   - config.provider: 配置后端
 *   - config.max-spawn-depth: 设置子代理深度
 *   - mode.yolo: 切换 YOLO 模式
 *   - mode.plan: 切换 Plan 模式
 *   - mode.simple: 切换 Simple 模式
 *   - mode.team: 切换 Team 模式
 *
 * 使用场景:
 *   - 用户需要初始化项目配置
 *   - 用户需要切换模型或后端
 *   - 用户需要切换运行模式
 *   - 用户需要查看系统提示词
 *
 * 边界:
 *   1. 配置命令修改内存中的配置，部分需要持久化
 *   2. 模式切换通过 modeState 模块管理
 *   3. 部分命令需要有效的 LLM 配置
 *
 * 流程:
 *   1. 接收 CommandDeps 依赖
 *   2. 构建配置和模式命令数组
 *   3. 配置命令调用配置管理器修改配置
 *   4. 模式命令调用 modeState 切换模式
 *   5. 通过 EventBus 通知配置变更
 */
import type { Command } from "@/commandPalette/types";
import type { CommandDeps } from "../../shared";
import { getAppConfig } from "../../shared";
import { globalBus, type EventBus } from "@/bus";
import { AppEvent } from "@/bus";
import { getEffectiveMode, getYoloOverlay, switchMode, getActiveAgent } from "@/agent";
import { previewSystemPrompt } from "@/agent/prompt/builder";
import { createId } from "@/core/identity";

/**
 * 构建配置信息展示行 — 抽取 config.models 和 config.backend 的公共展示逻辑
 */
function buildConfigInfoLines(
  config: import("@/schema/config").AppConfigSchema | undefined,
  options: { showAgent?: boolean; showBackendList?: boolean } = {},
): string[] {
  const { showAgent = false, showBackendList = false } = options;
  const provider = config?.defaultProvider?.provider ?? "openai";
  const model = config?.defaultProvider?.model || "未配置";
  const lines: string[] = [];

  lines.push(`当前模型: ${model}`);
  lines.push(`当前 Provider: ${provider}`);

  if (showAgent) {
    const agent = getActiveAgent();
    lines.push(`当前 Agent: ${agent?.name ?? "default"}`);
  }

  lines.push("");

  if (showBackendList) {
    lines.push(
      `支持的后端:`,
      `  openai — OpenAI Chat Completions`,
      `  openai-responses — OpenAI Responses API`,
      `  anthropic — Anthropic Messages`,
      `  gemini — Google Gemini`,
      ``,
      `切换方式: 修改 .crab/config.json`,
    );
  } else {
    lines.push(`可用 Provider: openai, anthropic, gemini, openai-responses`);
    lines.push(`切换方式: 修改 .crab/config.json 或使用 /backend <provider>`);
  }

  return lines;
}

export function buildConfigModeCommands(deps: CommandDeps, eventBus: EventBus = globalBus): Command[] {
  return [
    // ─── 配置命令 ────────────────────────────────────────
    {
      category: "配置",
      description: "在当前目录创建 .crab/ 配置文件",
      name: "config.init",
      run: async () => {
        try {
          const { mkdirSync, existsSync, writeFileSync } = await import("node:fs");
          const { join } = await import("node:path");
          const cwd = process.cwd();
          const crabDir = join(cwd, ".crab");
          if (!existsSync(crabDir)) {
            mkdirSync(crabDir, { recursive: true });
          }
          const configPath = join(crabDir, "config.json");
          if (!existsSync(configPath)) {
            writeFileSync(
              configPath,
              JSON.stringify(
                {
                  defaultProvider: { model: "", provider: "openai" },
                  profile: "default",
                  theme: "dark",
                },
                null,
                2,
              ),
            );
            deps.showToast?.(`已创建项目配置: ${configPath}`, "success");
          } else {
            deps.showToast?.(`项目配置已存在: ${configPath}`, "info");
          }
          const hooksPath = join(crabDir, "hooks.json");
          if (!existsSync(hooksPath)) {
            writeFileSync(hooksPath, JSON.stringify({ hooks: [] }, null, 2));
          }
          eventBus.publish(AppEvent.Log, {
            level: "info",
            message: `项目配置初始化完成:\n  目录: ${crabDir}\n  配置: ${configPath}`,
          });
        } catch (error) {
          deps.showToast?.(`初始化失败: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
      slashName: "init",
      suggested: true,
      title: "初始化项目配置",
    },
    {
      category: "配置",
      description: "显示当前 AI 模型和可用模型列表",
      name: "config.models",
      run: () => {
        const config = deps.getConfig?.() as import("@/schema/config").AppConfigSchema | undefined;
        const lines = buildConfigInfoLines(config, { showAgent: true });
        eventBus.publish(AppEvent.Log, {
          level: "info",
          message: lines.join("\n"),
        });
      },
      slashName: "models",
      suggested: true,
      title: "模型选择",
    },
    {
      category: "配置",
      description: "显示当前 Profile 或切换到指定 Profile",
      name: "config.profiles",
      run: async (args?: string) => {
        // 无参数时显示 Profile 面板
        if (!args?.trim()) {
          eventBus.publish(AppEvent.ProfilePanelShow, {});
          return;
        }
        // 有参数时直接切换
        const target = args.trim();
        const { switchProfile } = await import("@/config/settings/configManager");
        const ok = await switchProfile(target);
        if (ok) {
          eventBus.publish(AppEvent.Toast, { message: `已切换到 Profile: ${target}`, variant: "success" });
        } else {
          eventBus.publish(AppEvent.Toast, { message: `切换 Profile 失败`, variant: "error" });
        }
      },
      slashAliases: ["profiles"],
      slashName: "profile",
      title: "Profile 切换",
    },
    {
      category: "配置",
      description: "将当前配置保存为新的 Profile(/profile-create <name>)",
      name: "config.profileCreate",
      run: async (args?: string) => {
        const name = args?.trim();
        if (!name) {
          deps.showToast?.("用法: /profile-create <name>", "warning");
          return;
        }
        const { createProfile } = await import("@/config/settings/configManager");
        const ok = await createProfile(name);
        if (ok) {
          deps.showToast?.(`Profile "${name}" 已创建`, "success");
        } else {
          deps.showToast?.(`创建 Profile 失败`, "error");
        }
      },
      slashName: "profile-create",
      title: "创建 Profile",
    },
    {
      category: "配置",
      description: "删除指定 Profile(/profile-delete <name>)",
      name: "config.profileDelete",
      run: async (args?: string) => {
        const name = args?.trim();
        if (!name) {
          deps.showToast?.("用法: /profile-delete <name>", "warning");
          return;
        }
        const { deleteProfile } = await import("@/config/settings/configManager");
        const ok = await deleteProfile(name);
        if (ok) {
          deps.showToast?.(`Profile "${name}" 已删除`, "success");
        } else {
          deps.showToast?.(`删除 Profile 失败`, "error");
        }
      },
      slashName: "profile-delete",
      title: "删除 Profile",
    },
    {
      category: "配置",
      description: "显示当前 AI API 后端信息",
      name: "config.backend",
      run: () => {
        const config = deps.getConfig?.() as import("@/schema/config").AppConfigSchema | undefined;
        const provider = config?.defaultProvider?.provider ?? "openai";
        const model = config?.defaultProvider?.model || "未配置";
        const lines = [
          `当前后端配置:`,
          `  Provider: ${provider}`,
          `  Model: ${model}`,
          ``,
          ...buildConfigInfoLines(config, { showBackendList: true }),
        ];
        eventBus.publish(AppEvent.Log, {
          level: "info",
          message: lines.join("\n"),
        });
      },
      slashName: "backend",
      title: "查看 API 后端",
    },
    {
      category: "配置",
      description: "查看或设置子代理最大嵌套深度(默认 3)",
      name: "config.subagentDepth",
      run: async (args) => {
        const depth = parseInt(args?.trim() ?? "", 10);
        if (isNaN(depth) || depth < 1 || depth > 10) {
          const config = getAppConfig(deps);
          deps.showToast?.(`当前子代理深度: ${config?.maxSpawnDepth ?? 3}。用法: /subagent-depth <1-10>`, "info");
          return;
        }
        const { saveConfig } = await import("@config");
        await saveConfig({ maxSpawnDepth: depth } as import("@/schema/config").AppConfigSchema);
        deps.showToast?.(`子代理深度已设置为 ${depth}(重启生效)`, "success");
      },
      slashName: "subagent-depth",
      title: "子代理深度",
    },
    {
      category: "配置",
      description: "查看或配置 HTTP 代理设置(查看/开启/关闭)",
      name: "config.proxy",
      run: async (args) => {
        const config = getAppConfig(deps);
        const proxy = config?.proxy;
        if (!proxy) {
          deps.showToast?.("代理配置不可用", "error");
          return;
        }
        const subCmd = args?.trim();
        if (subCmd === "on") {
          const { saveConfig } = await import("@config");
          await saveConfig({ proxy: { ...proxy, enabled: true } } as import("@/schema/config").AppConfigSchema);
          deps.showToast?.("代理已启用", "success");
        } else if (subCmd === "off") {
          const { saveConfig } = await import("@config");
          await saveConfig({ proxy: { ...proxy, enabled: false } } as import("@/schema/config").AppConfigSchema);
          deps.showToast?.("代理已禁用", "success");
        } else {
          deps.showToast?.(
            `代理: ${proxy.enabled ? "已启用" : "已禁用"}\nURL: ${proxy.url ?? "未配置"}\n搜索引擎: ${proxy.searchEngine ?? "duckduckgo"}\n用法: /proxy on|off`,
            "info",
          );
        }
      },
      slashName: "proxy",
      title: "代理配置",
    },
    {
      category: "配置",
      description: "查看当前 LLM API 自定义请求头",
      name: "config.customHeaders",
      run: async (_args) => {
        const config = getAppConfig(deps);
        const headers = config?.customHeaders;
        if (!headers || Object.keys(headers).length === 0) {
          deps.showToast?.("未配置自定义请求头。在 .crab/config.json 的 customHeaders 字段添加", "info");
          return;
        }
        const lines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`);
        deps.showToast?.(`自定义请求头:\n${lines.join("\n")}`, "info");
      },
      slashName: "custom-headers",
      title: "自定义请求头",
    },

    // ─── 模式命令 ────────────────────────────────────────
    {
      category: "模式",
      description: "切换 YOLO 模式(自动执行，不确认)",
      name: "mode.yolo",
      run: () => {
        switchMode("yolo", deps.showToast);
      },
      slashName: "yolo",
      suggested: true,
      title: "YOLO 模式",
    },
    {
      category: "模式",
      description: "切换 Plan 模式(先规划后执行)",
      name: "mode.plan",
      run: () => {
        switchMode("plan", deps.showToast);
      },
      slashName: "plan",
      suggested: true,
      title: "Plan 模式",
    },
    {
      category: "模式",
      description: "切换简单模式(纯文本对话，无工具)",
      name: "mode.simple",
      run: () => {
        switchMode("simple", deps.showToast);
      },
      slashName: "simple",
      title: "Simple 模式",
    },
    {
      category: "模式",
      description: "切换 Team 模式(多 Agent 协作)",
      name: "mode.team",
      run: () => {
        switchMode("team", deps.showToast);
      },
      slashName: "team",
      suggested: true,
      title: "Team 模式",
    },
    {
      category: "模式",
      description: "切换安全审计模式(漏洞检测和安全分析)",
      name: "mode.security",
      run: () => {
        switchMode("security", deps.showToast);
      },
      slashName: "security",
      title: "安全审计模式",
    },
    {
      category: "模式",
      description: "切换漏洞猎人模式(安全审计)，或执行安全扫描",
      name: "mode.vulnerability",
      run: async (args) => {
        const action = args?.trim();

        // 无参数时切换到 security 模式
        if (!action) {
          switchMode("security");
          deps.showToast?.("已切换到漏洞猎人模式", "success");
          return;
        }

        // 执行安全扫描
        if (action === "scan" || action === "audit") {
          deps.showToast?.("启动 5 阶段安全猎手扫描...", "info");

          try {
            const sessionId = createId("ses");
            const { ensureSession } = await import("@session");
            const config = getAppConfig(deps);

            ensureSession(sessionId, {
              model: config?.defaultProvider?.model ?? "",
              projectDir: process.cwd(),
            });

            const { getModeInstruction } = await import("@/agent/prompt");
            const hunterPrompt = getModeInstruction("security");

            const auditPrompt = `${hunterPrompt}

---

请立即对当前项目执行上述 5 阶段安全猎手扫描。

完成后，将最终报告保存到 .crab/security-reports/ 目录(使用 filesystem-write 工具)。

开始执行阶段 1:依赖扫描。`;

            switchMode("security");
            eventBus.publish(AppEvent.SessionCreated, { sessionId });
            deps.navigate({ sessionId, type: "session" });

            setTimeout(() => {
              eventBus.publish(AppEvent.ConversationMessageSent, {
                content: auditPrompt,
                role: "user",
                sessionId,
              });
            }, 500);

            deps.showToast?.("安全猎手扫描会话已创建", "success");
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            deps.showToast?.(`安全扫描启动失败: ${msg}`, "error");
          }
          return;
        }

        deps.showToast?.("未知操作，用法: /vulnerability-hunting [scan]", "warning");
      },
      slashName: "vulnerability-hunting",
      title: "漏洞猎人模式",
    },
    {
      category: "模式",
      description: "预览当前模式构建的完整系统提示词",
      name: "mode.prompt",
      run: () => {
        const agent = getActiveAgent();
        const mode = getEffectiveMode();
        const yolo = getYoloOverlay();
        const basePrompt = agent?.prompt ?? "你是一个编程助手。";
        const preview = previewSystemPrompt({
          basePrompt,
          environment: { cwd: process.cwd() },
          includeInstructions: false,
          mode,
          yoloOverlay: yolo,
        });
        // 通过 Log 事件输出预览(在消息流中显示)
        eventBus.publish(AppEvent.Log, {
          level: "info",
          message: `系统提示词预览 (${preview.length} 字符，模式: ${mode}${yolo ? "+YOLO" : ""}):\n${preview.slice(0, 500)}...`,
        });
      },
      slashName: "prompt",
      title: "查看系统提示词",
    },
    {
      category: "模式",
      description: "设置或清除自定义系统提示词追加内容",
      name: "mode.system-prompt",
      run: async (args?: string) => {
        const content = args?.trim();
        if (!content) {
          deps.showToast?.(
            "用法: /system-prompt <内容> — 设置自定义追加提示词\n/system-prompt --clear — 清除自定义提示词",
            "info",
          );
          return;
        }
        const { saveConfig } = await import("@config");
        if (content === "--clear") {
          await saveConfig({ customSystemPrompt: "" });
          deps.showToast?.("自定义系统提示词已清除", "success");
          return;
        }
        await saveConfig({ customSystemPrompt: content });
        deps.showToast?.(`自定义系统提示词已设置 (${content.length} 字符)`, "success");
      },
      slashName: "system-prompt",
      title: "自定义系统提示词",
    },
  ];
}
