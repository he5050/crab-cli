/**
 * 命令面板 IDE 命令模块 — IDE 连接/上下文相关命令。
 *
 * 职责:
 *   - 暴露 IDE 连接状态查询
 *   - 暴露 IDE 上下文拉取
 *   - 与 vscodeConnection 模块联动
 *
 * 模块功能:
 *   - buildIdeCommands: 构建 IDE 命令集合
 *   - connectIDE: 抽取公共 IDE 连接逻辑
 */
import type { Command } from "@/commandPalette/types";
import type { CommandDeps } from "../../shared";
import { globalBus, type EventBus } from "@/bus";
import { AppEvent } from "@/bus";
import { iconError, iconLsp, iconWarning, symCheck, symCross, symDot, symEmpty } from "@/core/icons/icon";

/**
 * 连接 IDE 的公共逻辑 — 抽取 ide.reveal、ide.connectInstance、ide.connect 的重复连接代码
 */
async function connectIDE(
  deps: CommandDeps,
  options: { showInfo?: boolean; showSuccess?: boolean } = {},
): Promise<{ success: boolean; error?: string }> {
  const { showInfo = true, showSuccess = true } = options;
  try {
    const { vscodeConnection } = await import("@/ide/client");
    if (showInfo) {
      deps.showToast?.("正在连接 IDE...", "info");
    }
    await vscodeConnection.start();
    if (showSuccess) {
      deps.showToast?.("IDE 连接成功", "success");
    }
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    deps.showToast?.(`连接失败: ${msg}`, "error");
    return { success: false, error: msg };
  }
}

export function buildIdeCommands(deps: CommandDeps, eventBus: EventBus = globalBus): Command[] {
  return [
    {
      category: "IDE",
      description: "连接 IDE 并查看状态",
      name: "ide.reveal",
      run: async () => {
        try {
          const { vscodeConnection } = await import("@/ide/client");
          const status = vscodeConnection.getStatus();
          if (status === "connected") {
            const ctx = vscodeConnection.getContext();
            deps.showToast?.(`IDE 已连接: ${ctx.activeFile ?? "无活动文件"}`, "success");
          } else {
            await connectIDE(deps);
          }
        } catch (error) {
          deps.showToast?.(`IDE 连接失败: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
      slashName: "ide",
      title: "IDE 连接",
    },
    {
      category: "IDE",
      description: "查看 IDE 连接使用统计",
      name: "ide.usage",
      run: async () => {
        try {
          const { vscodeConnection } = await import("@/ide/client");
          const status = vscodeConnection.getStatus();
          const ctx = vscodeConnection.getContext();
          const lines = [
            `IDE 状态: ${status}`,
            `活动文件: ${ctx.activeFile ?? "无"}`,
            `选区: ${ctx.selectedText ? `${ctx.selectedText.slice(0, 50)}...` : "无"}`,
            `工作目录: ${ctx.workspaceFolder ?? "无"}`,
          ];
          eventBus.publish(AppEvent.Log, { level: "info", message: lines.join("\n") });
        } catch (error) {
          deps.showToast?.(`获取 IDE 信息失败: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
      slashName: "ide-usage",
      title: "IDE 使用统计",
    },
    {
      category: "IDE",
      description: "管理 IDE 实例连接，显示连接状态或主动连接",
      name: "ide.connectInstance",
      run: async (args) => {
        const { vscodeConnection } = await import("@/ide/client");
        const { getAvailableIDEs } = await import("@/ide/detection");

        const action = args?.trim();

        if (!action || action === "status") {
          const status = vscodeConnection.getStatus();
          const ides = getAvailableIDEs();
          const statusIcon = status === "connected" ? symCheck : status === "connecting" ? symDot : symCross;
          const ctx = vscodeConnection.getContext();

          const lines = [
            `${statusIcon} IDE 连接状态: ${status}`,
            ``,
            `可用 IDE 实例:`,
            ...[...ides.matched, ...ides.unmatched].map(
              (ide) =>
                `  ${ide.matched ? symDot : symEmpty} ${ide.name} (端口: ${ide.port})${ide.matched ? " [匹配当前目录]" : ""}`,
            ),
            ``,
            ctx.activeFile ? `当前活动文件: ${ctx.activeFile}` : "无活动文件",
            ctx.selectedText ? `已选文本: ${ctx.selectedText.slice(0, 50)}...` : "",
            ``,
            `用法:`,
            `  /connect status  - 显示连接状态`,
            `  /connect start   - 主动连接 IDE`,
            `  /connect stop    - 断开连接`,
          ].filter(Boolean);

          eventBus.publish(AppEvent.Log, { level: "info", message: lines.join("\n") });
          return;
        }

        if (action === "start" || action === "connect") {
          await connectIDE(deps);
          return;
        }

        if (action === "stop" || action === "disconnect") {
          vscodeConnection.stop();
          deps.showToast?.("已断开 IDE 连接", "info");
          return;
        }

        deps.showToast?.("未知操作，用法: /connect [status|start|stop]", "warning");
      },
      slashName: "connect",
      title: "实例连接",
    },
    {
      category: "IDE",
      description: "查看 VSCode 连接状态",
      name: "ide.status",
      run: async () => {
        try {
          const { vscodeConnection } = await import("@/ide/client");
          const status = vscodeConnection.getStatus();
          const port = vscodeConnection.getPort();
          const ctx = vscodeConnection.getContext();
          const statusIcon = status === "connected" ? symCheck : status === "connecting" ? symDot : symCross;
          const info = [
            `${statusIcon} VSCode: ${status}`,
            port ? `端口: ${port}` : "",
            ctx.activeFile ? `活动文件: ${ctx.activeFile}` : "",
          ]
            .filter(Boolean)
            .join("\n");
          deps.showToast?.(info || "VSCode 未连接", "info");
        } catch (error) {
          deps.showToast?.(`获取 IDE 状态失败: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
      slashName: "ide-status",
      title: "IDE 连接状态",
    },
    {
      category: "IDE",
      description: "安装 crab-cli VSCode 扩展",
      name: "ide.install",
      run: async () => {
        try {
          const { installExtension } = await import("@/ide/extension");
          const result = await installExtension("VSCode");
          if (result.success) {
            deps.showToast?.("VSCode 扩展安装成功！请重新加载窗口。", "success");
          } else {
            deps.showToast?.(`安装失败: ${result.error}`, "error");
          }
        } catch (error) {
          deps.showToast?.(`扩展安装失败: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
      slashName: "ide-install",
      title: "安装 VSCode 扩展",
    },
    {
      category: "IDE",
      description: "连接到 VSCode 扩展",
      name: "ide.connect",
      run: async () => {
        await connectIDE(deps);
      },
      slashName: "ide-connect",
      title: "连接 VSCode",
    },
    {
      category: "IDE",
      description: "获取当前文件的 VSCode 诊断信息",
      name: "ide.diagnostics",
      run: async (args) => {
        const filePath = args?.trim();
        if (!filePath) {
          deps.showToast?.("用法: /ide-diagnostics <文件路径>", "info");
          return;
        }
        try {
          const { vscodeConnection } = await import("@/ide/client");
          const diagnostics = await vscodeConnection.requestDiagnostics(filePath);
          if (diagnostics.length === 0) {
            deps.showToast?.("没有诊断信息", "info");
          } else {
            const errors = diagnostics.filter((d) => d.severity === "error").length;
            const warnings = diagnostics.filter((d) => d.severity === "warning").length;
            const lines = diagnostics.slice(0, 10).map((d) => {
              const icon =
                d.severity === "error"
                  ? iconError
                  : d.severity === "warning"
                    ? iconWarning
                    : d.severity === "info"
                      ? iconLsp
                      : iconLsp;
              return `${icon} L${d.line + 1}: ${d.message.slice(0, 60)}`;
            });
            deps.showToast?.(
              `${errors} 错误, ${warnings} 警告:\n${lines.join("\n")}`,
              diagnostics.some((d) => d.severity === "error") ? "error" : "warning",
            );
          }
        } catch (error) {
          deps.showToast?.(`获取诊断信息失败: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
      slashName: "ide-diagnostics",
      title: "IDE 诊断",
    },
    {
      category: "IDE",
      description: "启动或停止 IDE WebSocket 服务端(接受入站连接)",
      name: "ide.wsServer",
      run: async (args) => {
        try {
          const { ideWsServer } = await import("@/ide/connection");
          const action = args?.trim();

          if (action === "stop" || action === "off") {
            ideWsServer.stop();
            deps.showToast?.("WebSocket 服务端已停止", "success");
            return;
          }

          const port = action && !isNaN(Number(action)) ? Number(action) : 6850;
          ideWsServer.start(port);
          deps.showToast?.(`WebSocket 服务端已启动，端口 ${port}`, "success");
          eventBus.publish(AppEvent.Log, {
            level: "info",
            message: `IDE WebSocket 服务端已启动，端口 ${port}。VSCode 扩展可连接 ws://localhost:${port}`,
          });
        } catch (error) {
          deps.showToast?.(
            `WebSocket 服务端操作失败: ${error instanceof Error ? error.message : String(error)}`,
            "error",
          );
        }
      },
      slashName: "ide-ws",
      title: "WebSocket 服务端",
    },
    {
      category: "IDE",
      description: "查看已连接的 IDE WebSocket 客户端",
      name: "ide.wsClients",
      run: async () => {
        try {
          const { ideWsServer } = await import("@/ide/connection");
          const { port } = ideWsServer;
          const clients = ideWsServer.getClients();

          if (clients.length === 0 && !port) {
            deps.showToast?.("WebSocket 服务端未启动(/ide-ws [port] 启动)", "info");
            return;
          }

          const lines = [`WebSocket 服务端: ${port ? `端口 ${port}` : "未启动"}`, `已连接客户端: ${clients.length}`];

          if (clients.length > 0) {
            lines.push("");
            for (const c of clients) {
              const ws = c.workspaceFolder ?? "无工作区";
              const ago = Math.floor((Date.now() - c.lastActiveAt) / 1000);
              lines.push(`  [${c.id.slice(0, 8)}] ${ws} (${ago}s 前)`);
            }
          }

          eventBus.publish(AppEvent.Log, { level: "info", message: lines.join("\n") });
        } catch (error) {
          deps.showToast?.(`获取客户端列表失败: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
      slashName: "ide-clients",
      title: "WS 客户端列表",
    },
  ];
}
