import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import fs from "node:fs";
import path from "node:path";
import {
  TextPartView,
  ThinkingPartView,
  ToolPartView,
  reasoningSummary,
} from "@/ui/pages/session/components/messageParts";
import { getThemeDefinition, resolveThemeColors } from "@/config";
import type { ThemeColors } from "@/ui/contexts/theme";

let setup: Awaited<ReturnType<typeof testRender>> | undefined;
let colors: ThemeColors;

async function settle() {
  await Bun.sleep(30);
  await setup?.renderOnce();
  await Bun.sleep(30);
  await setup?.renderOnce();
}

afterEach(() => {
  if (setup) {
    setup.renderer.destroy();
    setup = undefined;
  }
});

describe("Enhanced Message Renderer", () => {
  beforeEach(() => {
    const theme = getThemeDefinition("one-dark");
    colors = resolveThemeColors(theme, "dark");
  });

  test("TextPartView 走原生 markdown 渲染路径", async () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/ui/pages/session/components/messageParts.tsx"),
      "utf8",
    );
    expect(source).toContain("export function TextPartView");
    expect(source).toContain("<markdown");
    expect(source).toContain("content={content()}");
    expect(source).toContain("onReuse");
    expect(source).toContain("copyToClip");
  });

  test("ToolPartView 已接入 Phase 6 renderer 分流", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/ui/pages/session/components/messageParts.tsx"),
      "utf8",
    );
    const renderers = fs.readFileSync(
      path.join(process.cwd(), "src/ui/pages/session/components/tools/toolRenderers.tsx"),
      "utf8",
    );
    expect(source).toContain("<ToolPartRenderer");
    expect(renderers).toContain("function ShellTool");
    expect(renderers).toContain("function ReadTool");
    expect(renderers).toContain("function ApplyPatchTool");
    expect(renderers).toContain("function TodoTool");
    expect(renderers).toContain("function TaskTool");
    expect(renderers).toContain("resolveToolRenderer");
    expect(renderers).toContain("buildToolDiffRoute");
  });

  test("reasoningSummary 提取 opencode bold title", () => {
    expect(reasoningSummary("**Inspecting PR workflow**\n\nBody").title).toBe("Inspecting PR workflow");
    expect(reasoningSummary("**Inspecting PR workflow**\n\nBody").body).toBe("Body");
    expect(reasoningSummary("Plain body").title).toBeNull();
    expect(reasoningSummary("Plain body").body).toBe("Plain body");
  });

  test("ThinkingPartView 源码包含 running 思考 header", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/ui/pages/session/components/messageParts.tsx"),
      "utf8",
    );
    expect(source).toContain("思考中: ");
    expect(source).toContain("Spinner label");
    expect(source).toContain("思考");
  });

  test("ThinkingPartView done 默认折叠为思考 + duration", async () => {
    setup = await testRender(
      () => (
        <ThinkingPartView
          part={{
            text: "**Inspecting PR workflow**\n\n这里是一段较长的思考过程。",
            time: { endedAt: 2500, startedAt: 1000 },
            type: "thinking",
          }}
          colors={colors}
          streaming={false}
        />
      ),
      { height: 8, width: 80 },
    );

    await settle();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("+ 思考");
    expect(frame).toContain("Inspecting PR workflow");
    expect(frame).toContain("1.5s");
    expect(frame).not.toContain("这里是一段较长的思考过程");
  });

  // SKIP: @opentui/solid test renderer's <diff> component does not support TextNodeRenderable in test env
  test.skip("ToolPartView 对编辑型工具显示文件与 diff 预览", async () => {
    const diff = [
      "--- a/src/demo.ts",
      "+++ b/src/demo.ts",
      "@@ -1,1 +1,1 @@",
      "-const oldValue = 1;",
      "+const newValue = 2;",
    ].join("\n");

    setup = await testRender(
      () => (
        <ToolPartView
          part={{
            args: JSON.stringify({ file_path: "src/demo.ts" }),
            output: diff,
            success: true,
            tool: "edit",
            type: "tool",
          }}
          colors={colors}
        />
      ),
      { height: 16, width: 100 },
    );

    await settle();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("src/demo.ts");
    expect(frame).toContain("oldValue");
    expect(frame).toContain("newValue");
  });
});
