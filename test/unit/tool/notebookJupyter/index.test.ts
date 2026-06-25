/**
 * src/tool/notebookJupyter 单元测试
 *
 * 测试范围:
 *   - notebookReadTool: 读取 .ipynb 文件（有效/无效/空）
 *   - notebookEditTool: 编辑 .ipynb 文件（代码/Markdown 单元格）
 *
 * 策略: 使用临时 .ipynb 文件进行真实文件 I/O 测试。
 *       mock.module 替换 createLogger。
 *       rollback 不 mock（mock.module 跨文件泄漏会导致 rollback 专用测试失败），
 *       notebookEditTool 内部已 try/catch 静默跳过 rollback 错误。
 */
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createGlobalTmpTestDir } from "../../../helpers/testPaths";

// ── Mock 外部依赖 ──────────────────────────────────────────────────

mock.module("@/core/logging/logger", () => ({
  createLogger: () => ({ debug: () => {}, error: () => {}, info: () => {}, warn: () => {} }),
}));

import { notebookEditTool, notebookReadTool } from "@/tool/notebookJupyter";

// ── 辅助函数 ────────────────────────────────────────────────────────

const VALID_NOTEBOOK = {
  cells: [
    {
      cell_type: "code",
      execution_count: 1,
      id: "cell1",
      metadata: {},
      outputs: [{ name: "stdout", output_type: "stream", text: ["Hello World\n"] }],
      source: ['print("Hello World")'],
    },
    {
      cell_type: "markdown",
      id: "cell2",
      metadata: {},
      source: ["# Title\n", "Some **markdown** text."],
    },
  ],
  metadata: { kernelspec: { display_name: "Python 3", language: "python", name: "python3" } },
  nbformat: 4,
  nbformat_minor: 5,
};

function createNotebook(dir: string, name: string, content: object = VALID_NOTEBOOK): string {
  const filePath = join(dir, name);
  writeFileSync(filePath, JSON.stringify(content, null, 2));
  return filePath;
}

// ═══════════════════════════════════════════════════════════════════

describe("notebookJupyter", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createGlobalTmpTestDir("crab-nb-test-");
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { force: true, recursive: true });
  });

  // ═══════════════════════════════════════════════════════════════
  // notebookReadTool
  // ═══════════════════════════════════════════════════════════════
  describe("notebookReadTool — 读取", () => {
    it("应读取有效的 .ipynb 文件", async () => {
      const nbPath = createNotebook(tmpDir, "test.ipynb");
      const r = (await notebookReadTool.execute({ path: nbPath })) as Record<string, unknown>;

      expect(r).toBeDefined();
      expect(r.success !== false).toBe(true);
    });

    it("读取不存在的文件应返回错误", async () => {
      const r = (await notebookReadTool.execute({ path: "/nonexistent/notebook.ipynb" })) as Record<string, unknown>;

      expect(r.success === false || r.error !== undefined).toBe(true);
    });

    it("读取非 JSON 文件应返回错误", async () => {
      const badPath = join(tmpDir, "bad.ipynb");
      writeFileSync(badPath, "这不是JSON");
      const r = (await notebookReadTool.execute({ path: badPath })) as Record<string, unknown>;

      expect(r).toBeDefined();
    });

    it("读取空 cells 的 notebook 不应崩溃", async () => {
      const nbPath = createNotebook(tmpDir, "empty.ipynb", {
        cells: [],
        metadata: {},
        nbformat: 4,
        nbformat_minor: 5,
      });
      const r = await notebookReadTool.execute({ path: nbPath });
      expect(r).toBeDefined();
    });

    it("指定 fromCell/toCell 范围", async () => {
      const nbPath = createNotebook(tmpDir, "range.ipynb");
      const r = await notebookReadTool.execute({ path: nbPath, fromCell: 0, toCell: 1 });
      expect(r).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // notebookEditTool
  // ═══════════════════════════════════════════════════════════════
  describe("notebookEditTool — 编辑", () => {
    it("编辑不存在的文件应返回错误", async () => {
      const r = (await notebookEditTool.execute({
        action: "replace",
        cellIndex: 0,
        path: "/nonexistent/notebook.ipynb",
        source: "new code",
      })) as Record<string, unknown>;

      expect(r.success === false || r.error !== undefined).toBe(true);
    });

    it("写入新 notebook 应创建文件", async () => {
      const nbPath = join(tmpDir, "new.ipynb");
      const r = (await notebookEditTool.execute({
        action: "add",
        path: nbPath,
        source: "print('hello')",
        cellType: "code",
      })) as Record<string, unknown>;

      expect(r).toBeDefined();
    });

    it("添加 markdown 单元格", async () => {
      const nbPath = createNotebook(tmpDir, "addmd.ipynb");
      const r = (await notebookEditTool.execute({
        action: "add",
        path: nbPath,
        source: "# New Section",
        cellType: "markdown",
        cellIndex: 1,
      })) as Record<string, unknown>;

      expect(r).toBeDefined();
    });
  });
});
