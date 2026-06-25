/**
 * Buddy 宠物伴侣 — 斜杠命令
 *
 * 提供所有 /buddy 子命令:
 *   /buddy hatch [name]  — 孵化新宠物
 *   /buddy say <message>— 与宠物对话
 *   /buddy pet           — 抚摸宠物
 *   /buddy info           — 查看宠物信息
 *   /buddy rename <name> — 重命名
 *   /buddy mute           — 静音/取消静音
 *   /buddy reset          — 删除宠物
 */

import type { Command } from "@/commandPalette/type";
import type { CommandDeps } from "@/commandPalette/shared";
import {
  getCompanion,
  isCompanionMuted,
  hatchCompanion,
  renameCompanion,
  resetCompanion,
  setCompanionMuted,
  companionReaction,
  companionPetAt,
  companionRefresh,
} from "@/buddy";
import { generateBuddyReply, generateBuddyPetReply, getCompanionHatchGreeting, renderFace } from "@/buddy";

export function buildBuddyCommands(deps: CommandDeps): Command[] {
  return [
    {
      category: "buddy",
      name: "buddy-hatch",
      title: "孵化宠物",
      description: "孵化一个新的终端宠物伴侣",
      slashName: "buddy",
      suggested: true,
      run: async (args?: string) => {
        const sub = args?.trim();
        if (sub && sub !== "hatch") {
          // 不是 hatch 子命令，不处理
          return;
        }
        // 解析: /buddy hatch [name]
        const rest = args?.replace(/^hatch\s*/, "") ?? "";

        if (getCompanion()) {
          deps.showToast?.("你已经有宠物了！使用 /buddy reset 先删除当前宠物。", "warning");
          return;
        }

        const companion = hatchCompanion(rest.trim() || undefined);
        companionRefresh();
        deps.showToast?.(getCompanionHatchGreeting(companion), "success");
      },
    },
    {
      category: "buddy",
      name: "buddy-say",
      title: "与宠物对话",
      description: "向你的宠物发送消息，获取 AI 反应",
      slashName: "buddy",
      run: async (args?: string) => {
        const message = args?.replace(/^say\s*/, "").trim();
        if (!message) {
          deps.showToast?.("用法: /buddy say <message>", "info");
          return;
        }

        const companion = getCompanion();
        if (!companion) {
          deps.showToast?.("你还没有宠物！使用 /buddy hatch 来孵化一个。", "info");
          return;
        }

        const reply = await generateBuddyReply(companion, message);
        companionReaction(reply);
      },
    },
    {
      category: "buddy",
      name: "buddy-pet",
      title: "抚摸宠物",
      description: "温柔地抚摸你的宠物伴侣",
      slashName: "buddy",
      run: async (args?: string) => {
        const sub = args?.trim();
        if (sub && sub !== "pet") return;

        const companion = getCompanion();
        if (!companion) {
          deps.showToast?.("你还没有宠物！使用 /buddy hatch 来孵化一个。", "info");
          return;
        }

        companionPetAt();
        const reply = await generateBuddyPetReply(companion);
        if (reply) companionReaction(reply);
      },
    },
    {
      category: "buddy",
      name: "buddy-info",
      title: "宠物信息",
      description: "查看当前宠物伴侣的详细信息",
      slashName: "buddy",
      run: async (args?: string) => {
        if (args?.trim() !== "info") return;

        const companion = getCompanion();
        if (!companion) {
          deps.showToast?.("你还没有宠物。使用 /buddy hatch 来孵化一个！", "info");
          return;
        }

        const lines = [
          `🐾 ${companion.name} (${companion.species})`,
          `   Rarity: ${companion.rarity}${companion.shiny ? " ✨ shiny" : ""}`,
          `   Hat: ${companion.hat}`,
          `   Eye: ${companion.eye}`,
          `   Personality: ${companion.personality}`,
          `   Hatched: ${new Date(companion.hatchedAt).toLocaleDateString()}`,
          "",
          `   Stats:`,
          ...Object.entries(companion.stats)
            .sort(([, a], [, b]) => b - a)
            .map(
              ([name, value]) =>
                `     ${name}: ${"★".repeat(Math.min(value, 10))}${"☆".repeat(Math.max(0, 10 - value))}`,
            ),
          "",
          `   ${renderFace(companion)}`,
          isCompanionMuted() ? "   🔇 (muted)" : "   🔊 (active)",
        ];

        deps.showToast?.(lines.join("\n"), "info");
      },
    },
    {
      category: "buddy",
      name: "buddy-rename",
      title: "重命名宠物",
      description: "给你的宠物伴侣起个新名字",
      slashName: "buddy",
      run: async (args?: string) => {
        const name = args?.replace(/^rename\s*/, "").trim();
        if (!name) {
          deps.showToast?.("用法: /buddy rename <new name>", "info");
          return;
        }

        const companion = renameCompanion(name);
        if (companion) {
          companionRefresh();
          deps.showToast?.(`你的宠物现在叫 ${companion.name} 了！`, "success");
        } else {
          deps.showToast?.("没有找到宠物可以重命名。", "warning");
        }
      },
    },
    {
      category: "buddy",
      name: "buddy-mute",
      title: "静音/取消静音",
      description: "切换宠物的对话气泡显示",
      slashName: "buddy",
      run: async (args?: string) => {
        const sub = args?.trim();
        if (sub && sub !== "mute" && sub !== "unmute") return;

        const currentlyMuted = isCompanionMuted();
        const shouldMute = sub === "unmute" ? false : !currentlyMuted;
        setCompanionMuted(shouldMute);

        if (shouldMute) {
          deps.showToast?.("宠物已静音 🔇", "info");
        } else {
          deps.showToast?.("宠物已取消静音 🔊", "success");
          companionRefresh();
        }
      },
    },
    {
      category: "buddy",
      name: "buddy-reset",
      title: "删除宠物",
      description: "删除当前宠物伴侣（可重新孵化）",
      slashName: "buddy",
      run: async (args?: string) => {
        if (args?.trim() !== "reset") return;

        if (!getCompanion()) {
          deps.showToast?.("没有宠物可以删除。", "info");
          return;
        }

        resetCompanion();
        companionRefresh();
        deps.showToast?.("宠物已删除。使用 /buddy hatch 来孵化新的宠物！", "info");
      },
    },
  ];
}
