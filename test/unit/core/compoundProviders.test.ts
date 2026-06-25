/**
 * Compound Provider 测试 — 验证 DataProviders 和 UIProviders 合并 Provider 后各 hook 正常工作。
 */
import { describe, expect, test } from "bun:test";
import { createRoot } from "solid-js";
import { DataProviders, UIProviders } from "@/ui/contexts/providers";
import { useConfig } from "@/ui/contexts/config";
import { useKV } from "@/ui/contexts/kv";
import { useToast } from "@/ui/contexts/toast";
import { useTheme } from "@/ui/contexts/theme";
import { useDialog } from "@/ui/contexts/dialog";
import { useCommandPalette } from "@/ui/contexts/commandPalette";
import { usePromptRef } from "@/ui/contexts/prompt";
import { useEditorContext } from "@/ui/contexts/editor";
import type { AppConfigSchema as AppConfigType } from "@/schema/config";

const mockConfig = {
  agents: [],
  defaultProvider: { model: "gpt-4o", provider: "openai" },
  permissions: [],
  profile: "test",
  providerConfig: {},
  theme: "opencode",
} as unknown as AppConfigType;

describe("DataProviders", () => {
  test("应提供 useConfig", () => {
    createRoot((dispose) => {
      DataProviders({
        get children() {
          const cfg = useConfig();
          expect(cfg.config.profile).toBe("test");
          expect(cfg.config.defaultProvider.model).toBe("gpt-4o");
          return null;
        },
        config: mockConfig,
        initialMode: "dark",
        initialTheme: "opencode",
      });
      dispose();
    });
  });

  test("应提供 useKV", () => {
    createRoot((dispose) => {
      DataProviders({
        get children() {
          const kv = useKV();
          kv.set("key1", "value1");
          expect(kv.get<string>("key1")).toBe("value1");
          expect(kv.get("nonexistent")).toBeUndefined();
          kv.remove("key1");
          expect(kv.get("key1")).toBeUndefined();
          return null;
        },
        config: mockConfig,
        initialMode: "dark",
        initialTheme: "opencode",
      });
      dispose();
    });
  });

  test("应提供 useToast", () => {
    createRoot((dispose) => {
      DataProviders({
        get children() {
          const toast = useToast();
          expect(typeof toast.show).toBe("function");
          expect(typeof toast.showWithOptions).toBe("function");
          expect(typeof toast.dismiss).toBe("function");
          // Show returns string ID (duration=0 prevents auto-dismiss timer)
          const id = toast.show("hello", "info", 0);
          expect(typeof id).toBe("string");
          // ShowWithOptions also returns string ID
          const id2 = toast.showWithOptions({ duration: 0, message: "world", type: "error" });
          expect(typeof id2).toBe("string");
          expect(id2).not.toBe(id);
          // Dismiss does not throw
          expect(() => toast.dismiss(id)).not.toThrow();
          return null;
        },
        config: mockConfig,
        initialMode: "dark",
        initialTheme: "opencode",
      });
      dispose();
    });
  });

  test("应提供 useTheme", () => {
    createRoot((dispose) => {
      DataProviders({
        get children() {
          const theme = useTheme();
          expect(theme.themeName).toBe("opencode");
          expect(theme.mode).toBe("dark");
          expect(theme.colors).toBeDefined();
          expect(theme.colors.background).toBeDefined();
          expect(theme.extended).toBeDefined();
          expect(theme.theme).toBeDefined();
          return null;
        },
        config: mockConfig,
        initialMode: "dark",
        initialTheme: "opencode",
      });
      dispose();
    });
  });
});

describe("UIProviders", () => {
  const run = (_cmd: string) => {};
  const show = () => {};

  test("应提供 useDialog", () => {
    createRoot((dispose) => {
      UIProviders({
        get children() {
          const dialog = useDialog();
          expect(typeof dialog.open).toBe("function");
          expect(typeof dialog.close).toBe("function");
          expect(typeof dialog.clear).toBe("function");
          expect(typeof dialog.replace).toBe("function");
          expect(typeof dialog.isOpen).toBe("function");
          // Open is a pure signal write, safe in SSR createRoot
          const id = dialog.open(null);
          expect(typeof id).toBe("string");
          expect(id).toMatch(/^dialog_/);
          // Close uses setStack setter (pure write), safe in SSR
          const id2 = dialog.open(null);
          expect(typeof id2).toBe("string");
          expect(id2).not.toBe(id);
          // Note: replace/clear read stack() then write setStack(),
          // Which triggers Solid.js SSR reactive cycle — tested separately
          return null;
        },
        commandRun: run,
        commandShow: show,
      });
      dispose();
    });
  });

  test("应提供 useCommandPalette", () => {
    createRoot((dispose) => {
      let runCalled = false;
      let showCalled = false;
      UIProviders({
        get children() {
          const palette = useCommandPalette();
          expect(typeof palette.run).toBe("function");
          expect(typeof palette.show).toBe("function");
          expect(typeof palette.suspend).toBe("function");
          // Run delegates to commandRun callback
          palette.run("/help");
          expect(runCalled).toBe(true);
          // Show delegates to commandShow callback
          palette.show();
          expect(showCalled).toBe(true);
          // Suspend does not throw
          expect(() => palette.suspend(true)).not.toThrow();
          expect(() => palette.suspend(false)).not.toThrow();
          return null;
        },
        commandRun: () => {
          runCalled = true;
        },
        commandShow: () => {
          showCalled = true;
        },
      });
      dispose();
    });
  });

  test("应提供 usePromptRef", () => {
    createRoot((dispose) => {
      UIProviders({
        get children() {
          const promptRef = usePromptRef();
          expect(promptRef.current).toBeUndefined();
          promptRef.set({ focus: () => {}, set: () => {}, submit: () => {}, value: "test" });
          expect(promptRef.current?.value).toBe("test");
          return null;
        },
        commandRun: run,
        commandShow: show,
      });
      dispose();
    });
  });

  test("应提供 useEditorContext", () => {
    createRoot((dispose) => {
      UIProviders({
        get children() {
          const editor = useEditorContext();
          expect(editor.enabled()).toBe(false);
          expect(editor.connected()).toBe(false);
          expect(editor.selection()).toBeUndefined();
          expect(editor.labelState()).toBe("none");
          return null;
        },
        commandRun: run,
        commandShow: show,
      });
      dispose();
    });
  });
});
