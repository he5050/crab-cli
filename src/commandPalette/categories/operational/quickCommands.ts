/**
 * 快捷工具命令集 — 日常高频操作
 *
 *   /speedometer — 实时 TPS 监控
 *   /copy-last   — 复制最后 AI 回复到剪贴板
 *   /export-file — 导出对话到文件（txt/md/html/json）
 *   /tool-display — 切换工具显示模式
 *   /notify      — 切换桌面通知
 *   /guard-test  — 测试流式超时保护（仅调试）
 */

import type { Command } from "@/commandPalette/type";
import type { CommandDeps } from "@/commandPalette/shared";
import { tpsTracker, connectTpsTrackerToEventBus } from "@/monitor/tps/tpsTracker";
import { exportToFile, autoExportPath, toExportMessages } from "@/conversation/export/chatExporter";
import {
  getToolDisplayMode,
  toggleToolDisplayMode,
  toolDisplayStatusMessage,
  type ToolDisplayMode,
} from "@/config/features/toolDisplayMode";
import { copyWithToast } from "@/ui/utils/clipboard";
import { createIdleTimeoutGuard } from "@/api/stream/streamGuard";
import { isNotificationEnabled, toggleNotification } from "@/core/utilities/platformNotification";
import type { ModelMessage } from "ai";

// ─── 辅助函数 ──────────────────────────────────────────

/** 从 ModelMessage.content 中提取纯文本（支持 string 和 ContentPart[]） */
function extractTextContent(content: ModelMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p): p is { type: "text"; text: string } => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("\n");
  }
  return "";
}

export function buildQuickCommands(deps: CommandDeps): Command[] {
  return [
    // ── /speedometer ─────────────────────────────────────
    {
      category: "operational",
      name: "speedometer",
      title: "TPS 测速仪",
      description: "实时监控 tokens/秒 输出速率",
      slashName: "speedometer",
      run: (_args?: string) => {
        const arg = _args?.trim().toLowerCase() ?? "";
        const active = tpsTracker.isActive();

        if (arg === "status") {
          const snapshot = tpsTracker.getSnapshot();
          const detail = active
            ? ` | 当前: ${snapshot.tps.toFixed(1)} tok/s | 峰值: ${snapshot.peakTps.toFixed(1)} tok/s`
            : "";
          deps.showToast?.(`${active ? "🚀 TPS 活跃中" : "💤 TPS 未启用"}${detail}`, "info");
          return;
        }

        if (arg === "on") {
          if (active) {
            deps.showToast?.("TPS 测速仪已启用 🚀", "info");
            return;
          }
          const bus = deps.eventBus;
          if (bus) connectTpsTrackerToEventBus(bus);
          tpsTracker.start();
          deps.showToast?.("TPS 测速仪已启用 🚀 — 输入 /speedometer status 查看", "success");
          return;
        }

        if (arg === "off") {
          tpsTracker.stop();
          deps.showToast?.("TPS 测速仪已关闭 💤", "info");
          return;
        }

        if (active) {
          tpsTracker.stop();
          deps.showToast?.("TPS 测速仪已关闭 💤", "info");
        } else {
          const bus = deps.eventBus;
          if (bus) connectTpsTrackerToEventBus(bus);
          tpsTracker.start();
          deps.showToast?.("TPS 测速仪已启用 🚀", "success");
        }
      },
    },

    // ── /copy-last ──────────────────────────────────────
    {
      category: "operational",
      name: "copy-last",
      title: "复制最后回复",
      description: "复制 AI 最后一条回复到剪贴板",
      slashName: "copy-last",
      run: () => {
        const history = deps.getConversationHistory?.() ?? [];
        // 从后向前查找最后一条 assistant 消息
        let lastContent = "";
        for (let i = history.length - 1; i >= 0; i--) {
          const msg = history[i];
          if (!msg) continue;
          if (msg.role === "assistant") {
            lastContent = extractTextContent(msg.content);
            if (lastContent) break;
          }
        }
        if (!lastContent) {
          deps.showToast?.("没有可复制的 AI 回复", "warning");
          return;
        }
        copyWithToast(lastContent, "已复制最后回复到剪贴板", deps.eventBus);
      },
    },

    // ── /export-file ──────────────────────────────────
    {
      category: "operational",
      name: "export-file",
      title: "导出对话文件",
      description: "导出当前对话到文件（支持 txt/md/html/json）",
      slashName: "export-file",
      run: (args?: string) => {
        const raw = (args ?? "").trim().toLowerCase();
        const format = raw.startsWith(".") ? raw.slice(1) : raw || "md";
        const supported = ["txt", "md", "html", "json"];
        if (!supported.includes(format)) {
          deps.showToast?.(`不支持 "${format}" 格式。支持: ${supported.join(", ")}`, "warning");
          return;
        }

        const history = deps.getConversationHistory?.() ?? [];
        if (history.length === 0) {
          deps.showToast?.("没有可导出的消息", "info");
          return;
        }

        const exportMsgs = toExportMessages(history);
        const filePath = autoExportPath(format as "txt" | "md" | "html" | "json");
        exportToFile(exportMsgs, filePath, format as "txt" | "md" | "html" | "json");
        deps.showToast?.(`对话已导出: ${filePath}`, "success");
      },
    },

    // ── /tool-display ────────────────────────────────
    {
      category: "operational",
      name: "tool-display",
      title: "工具显示模式",
      description: "切换工具调用的显示详细程度",
      slashName: "tool-display",
      run: (args?: string) => {
        const arg = args?.trim().toLowerCase() ?? "";
        const currentMode = getToolDisplayMode();

        if (arg === "status" || arg === "") {
          deps.showToast?.(toolDisplayStatusMessage(currentMode), "info");
          return;
        }

        if (["full", "compact", "hidden"].includes(arg)) {
          const changed = toggleToolDisplayMode(arg as ToolDisplayMode);
          if (!changed) {
            deps.showToast?.(`工具显示已经是 ${arg} 模式`, "info");
            return;
          }
          deps.showToast?.(`工具显示模式已切换为 ${arg} 模式`, "success");
          return;
        }

        deps.showToast?.("无效参数。支持: full / compact / hidden / status", "warning");
      },
    },

    // ── /notify ────────────────────────────────────────
    {
      category: "operational",
      name: "notify",
      title: "桌面通知",
      description: "切换对话完成后发送桌面通知",
      slashName: "notify",
      run: (_args?: string) => {
        const arg = _args?.trim().toLowerCase() ?? "";
        const enabled = isNotificationEnabled();

        if (arg === "status" || arg === "") {
          deps.showToast?.(`桌面通知: ${enabled ? "已启用" : "已关闭"}`, "info");
          return;
        }

        if (arg === "on") {
          if (enabled) {
            deps.showToast?.("桌面通知已启用", "info");
            return;
          }
          toggleNotification();
          deps.showToast?.("桌面通知已启用 — 对话完成后将发送桌面通知", "success");
          return;
        }

        if (arg === "off") {
          if (!enabled) {
            deps.showToast?.("桌面通知已关闭", "info");
            return;
          }
          toggleNotification();
          deps.showToast?.("桌面通知已关闭", "info");
          return;
        }

        const next = toggleNotification();
        const msg = next ? "桌面通知已启用" : "桌面通知已关闭";
        const variant = next ? "success" : "info";
        deps.showToast?.(msg, variant);
      },
    },

    // ── /guard-test ────────────────────────────────
    {
      category: "operational",
      name: "guard-test",
      title: "超时保护测试",
      description: "测试流式空闲超时保护（仅用于调试）",
      slashName: "guard-test",
      hidden: true,
      run: () => {
        const guard = createIdleTimeoutGuard({
          idleTimeoutMs: 10_000,
          onTimeout: () => {
            deps.showToast?.("[Guard Test] 流式超时保护触发！ (10s)", "warning");
          },
        });
        const interval = setInterval(() => guard.touch(), 1000);
        setTimeout(() => {
          clearInterval(interval);
          guard.dispose();
          const err = guard.getTimeoutError();
          if (err) {
            deps.showToast?.("[Guard Test] 超时保护未触发", "warning");
          } else {
            deps.showToast?.("[Guard Test] 超时保护正常触发 ✅", "success");
          }
        }, 12_000);
      },
    },
  ];
}
