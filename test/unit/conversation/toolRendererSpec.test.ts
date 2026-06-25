/**
 * [测试目标] 工具渲染器规范。
 *
 * 测试目标:
 *   - 验证 resolveToolRenderer 在 read / webfetch / web-search / todowrite / ask_user / subagent / multi-edit / shell 等工具上的渲染器分配
 *
 * 测试用例:
 *   - read 工具走 InlineTool 字典:filesystem-read 解析为 ReadTool inline
 *   - opencode 专用 renderer aliases 覆盖 web/todo/question/task/edit:分别断言各别名工具指向的 renderer
 *   - shell 工具走 BlockTool 字典:bash 解析为 ShellTool block，且 getToolTitle 提取命令首行
 *   - 未知工具可通过 files metadata 推断为 patch renderer:mcp-unknown 带 patch 文件时被识别为 patch renderer
 */
import { describe, expect, test } from "bun:test";
import {
  getToolDiagnostics,
  getToolDiff,
  getToolFiles,
  getToolTitle,
  resolveToolRenderer,
} from "@/ui/pages/session/components/tools/toolRenderSpec";
import type { ToolPart } from "@/ui/contexts/chat";

function tool(part: Partial<ToolPart>): ToolPart {
  return {
    status: "done",
    success: true,
    tool: "unknown",
    type: "tool",
    ...part,
  };
}

describe("ToolRenderSpec", () => {
  test("read 工具走 InlineTool 字典", () => {
    const spec = resolveToolRenderer(tool({ input: { path: "src/app.tsx" }, tool: "filesystem-read" }));
    expect(spec.name).toBe("ReadTool");
    expect(spec.variant).toBe("inline");
    expect(spec.icon).toBe("➜");
  });

  test("opencode 专用 renderer aliases 覆盖 web/todo/question/task/edit", () => {
    expect(resolveToolRenderer(tool({ input: { url: "https://example.com" }, tool: "webfetch" })).name).toBe(
      "WebFetchTool",
    );
    expect(resolveToolRenderer(tool({ input: { query: "opencode" }, tool: "web-search" })).name).toBe("WebSearchTool");
    expect(resolveToolRenderer(tool({ input: { todos: [] }, tool: "todowrite" })).name).toBe("TodoTool");
    expect(resolveToolRenderer(tool({ input: { action: "get" }, tool: "todo-ultra" })).name).toBe("TodoTool");
    expect(resolveToolRenderer(tool({ input: { questions: [] }, tool: "ask_user" })).name).toBe("QuestionTool");
    expect(resolveToolRenderer(tool({ input: { description: "review" }, tool: "subagent" })).name).toBe("TaskTool");
    expect(resolveToolRenderer(tool({ input: { filePath: "src/a.ts" }, tool: "multi-edit" })).name).toBe(
      "MultiEditTool",
    );
  });

  test("shell 工具走 BlockTool 字典", () => {
    const spec = resolveToolRenderer(tool({ input: { command: "bun test" }, tool: "bash" }));
    expect(spec.name).toBe("ShellTool");
    expect(spec.variant).toBe("block");
    expect(getToolTitle(tool({ input: { command: "bun test" }, tool: "bash" }), spec)).toBe("bun test");
  });

  test("未知工具可通过 files metadata 推断为 patch renderer", () => {
    const spec = resolveToolRenderer(
      tool({
        files: [{ kind: "patch", path: "src/app.tsx" }],
        tool: "mcp-unknown",
      }),
    );
    expect(spec.name).toBe("ApplyPatchTool");
    expect(spec.variant).toBe("block");
  });

  test("未知工具默认使用 GenericTool", () => {
    const spec = resolveToolRenderer(tool({ tool: "mcp-custom" }));
    expect(spec.name).toBe("GenericTool");
    expect(spec.variant).toBe("hybrid");
    expect(spec.visibility).toBe("generic-output-toggle");
  });

  test("metadata-first 提取 diff/files/diagnostics", () => {
    const part = tool({
      metadata: {
        diagnostics: [{ message: "broken", severity: "error" }],
        diff: "--- a/demo.ts\n+++ b/demo.ts",
        files: [{ kind: "patch", path: "demo.ts", status: "done" }],
      },
      tool: "mcp-custom",
    });
    expect(getToolDiff(part)).toContain("demo.ts");
    expect(getToolFiles(part)[0]!.path).toBe("demo.ts");
    expect((getToolDiagnostics(part)[0] as any).severity).toBe("error");
  });

  test("part.files 优先于 metadata.files", () => {
    const part = tool({
      files: [{ kind: "edit", path: "real.ts" }],
      metadata: { files: [{ path: "metadata.ts" }] },
      tool: "mcp-custom",
    });
    expect(getToolFiles(part)[0]!.path).toBe("real.ts");
  });
});
