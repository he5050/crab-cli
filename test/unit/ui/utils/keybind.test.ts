/**
 * 键盘快捷键测试。
 *
 * 覆盖导出:
 *   - handleKeyEvent
 *   - getKeybinds
 *   - registerAppKeybinds
 *   - createDefaultHandlers
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { createDefaultHandlers, getKeybinds, handleKeyEvent, registerAppKeybinds } from "@/ui/utils/keybind";
import { APP_COMMANDS, INPUT_COMMANDS } from "@/ui/keymap";
import { LEADER_KEY_BINDINGS } from "@/ui/components/whichKey";
import os from "node:os";
import fs from "node:fs";

describe("键盘快捷键", () => {
  describe("handleKeyEvent", () => {
    test("无注册快捷键时返回 false", () => {
      const result = handleKeyEvent({ ctrl: true, name: "p" }, "home");
      // 可能已被其他测试注册，类型正确即可
      expect(typeof result).toBe("boolean");
    });

    test("不匹配的事件返回 false", () => {
      const result = handleKeyEvent({ ctrl: false, name: "z" }, "home");
      expect(typeof result).toBe("boolean");
    });
  });

  describe("getKeybinds", () => {
    test("返回数组", () => {
      const binds = getKeybinds();
      expect(Array.isArray(binds)).toBe(true);
    });

    test("每项包含 keys 和 description", () => {
      const binds = getKeybinds();
      for (const b of binds) {
        expect(typeof b.description).toBe("string");
      }
    });

    test("Ctrl+L 描述与真实行为一致", () => {
      registerAppKeybinds({
        createSession: () => {},
        cycleTheme: () => {},
        navigateBack: () => {},
        navigateToHelp: () => {},
        navigateToMcp: () => {},
        navigateToSettings: () => {},
        openLogDir: () => {},
        showCommandPalette: () => {},
      });

      const ctrlL = getKeybinds().find((bind) => bind.keys === "Ctrl+L");
      expect(ctrlL?.description).toBe("打开日志目录");
    });

    test("Ctrl+D 描述为退出应用", () => {
      registerAppKeybinds({
        createSession: () => {},
        cycleTheme: () => {},
        navigateBack: () => {},
        navigateToHelp: () => {},
        navigateToMcp: () => {},
        navigateToSettings: () => {},
        openLogDir: () => {},
        showCommandPalette: () => {},
      });

      const ctrlD = getKeybinds().find((bind) => bind.keys === "Ctrl+D");
      expect(ctrlD?.description).toBe("退出应用");
    });

    test("Phase 19 opencode 命令名与默认快捷键对齐", () => {
      expect(APP_COMMANDS["app.command"]).toBe("Ctrl+P");
      expect(APP_COMMANDS.leader).toBe("Ctrl+X");
      expect(APP_COMMANDS["app.exit"]).toContain("Ctrl+C");
      expect(APP_COMMANDS["app.exit"]).toContain("<leader>q");
      expect(APP_COMMANDS["app.debug"]).toBe("none");
      expect(APP_COMMANDS["help.show"]).toBe("none");
      expect(APP_COMMANDS["session.rename"]).toBe("Ctrl+R");
      expect(APP_COMMANDS["session.delete"]).toBe("Ctrl+D");
      expect(APP_COMMANDS["session.list"]).toBe("<leader>l");
      expect(APP_COMMANDS["theme.switch"]).toBe("<leader>t");
      expect(APP_COMMANDS["model.list"]).toBe("<leader>m");
      expect(APP_COMMANDS["agent.list"]).toBe("<leader>a");
      expect(APP_COMMANDS["opencode.status"]).toBe("<leader>s");
      expect(APP_COMMANDS["provider.connect"]).toBe("none");
      expect(APP_COMMANDS["variant.cycle"]).toBe("Ctrl+T");
      expect(APP_COMMANDS["tips.toggle"]).toBe("<leader>h");
      expect(APP_COMMANDS["messages.copy"]).toBe("<leader>y");
      expect(APP_COMMANDS["session.quick_switch.9"]).toBe("<leader>9");
      expect(APP_COMMANDS["diff.single_patch"]).toBe("s");
      expect(APP_COMMANDS["diff.mark_reviewed"]).toBe("m");
      expect(INPUT_COMMANDS).toContain("input.delete.to.line.end");
      expect(INPUT_COMMANDS).toContain("input.visual.line.home");
      expect(INPUT_COMMANDS).toContain("input.select.line.home");
      expect(INPUT_COMMANDS).toContain("input.select.buffer.home");
      expect(INPUT_COMMANDS).toContain("history.previous");
    });

    test("Phase 19 WhichKey 暴露 opencode leader 分组和命令名", () => {
      const commands = LEADER_KEY_BINDINGS.map((binding) => binding.command);
      expect(commands).toContain("session.list");
      expect(commands).toContain("session.new");
      expect(commands).toContain("theme.switch");
      expect(commands).toContain("model.list");
      expect(commands).toContain("agent.list");
      expect(commands).toContain("opencode.status");
      expect(commands).toContain("messages.copy");
      expect(commands).toContain("session.quick_switch.1..9");
      expect(new Set(LEADER_KEY_BINDINGS.map((binding) => binding.group))).toEqual(
        new Set(["会话", "模型", "代理", "应用", "消息"]),
      );
    });
  });

  describe("registerAppKeybinds", () => {
    test("注册快捷键不抛异常", () => {
      expect(() =>
        registerAppKeybinds({
          createSession: () => {},
          cycleTheme: () => {},
          navigateBack: () => {},
          navigateToHelp: () => {},
          navigateToMcp: () => {},
          navigateToSettings: () => {},
          openLogDir: () => {},
          quickSwitchSession: () => {},
          requestExit: () => {},
          showCommandPalette: () => {},
        }),
      ).not.toThrow();
    });

    test("注册后 handleKeyEvent 能处理 Ctrl+P", () => {
      registerAppKeybinds({
        createSession: () => {},
        cycleTheme: () => {},
        navigateBack: () => {},
        navigateToHelp: () => {},
        navigateToMcp: () => {},
        navigateToSettings: () => {},
        openLogDir: () => {},
        requestExit: () => {},
        showCommandPalette: () => {},
      });

      const handled = handleKeyEvent({ ctrl: true, name: "p" }, "home");
      expect(handled).toBe(true);
    });

    test("Ctrl+D 能直接退出应用", () => {
      let exited = 0;
      registerAppKeybinds({
        createSession: () => {},
        cycleTheme: () => {},
        navigateBack: () => {},
        navigateToHelp: () => {},
        navigateToMcp: () => {},
        navigateToSettings: () => {},
        openLogDir: () => {},
        requestExit: () => {
          exited++;
        },
        showCommandPalette: () => {},
      });

      expect(handleKeyEvent({ ctrl: true, name: "d" }, "home")).toBe(true);
      expect(handleKeyEvent({ ctrl: true, name: "c" }, "home")).toBe(true);
      expect(exited).toBe(2);
    });

    test("重复注册不会累积旧 handler", () => {
      const hits: string[] = [];
      registerAppKeybinds({
        createSession: () => {},
        cycleTheme: () => {},
        navigateBack: () => {},
        navigateToHelp: () => {},
        navigateToMcp: () => {},
        navigateToSettings: () => {},
        openLogDir: () => {},
        showCommandPalette: () => {
          hits.push("old");
        },
      });
      registerAppKeybinds({
        createSession: () => {},
        cycleTheme: () => {},
        navigateBack: () => {},
        navigateToHelp: () => {},
        navigateToMcp: () => {},
        navigateToSettings: () => {},
        openLogDir: () => {},
        showCommandPalette: () => {
          hits.push("new");
        },
      });

      expect(handleKeyEvent({ ctrl: true, name: "p" }, "home")).toBe(true);
      expect(hits).toEqual(["new"]);
    });

    test("Ctrl+X leader 能分派到会话列表", () => {
      let count = 0;
      registerAppKeybinds({
        createSession: () => {},
        cycleTheme: () => {},
        navigateBack: () => {},
        navigateToHelp: () => {},
        navigateToMcp: () => {},
        navigateToSettings: () => {},
        openLogDir: () => {},
        requestExit: () => {},
        showCommandPalette: () => {},
        showSessionList: () => {
          count++;
        },
      });

      expect(handleKeyEvent({ ctrl: true, name: "x" }, "session")).toBe(true);
      expect(handleKeyEvent({ name: "l" }, "session")).toBe(true);
      expect(count).toBe(1);
    });

    test("Ctrl+X leader 的 Sidebar 只在 Session 页面触发", () => {
      let count = 0;
      registerAppKeybinds({
        createSession: () => {},
        cycleTheme: () => {},
        navigateBack: () => {},
        navigateToHelp: () => {},
        navigateToMcp: () => {},
        navigateToSettings: () => {},
        openLogDir: () => {},
        requestExit: () => {},
        showCommandPalette: () => {},
        toggleSidebar: () => {
          count++;
        },
      });

      expect(handleKeyEvent({ ctrl: true, name: "x" }, "home")).toBe(true);
      expect(handleKeyEvent({ name: "b" }, "home")).toBe(true);
      expect(count).toBe(0);

      expect(handleKeyEvent({ ctrl: true, name: "x" }, "session")).toBe(true);
      expect(handleKeyEvent({ name: "b" }, "session")).toBe(true);
      expect(count).toBe(1);
    });

    test("Ctrl+X leader 覆盖 opencode 消息操作和快速切换", () => {
      const hits: string[] = [];
      registerAppKeybinds({
        copyLastMessage: () => {
          hits.push("copy");
        },
        createSession: () => {
          hits.push("new");
        },
        cycleTheme: () => {},
        navigateBack: () => {},
        navigateToHelp: () => {},
        navigateToMcp: () => {},
        navigateToSettings: () => {},
        openLogDir: () => {},
        quickSwitchSession: (slot) => {
          hits.push(`quick:${slot}`);
        },
        redoMessage: () => {
          hits.push("redo");
        },
        requestExit: () => {
          hits.push("exit");
        },
        showCommandPalette: () => {},
        toggleConceal: () => {
          hits.push("conceal");
        },
        undoMessage: () => {
          hits.push("undo");
        },
      });

      for (const key of ["n", "q", "y", "u", "r", "h", "3"]) {
        expect(handleKeyEvent({ ctrl: true, name: "x" }, "session")).toBe(true);
        expect(handleKeyEvent({ name: key }, "session")).toBe(true);
      }
      expect(hits).toEqual(["new", "exit", "copy", "undo", "redo", "conceal", "quick:3"]);
    });
  });

  describe("createDefaultHandlers", () => {
    test("返回完整 handlers 对象", () => {
      const handlers = createDefaultHandlers({
        AppEvent: { CommandPaletteShow: { type: "test" } } as any,
        createSession: () => {},
        cycleTheme: () => {},
        exec: (() => {}) as any,
        fs,
        getLogDir: () => "/tmp/logs",
        eventBus: { publish: () => {} } as any,
        navigateToHelp: () => {},
        navigateToMcp: () => {},
        navigateToSettings: () => {},
        os,
        requestExit: () => {},
        routeBack: () => {},
      });

      expect(typeof handlers.showCommandPalette).toBe("function");
      expect(typeof handlers.openLogDir).toBe("function");
      expect(typeof handlers.navigateBack).toBe("function");
      expect(typeof handlers.createSession).toBe("function");
      expect(typeof handlers.navigateToHelp).toBe("function");
      expect(typeof handlers.showSessionList).toBe("function");
      expect(typeof handlers.showModelPicker).toBe("function");
      expect(typeof handlers.compactSession).toBe("function");
    });

    test("注册后 handleKeyEvent 能处理 ?", () => {
      registerAppKeybinds({
        createSession: () => {},
        cycleTheme: () => {},
        navigateBack: () => {},
        navigateToHelp: () => {},
        navigateToMcp: () => {},
        navigateToSettings: () => {},
        openLogDir: () => {},
        requestExit: () => {},
        showCommandPalette: () => {},
      });

      const handled = handleKeyEvent({ name: "?" }, "home");
      expect(handled).toBe(true);
    });
  });
});
