/**
 * App 上下文 Provider 测试。
 *
 * 测试目标:
 *   - 验证 useRouteData 路由上下文解析正确
 *   - 验证 CommandPalette 上下文与 slashes 访问器
 *   - 验证 usePromptRef 上下文解析正确
 *   - 验证 useEditorContext 上下文解析正确
 */
import { describe, expect, test } from "bun:test";
import { createRoot } from "solid-js";
import { RouteProvider, useRoute, useRouteData } from "@/ui/contexts/route";
import { CommandPaletteProvider, useCommandPalette } from "@/ui/contexts/commandPalette";
import { PromptRefProvider, usePromptRef } from "@/ui/contexts/prompt";
import { EditorContextProvider, useEditorContext } from "@/ui/contexts/editor";

describe("App 上下文 Provider", () => {
  test("useRouteData 路由上下文解析正确", () => {
    createRoot((dispose) => {
      let route!: ReturnType<typeof useRoute>;
      let homeRoute!: ReturnType<typeof useRouteData<"home">>;
      let sessionRoute!: ReturnType<typeof useRouteData<"session">>;

      RouteProvider({
        get children() {
          route = useRoute();
          homeRoute = useRouteData("home");
          sessionRoute = useRouteData("session");
          return null;
        },
      });

      expect(homeRoute()?.type).toBe("home");
      expect(sessionRoute()).toBeUndefined();

      route.navigate({ sessionId: "ses-test", type: "session" });
      expect(sessionRoute()?.type).toBe("session");
      expect(sessionRoute()?.sessionId).toBe("ses-test");
      expect(homeRoute()).toBeUndefined();

      dispose();
    });
  });

  test("CommandPalette 上下文与 slashes 访问器", () => {
    createRoot((dispose) => {
      let executedCommand: string | undefined;
      let showCalled = false;
      let palette!: ReturnType<typeof useCommandPalette>;
      const fakeSlashes = () => [{ display: "/help", onSelect: () => {} }];

      CommandPaletteProvider({
        get children() {
          palette = useCommandPalette();
          return null;
        },
        run: (cmd) => {
          executedCommand = cmd;
        },
        show: () => {
          showCalled = true;
        },
        slashes: fakeSlashes,
      });

      palette.run("test-command");
      expect(executedCommand).toBe("test-command");

      palette.show();
      expect(showCalled).toBe(true);

      expect(palette.slashes().length).toBe(1);
      expect(palette.slashes()[0]?.display).toBe("/help");

      palette.suspend(true);
      expect(palette.suspended).toBe(true);

      palette.suspend(false);
      expect(palette.suspended).toBe(false);

      dispose();
    });
  });

  test("应解析 usePromptRef 上下文正确", () => {
    createRoot((dispose) => {
      PromptRefProvider({
        get children() {
          const promptRef = usePromptRef();
          expect(promptRef.current).toBeUndefined();

          const mockPrompt = {
            focus: () => {},
            set: () => {},
            submit: () => {},
            value: "test-prompt-value",
          };

          promptRef.set(mockPrompt);
          expect(promptRef.current).toBe(mockPrompt);
          expect(promptRef.current?.value).toBe("test-prompt-value");

          return null;
        },
      });
      dispose();
    });
  });

  test("应解析 useEditorContext 上下文正确", () => {
    createRoot((dispose) => {
      EditorContextProvider({
        get children() {
          const editor = useEditorContext();
          expect(editor.enabled()).toBe(false);
          expect(editor.connected()).toBe(false);
          expect(editor.selection()).toBeUndefined();
          expect(editor.labelState()).toBe("none");

          return null;
        },
      });
      dispose();
    });
  });
});
