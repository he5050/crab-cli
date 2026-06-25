/**
 * 命令集成测试。
 *
 * 测试目标:
 *   - 验证 createAppCommands 与命令注册表、事件总线之间的集成
 *
 * 测试用例:
 *   - 集成命令被注册到 registry
 *   - 命令执行后通过 globalBus 发出 AppEvent
 *   - 命令上下文(context)按预期生效
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createAppCommands } from "@/commandPalette/appCommands";
import { getCommandRegistry } from "@/commandPalette/registry";
import { globalBus } from "@/bus";
import { AppEvent } from "@/bus";

describe("Slash Commands TUI Integration", () => {
  let toasts: string[] = [];
  const fakeDeps = {
    back: () => {},
    clearScreen: () => {},
    createSession: () => {},
    getConfig: () => ({ autoformat: true }),
    getConversationHistory: () => [
      { content: "请导出这段对话", role: "user" },
      { content: "好的，这是当前对话。", role: "assistant" },
    ],
    getCurrentSessionId: () => "ses_tui_integration",
    navigate: () => {},
    requestExit: () => {},
    showToast: (msg: string) => {
      toasts.push(msg);
    },
  } as any;

  beforeEach(() => {
    toasts = [];
    const registry = getCommandRegistry();
    registry.clear();
    registry.registerAll(createAppCommands(fakeDeps));
  });

  test("/代理应发布 AppEvent.AgentPickerShow", async () => {
    let triggered = false;
    let roleTriggered = false;
    const unsub = globalBus.subscribe(AppEvent.AgentPickerShow, () => {
      triggered = true;
    });
    const unsubRole = globalBus.subscribe(AppEvent.RolePickerShow, () => {
      roleTriggered = true;
    });

    const registry = getCommandRegistry();
    const ok = await registry.executeSlash("agents");
    expect(ok).toBe(true);
    expect(triggered).toBe(true);
    expect(roleTriggered).toBe(false);
    unsub();
    unsubRole();
  });

  test("/角色应发布 AppEvent.RolePickerShow", async () => {
    let triggered = false;
    let agentTriggered = false;
    const unsub = globalBus.subscribe(AppEvent.RolePickerShow, () => {
      triggered = true;
    });
    const unsubAgent = globalBus.subscribe(AppEvent.AgentPickerShow, () => {
      agentTriggered = true;
    });

    const registry = getCommandRegistry();
    const ok = await registry.executeSlash("role");
    expect(ok).toBe(true);
    expect(triggered).toBe(true);
    expect(agentTriggered).toBe(false);
    unsub();
    unsubAgent();
  });

  test("/agent-role is a compatibility alias for AgentPicker, not RolePicker", async () => {
    let agentTriggered = false;
    let roleTriggered = false;
    const unsubAgent = globalBus.subscribe(AppEvent.AgentPickerShow, () => {
      agentTriggered = true;
    });
    const unsubRole = globalBus.subscribe(AppEvent.RolePickerShow, () => {
      roleTriggered = true;
    });

    const registry = getCommandRegistry();
    const ok = await registry.executeSlash("agent-role");
    expect(ok).toBe(true);
    expect(agentTriggered).toBe(true);
    expect(roleTriggered).toBe(false);
    unsubAgent();
    unsubRole();
  });

  test("/export should execute real shareSession and succeed", async () => {
    const registry = getCommandRegistry();
    const ok = await registry.executeSlash("export");
    expect(ok).toBe(true);
    // Real export should execute and print toast
    expect(toasts.some((t) => t.includes("对话已导出") || t.includes("导出已就绪"))).toBe(true);
  });

  test("/autoformat should toggle config.autoformat and publish ConfigUpdated", async () => {
    let configUpdatedTriggered = false;
    let autoformatValue: boolean | undefined;
    const unsub = globalBus.subscribe(AppEvent.ConfigUpdated, (evt) => {
      autoformatValue = (evt.properties.config as any).autoformat;
      configUpdatedTriggered = true;
    });

    const registry = getCommandRegistry();
    const ok = await registry.executeSlash("autoformat");
    expect(ok).toBe(true);
    expect(configUpdatedTriggered).toBe(true);
    expect(autoformatValue).toBe(false);
    unsub();
  });

  test("/system-prompt should update config.customSystemPrompt and publish ConfigUpdated", async () => {
    let customPromptSet: string = "";
    const unsub = globalBus.subscribe(AppEvent.ConfigUpdated, (evt) => {
      customPromptSet = (evt.properties.config as any).customSystemPrompt ?? "";
    });

    const registry = getCommandRegistry();
    const ok = await registry.executeSlash("system-prompt", "integration-prompt-test");
    expect(ok).toBe(true);
    expect(customPromptSet).toBe("integration-prompt-test");
    expect(toasts.some((t) => t.includes("自定义系统提示词已设置"))).toBe(true);
    unsub();
  });

  test("/system-prompt --clear should clear config.customSystemPrompt", async () => {
    let customPromptSet: string | undefined;
    const unsub = globalBus.subscribe(AppEvent.ConfigUpdated, (evt) => {
      customPromptSet = (evt.properties.config as any).customSystemPrompt;
    });

    const registry = getCommandRegistry();
    const ok = await registry.executeSlash("system-prompt", "--clear");
    expect(ok).toBe(true);
    expect(customPromptSet).toBe("");
    expect(toasts.some((t) => t.includes("自定义系统提示词已清除"))).toBe(true);
    unsub();
  });

  test("/system-prompt without content should show usage and skip config update", async () => {
    let configUpdatedTriggered = false;
    const unsub = globalBus.subscribe(AppEvent.ConfigUpdated, () => {
      configUpdatedTriggered = true;
    });

    const registry = getCommandRegistry();
    const ok = await registry.executeSlash("system-prompt", "   ");
    expect(ok).toBe(true);
    expect(configUpdatedTriggered).toBe(false);
    expect(toasts.some((t) => t.includes("用法: /system-prompt"))).toBe(true);
    unsub();
  });

  test("/btwStream should resolve to task.btw command surface", async () => {
    const registry = getCommandRegistry();
    const ok = await registry.executeSlash("btwStream");

    expect(ok).toBe(true);
    expect(toasts.some((t) => t.includes("用法: /btw <问题>"))).toBe(true);
  });
});
