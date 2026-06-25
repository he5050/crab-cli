/**
 * 对齐工具测试。
 *
 * 测试用例:
 *   - 代码对齐
 *   - 文本对齐
 *   - 格式化
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../helpers/testPaths";

import { filesystemMultiEditTool } from "@/tool/filesystem/multiEdit";
import { notebookReadTool } from "@/tool/notebookJupyter/read";
import { notebookEditTool } from "@/tool/notebookJupyter/edit";
import { lspTool } from "@/tool/lsp";
import { planModeTool } from "@/tool/planMode";
import { lspManager } from "@/lsp/index";

// 真实模块导入(不再使用 mock.module)
const { toolSearchTool } = await import("@/tool/toolSearch");
const { ToolExecutor } = await import("@/tool/executor/toolExecutor");

// ── MultiEdit ──────────────────────────────────────────────────

describe("multi-edit", () => {
  const tmpDir = createGlobalTmpTestDir("crab-test-multiedit-");

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "a.ts"), "const x = 1;\nconst y = 2;\n");
    fs.writeFileSync(path.join(tmpDir, "b.ts"), "export function hello() { return 'world'; }\n");
  });

  afterEach(() => {
    cleanupTestDir(tmpDir);
  });

  test("工具结构完整", () => {
    expect(filesystemMultiEditTool.name).toBe("filesystem-multi-edit");
    expect(filesystemMultiEditTool.permission).toBe("fs.edit");
    expect(typeof filesystemMultiEditTool.execute).toBe("function");
  });

  test("参数 Schema 验证", () => {
    const schema = filesystemMultiEditTool.parameters;
    expect(
      schema.safeParse({
        edits: [{ file: "a.ts", newText: "z", oldText: "x" }],
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ edits: [] }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });

  test("原子编辑多个文件", async () => {
    const result = (await filesystemMultiEditTool.execute({
      edits: [
        { file: path.join(tmpDir, "a.ts"), newText: "const x = 10", oldText: "const x = 1" },
        { file: path.join(tmpDir, "b.ts"), newText: "'crab'", oldText: "'world'" },
      ],
    })) as any;

    expect(result.success).toBe(true);
    expect(result.totalEdits).toBe(2);
    expect(result.filesModified).toBe(2);

    const a = fs.readFileSync(path.join(tmpDir, "a.ts"), "utf8");
    const b = fs.readFileSync(path.join(tmpDir, "b.ts"), "utf8");
    expect(a).toContain("const x = 10");
    expect(b).toContain("'crab'");
  });

  test("编辑失败时全部回滚", async () => {
    const result = (await filesystemMultiEditTool.execute({
      edits: [
        { file: path.join(tmpDir, "a.ts"), newText: "const x = 10", oldText: "const x = 1" },
        { file: path.join(tmpDir, "b.ts"), newText: "new", oldText: "不存在的内容" },
      ],
    })) as any;

    expect(result.success).toBe(false);
    expect(result.rolledBack).toBe(true);

    const a = fs.readFileSync(path.join(tmpDir, "a.ts"), "utf8");
    expect(a).toContain("const x = 1");
  });

  test("预览模式不写入", async () => {
    const result = (await filesystemMultiEditTool.execute({
      dryRun: true,
      edits: [{ file: path.join(tmpDir, "a.ts"), newText: "const x = 99", oldText: "const x = 1" }],
    })) as any;

    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);

    const a = fs.readFileSync(path.join(tmpDir, "a.ts"), "utf8");
    expect(a).toContain("const x = 1");
    expect(a).not.toContain("99");
  });

  test("replaceAll 替换所有匹配", async () => {
    fs.writeFileSync(path.join(tmpDir, "c.ts"), "foo foo foo\n");
    const result = (await filesystemMultiEditTool.execute({
      edits: [{ file: path.join(tmpDir, "c.ts"), newText: "bar", oldText: "foo", replaceAll: true }],
    })) as any;

    expect(result.success).toBe(true);
    const c = fs.readFileSync(path.join(tmpDir, "c.ts"), "utf8");
    expect(c).toBe("bar bar bar\n");
  });

  test("单文件编辑", async () => {
    const result = (await filesystemMultiEditTool.execute({
      edits: [{ file: path.join(tmpDir, "a.ts"), newText: "const x = 42", oldText: "const x = 1" }],
    })) as any;

    expect(result.success).toBe(true);
    expect(result.totalEdits).toBe(1);
    expect(result.filesModified).toBe(1);

    const a = fs.readFileSync(path.join(tmpDir, "a.ts"), "utf8");
    expect(a).toContain("const x = 42");
  });

  test("baseDir 解析相对路径", async () => {
    const result = (await filesystemMultiEditTool.execute({
      baseDir: tmpDir,
      edits: [{ file: "a.ts", newText: "const x = 55", oldText: "const x = 1" }],
    })) as any;

    expect(result.success).toBe(true);
    const a = fs.readFileSync(path.join(tmpDir, "a.ts"), "utf8");
    expect(a).toContain("const x = 55");
  });

  test("同一文件多处编辑", async () => {
    const result = (await filesystemMultiEditTool.execute({
      edits: [
        { file: path.join(tmpDir, "a.ts"), newText: "const x = 10", oldText: "const x = 1" },
        { file: path.join(tmpDir, "a.ts"), newText: "const y = 20", oldText: "const y = 2" },
      ],
    })) as any;

    expect(result.success).toBe(true);
    const a = fs.readFileSync(path.join(tmpDir, "a.ts"), "utf8");
    expect(a).toContain("const x = 10");
    expect(a).toContain("const y = 20");
  });

  test("oldText 为空返回错误", async () => {
    const result = (await filesystemMultiEditTool.execute({
      edits: [{ file: path.join(tmpDir, "a.ts"), newText: "x", oldText: "" }],
    })) as any;

    expect(result.success).toBe(false);
    expect(result.rolledBack).toBe(true);
  });

  test("不存在的文件返回错误", async () => {
    const result = (await filesystemMultiEditTool.execute({
      edits: [{ file: path.join(tmpDir, "nonexistent.ts"), newText: "y", oldText: "x" }],
    })) as any;

    expect(result.success).toBe(false);
    expect(result.error).toContain("文件不存在");
  });

  test("replaceAll 为 false 时只替换第一处", async () => {
    fs.writeFileSync(path.join(tmpDir, "d.ts"), "aaa bbb aaa\n");
    const result = (await filesystemMultiEditTool.execute({
      edits: [{ file: path.join(tmpDir, "d.ts"), newText: "zzz", oldText: "aaa", replaceAll: false }],
    })) as any;

    expect(result.success).toBe(true);
    const d = fs.readFileSync(path.join(tmpDir, "d.ts"), "utf8");
    expect(d).toBe("zzz bbb aaa\n");
  });
});

// ── Notebook Read/Edit ──────────────────────────────────────────

describe("notebook-read", () => {
  const tmpDir = createGlobalTmpTestDir("crab-test-nb-");
  let nbPath: string;

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    nbPath = path.join(tmpDir, "test.ipynb");
    const notebook = {
      cells: [
        { cell_type: "markdown", metadata: {}, source: ["# Title\n"] },
        {
          cell_type: "code",
          execution_count: 1,
          metadata: {},
          outputs: [{ output_type: "stream", text: ["hello\n"] }],
          source: ["print('hello')"],
        },
      ],
      metadata: { language_info: { name: "python" } },
      nbformat: 4,
      nbformat_minor: 5,
    };
    fs.writeFileSync(nbPath, JSON.stringify(notebook, null, 1));
  });

  afterEach(() => {
    cleanupTestDir(tmpDir);
  });

  test("工具结构完整", () => {
    expect(notebookReadTool.name).toBe("notebook-read");
    expect(notebookReadTool.permission).toBe("fs.read");
  });

  test("读取 Notebook 内容", async () => {
    const result = (await notebookReadTool.execute({ path: nbPath })) as any;
    expect(result.success).toBe(true);
    expect(result.totalCells).toBe(2);
    expect(result.cells[0].type).toBe("markdown");
    expect(result.cells[1].type).toBe("code");
    expect(result.cells[1].source).toContain("print");
    expect(result.metadata.language).toBe("python");
  });

  test("指定范围读取", async () => {
    const result = (await notebookReadTool.execute({ fromCell: 1, path: nbPath, toCell: 2 })) as any;
    expect(result.success).toBe(true);
    expect(result.displayedCells).toBe(1);
    expect(result.cells[0].index).toBe(1);
  });

  test("非 .ipynb 文件返回错误", async () => {
    const result = (await notebookReadTool.execute({ path: path.join(tmpDir, "test.txt") })) as any;
    expect(result.success).toBe(false);
  });

  test("不存在的文件返回错误", async () => {
    const result = (await notebookReadTool.execute({ path: path.join(tmpDir, "missing.ipynb") })) as any;
    expect(result.success).toBe(false);
    expect(result.error).toContain("文件不存在");
  });

  test("读取 code cell 的 outputs", async () => {
    const result = (await notebookReadTool.execute({ path: nbPath })) as any;
    expect(result.success).toBe(true);
    const codeCell = result.cells[1];
    expect(codeCell.outputs).toBeDefined();
    expect(codeCell.outputs.length).toBeGreaterThan(0);
    expect(codeCell.outputs[0].type).toBe("stream");
    expect(codeCell.outputs[0].text).toContain("hello");
  });

  test("读取 content 可读文本", async () => {
    const result = (await notebookReadTool.execute({ path: nbPath })) as any;
    expect(result.success).toBe(true);
    expect(result.content).toContain("[code]");
    expect(result.content).toContain("print");
  });

  test("空 cells 数组", async () => {
    const emptyNb = {
      cells: [],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    };
    fs.writeFileSync(nbPath, JSON.stringify(emptyNb, null, 1));

    const result = (await notebookReadTool.execute({ path: nbPath })) as any;
    expect(result.success).toBe(true);
    expect(result.totalCells).toBe(0);
    expect(result.cells).toEqual([]);
  });

  test("string 类型 source", async () => {
    const nb = {
      cells: [{ cell_type: "code", execution_count: null, metadata: {}, outputs: [], source: "x = 1" }],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    };
    fs.writeFileSync(nbPath, JSON.stringify(nb, null, 1));

    const result = (await notebookReadTool.execute({ path: nbPath })) as any;
    expect(result.success).toBe(true);
    expect(result.cells[0].source).toBe("x = 1");
  });
});

describe("notebook-edit", () => {
  const tmpDir = createGlobalTmpTestDir("crab-test-nbe-");
  let nbPath: string;

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    nbPath = path.join(tmpDir, "test.ipynb");
    const notebook = {
      cells: [{ cell_type: "code", execution_count: null, metadata: {}, outputs: [], source: ["x = 1"] }],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    };
    fs.writeFileSync(nbPath, JSON.stringify(notebook, null, 1));
  });

  afterEach(() => {
    cleanupTestDir(tmpDir);
  });

  test("工具结构完整", () => {
    expect(notebookEditTool.name).toBe("notebook-edit");
    expect(notebookEditTool.permission).toBe("fs.edit");
  });

  test("添加单元格", async () => {
    const result = (await notebookEditTool.execute({
      action: "add",
      cellType: "code",
      path: nbPath,
      source: "y = 2",
    })) as any;

    expect(result.success).toBe(true);
    expect(result.totalCells).toBe(2);

    const nb = JSON.parse(fs.readFileSync(nbPath, "utf8"));
    expect(nb.cells.length).toBe(2);
    expect(nb.cells[1].source.join("")).toContain("y = 2");
  });

  test("替换单元格内容", async () => {
    const result = (await notebookEditTool.execute({
      action: "replace",
      cellIndex: 0,
      path: nbPath,
      source: "x = 42",
    })) as any;

    expect(result.success).toBe(true);
    const nb = JSON.parse(fs.readFileSync(nbPath, "utf8"));
    expect(nb.cells[0].source.join("")).toContain("x = 42");
  });

  test("删除单元格", async () => {
    const result = (await notebookEditTool.execute({
      action: "delete",
      cellIndex: 0,
      path: nbPath,
    })) as any;

    expect(result.success).toBe(true);
    expect(result.totalCells).toBe(0);
  });

  test("无效 cellIndex 返回错误", async () => {
    const result = (await notebookEditTool.execute({
      action: "replace",
      cellIndex: 99,
      path: nbPath,
      source: "x",
    })) as any;
    expect(result.success).toBe(false);
  });

  test("添加 markdown 单元格", async () => {
    const result = (await notebookEditTool.execute({
      action: "add",
      cellType: "markdown",
      path: nbPath,
      source: "# Hello World",
    })) as any;

    expect(result.success).toBe(true);
    expect(result.cellType).toBe("markdown");

    const nb = JSON.parse(fs.readFileSync(nbPath, "utf8"));
    expect(nb.cells[1].cell_type).toBe("markdown");
    expect(nb.cells[1].source.join("")).toContain("# Hello World");
  });

  test("添加单元格带 cellId", async () => {
    const result = (await notebookEditTool.execute({
      action: "add",
      cellId: "my-cell-id",
      cellType: "code",
      path: nbPath,
      source: "z = 3",
    })) as any;

    expect(result.success).toBe(true);
    const nb = JSON.parse(fs.readFileSync(nbPath, "utf8"));
    expect(nb.cells[1].id).toBe("my-cell-id");
  });

  test("replace 保留 execution_count 和 outputs", async () => {
    const nb = {
      cells: [
        {
          cell_type: "code",
          execution_count: 5,
          metadata: { folded: true },
          outputs: [{ output_type: "stream", text: ["hello\n"] }],
          source: ["print('hello')"],
        },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    };
    fs.writeFileSync(nbPath, JSON.stringify(nb, null, 1));

    const result = (await notebookEditTool.execute({
      action: "replace",
      cellIndex: 0,
      path: nbPath,
      source: "print('world')",
    })) as any;

    expect(result.success).toBe(true);
    const updated = JSON.parse(fs.readFileSync(nbPath, "utf8"));
    expect(updated.cells[0].execution_count).toBe(5);
    expect(updated.cells[0].outputs.length).toBe(1);
    expect(updated.cells[0].metadata.folded).toBe(true);
    expect(updated.cells[0].source.join("")).toContain("print('world')");
  });

  test("add 默认追加到末尾", async () => {
    (await notebookEditTool.execute({
      action: "add",
      path: nbPath,
      source: "second",
    })) as any;

    (await notebookEditTool.execute({
      action: "add",
      path: nbPath,
      source: "third",
    })) as any;

    const nb = JSON.parse(fs.readFileSync(nbPath, "utf8"));
    expect(nb.cells.length).toBe(3);
    expect(nb.cells[2].source.join("")).toContain("third");
  });

  test("add 指定插入位置", async () => {
    const result = (await notebookEditTool.execute({
      action: "add",
      cellIndex: 0,
      path: nbPath,
      source: "inserted",
    })) as any;

    expect(result.success).toBe(true);
    const nb = JSON.parse(fs.readFileSync(nbPath, "utf8"));
    expect(nb.cells[0].source.join("")).toContain("inserted");
    expect(nb.cells[1].source.join("")).toContain("x = 1");
  });

  test("非 .ipynb 文件返回错误", async () => {
    const txtPath = path.join(tmpDir, "test.txt");
    fs.writeFileSync(txtPath, "hello");
    const result = (await notebookEditTool.execute({
      action: "add",
      path: txtPath,
      source: "code",
    })) as any;
    expect(result.success).toBe(false);
    expect(result.error).toContain(".ipynb");
  });

  test("不存在的文件返回错误", async () => {
    const result = (await notebookEditTool.execute({
      action: "add",
      path: path.join(tmpDir, "missing.ipynb"),
      source: "code",
    })) as any;
    expect(result.success).toBe(false);
    expect(result.error).toContain("文件不存在");
  });

  test("delete 返回 removedType", async () => {
    const result = (await notebookEditTool.execute({
      action: "delete",
      cellIndex: 0,
      path: nbPath,
    })) as any;

    expect(result.success).toBe(true);
    expect(result.removedType).toBe("code");
  });

  test("replace 缺少 source 返回错误", async () => {
    const result = (await notebookEditTool.execute({
      action: "replace",
      cellIndex: 0,
      path: nbPath,
    })) as any;

    expect(result.success).toBe(false);
    expect(result.error).toContain("source");
  });
});

// ── LSP ─────────────────────────────────────────────────────────

describe("lsp", () => {
  const tmpDir = createGlobalTmpTestDir("crab-test-lsp-");

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    cleanupTestDir(tmpDir);
  });

  test("工具结构完整", () => {
    expect(lspTool.name).toBe("lsp");
    expect(lspTool.permission).toBe("fs.read");
    expect(typeof lspTool.execute).toBe("function");
  });

  test("参数 Schema 验证", () => {
    const schema = lspTool.parameters;
    expect(schema.safeParse({ action: "definition", column: 1, file: "/tmp/test.ts", line: 1 }).success).toBe(true);
    expect(schema.safeParse({ action: "symbols", file: "/tmp/test.ts" }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
  });

  test("不存在的文件返回错误", async () => {
    const result = (await lspTool.execute({
      action: "definition",
      file: "/nonexistent_12345.ts",
      symbol: "test",
    })) as any;
    expect(result.success).toBe(false);
  });

  test("文档符号提取", async () => {
    const tmpFile = path.join(tmpDir, "symbols.ts");
    fs.writeFileSync(tmpFile, "export function hello() {}\nexport const x = 1;\nclass MyClass {}\n");

    const result = (await lspTool.execute({
      action: "symbols",
      file: tmpFile,
    })) as any;

    expect(result.success).toBe(true);
    expect(result.total).toBeGreaterThanOrEqual(2);
    expect(result.symbols.some((s: any) => s.name === "hello")).toBe(true);
    expect(result.symbols.some((s: any) => s.name === "MyClass")).toBe(true);
    expect(result.symbols.some((s: any) => s.name === "x")).toBe(true);
  });

  test("符号提取 - interface 和 type", async () => {
    const tmpFile = path.join(tmpDir, "types.ts");
    fs.writeFileSync(tmpFile, "interface MyInterface { name: string; }\ntype Alias = string | number;\n");

    const result = (await lspTool.execute({
      action: "symbols",
      file: tmpFile,
    })) as any;

    expect(result.success).toBe(true);
    const names = result.symbols.map((s: any) => s.name);
    expect(names).toContain("MyInterface");
    expect(names).toContain("Alias");
  });

  test("符号提取 - enum", async () => {
    const tmpFile = path.join(tmpDir, "enums.ts");
    fs.writeFileSync(tmpFile, "enum Color { Red, Green, Blue }\nexport enum Status { Active, Inactive }\n");

    const result = (await lspTool.execute({
      action: "symbols",
      file: tmpFile,
    })) as any;

    expect(result.success).toBe(true);
    const names = result.symbols.map((s: any) => s.name);
    expect(names).toContain("Color");
    expect(names).toContain("Status");
  });

  test("definition - 通过 symbol 搜索", async () => {
    const tmpFile = path.join(tmpDir, "def.ts");
    fs.writeFileSync(tmpFile, "function myFunc() { return 42; }\n");

    const result = (await lspTool.execute({
      action: "definition",
      file: tmpFile,
      symbol: "myFunc",
    })) as any;

    expect(result.success).toBe(true);
    expect(result.action).toBe("definition");
    expect(result.symbol).toBe("myFunc");
    expect(result.results.length).toBeGreaterThanOrEqual(1);
  });

  test("definition - 优先走 LSP 结果", async () => {
    const tmpFile = path.join(tmpDir, "def-lsp.ts");
    fs.writeFileSync(tmpFile, "const value = 1;\n");
    spyOn(lspManager, "gotoDefinition").mockResolvedValue([
      {
        range: { start: { character: 4, line: 2 } },
        uri: `file://${tmpFile}`,
      },
    ]);

    const result = (await lspTool.execute({
      action: "definition",
      column: 1,
      file: tmpFile,
      line: 1,
    })) as any;

    expect(result.success).toBe(true);
    expect(result.engine).toBe("lsp");
    expect(result.results[0].line).toBe(3);
  });

  test("definition - 未提供 symbol 或 line/column 返回错误", async () => {
    const tmpFile = path.join(tmpDir, "nodef.ts");
    fs.writeFileSync(tmpFile, "const x = 1;\n");

    const result = (await lspTool.execute({
      action: "definition",
      file: tmpFile,
    })) as any;

    expect(result.success).toBe(false);
    expect(result.error).toContain("symbol");
  });

  test("references - 通过 symbol 搜索引用", async () => {
    const tmpFile = path.join(tmpDir, "refs.ts");
    fs.writeFileSync(tmpFile, "const myVar = 1;\nconsole.log(myVar);\n");

    const result = (await lspTool.execute({
      action: "references",
      file: tmpFile,
      symbol: "myVar",
    })) as any;

    expect(result.success).toBe(true);
    expect(result.action).toBe("references");
    expect(result.symbol).toBe("myVar");
    expect(result.results.length).toBeGreaterThanOrEqual(1);
  });

  test("references - 优先走 LSP 结果", async () => {
    const tmpFile = path.join(tmpDir, "refs-lsp.ts");
    fs.writeFileSync(tmpFile, "const value = 1;\n");
    spyOn(lspManager, "findReferences").mockResolvedValue([
      {
        range: { start: { character: 6, line: 0 } },
        uri: `file://${tmpFile}`,
      },
    ]);

    const result = (await lspTool.execute({
      action: "references",
      column: 1,
      file: tmpFile,
      line: 1,
    })) as any;

    expect(result.success).toBe(true);
    expect(result.engine).toBe("lsp");
    expect(result.results[0].column).toBe(7);
  });

  test("references - 未提供 symbol 返回错误", async () => {
    const tmpFile = path.join(tmpDir, "norefs.ts");
    fs.writeFileSync(tmpFile, "const x = 1;\n");

    const result = (await lspTool.execute({
      action: "references",
      file: tmpFile,
    })) as any;

    expect(result.success).toBe(false);
  });

  test("hover - 读取行内容", async () => {
    const tmpFile = path.join(tmpDir, "hover.ts");
    fs.writeFileSync(tmpFile, "const greeting = 'hello';\nconst x = 42;\n");

    const result = (await lspTool.execute({
      action: "hover",
      file: tmpFile,
      line: 1,
    })) as any;

    expect(result.success).toBe(true);
    expect(result.action).toBe("hover");
    expect(result.text).toContain("greeting");
    expect(result.line).toBe(1);
  });

  test("hover - 缺少 line 参数返回错误", async () => {
    const tmpFile = path.join(tmpDir, "nohover.ts");
    fs.writeFileSync(tmpFile, "const x = 1;\n");

    const result = (await lspTool.execute({
      action: "hover",
      file: tmpFile,
    })) as any;

    expect(result.success).toBe(false);
    expect(result.error).toContain("line");
  });

  test("diagnostics - 基本调用", async () => {
    const tmpFile = path.join(tmpDir, "diag.ts");
    fs.writeFileSync(tmpFile, "const x: string = 1;\n");

    const result = (await lspTool.execute({
      action: "diagnostics",
      file: tmpFile,
    })) as any;

    expect(result.success).toBe(true);
    expect(result.action).toBe("diagnostics");
  });

  test("diagnostics - 使用 LSP 缓存诊断", async () => {
    const tmpFile = path.join(tmpDir, "diag-lsp.ts");
    fs.writeFileSync(tmpFile, "const broken: string = 1;\n");
    spyOn(lspManager, "getDiagnostics").mockReturnValue([
      {
        location: { range: { start: { line: 0 } } },
        message: "Type mismatch",
        severity: 1,
        source: "tsserver",
      },
    ]);

    const result = (await lspTool.execute({
      action: "diagnostics",
      file: tmpFile,
    })) as any;

    expect(result.success).toBe(true);
    expect(result.engine).toBe("lsp");
    expect(result.total).toBe(1);
    expect(result.diagnostics[0].message).toContain("Type mismatch");
  });

  test("symbols - 非 TS/JS 文件", async () => {
    const tmpFile = path.join(tmpDir, "data.json");
    fs.writeFileSync(tmpFile, '{"key": "value"}\n');

    const result = (await lspTool.execute({
      action: "symbols",
      file: tmpFile,
    })) as any;

    expect(result.success).toBe(true);
    expect(result.total).toBe(0);
    expect(result.symbols).toEqual([]);
  });

  test("symbols - 优先走 LSP 符号树并展开 children", async () => {
    const tmpFile = path.join(tmpDir, "symbols-lsp.ts");
    fs.writeFileSync(tmpFile, "class A {}\n");
    spyOn(lspManager, "documentSymbols").mockResolvedValue([
      {
        children: [
          {
            kind: "method",
            location: { range: { start: { character: 2, line: 1 } }, uri: `file://${tmpFile}` },
            name: "inner",
          },
        ],
        kind: "class",
        location: { range: { start: { character: 0, line: 0 } }, uri: `file://${tmpFile}` },
        name: "Outer",
      },
    ]);

    const result = (await lspTool.execute({
      action: "symbols",
      file: tmpFile,
    })) as any;

    expect(result.success).toBe(true);
    expect(result.engine).toBe("lsp");
    expect(result.symbols.map((s: any) => s.name)).toEqual(["Outer", "inner"]);
  });

  test("workspaceSymbols - LSP 命中、空结果、异常", async () => {
    const tmpFile = path.join(tmpDir, "workspace.ts");
    fs.writeFileSync(tmpFile, "export function ws() {}\n");
    spyOn(lspManager, "workspaceSymbols").mockResolvedValueOnce([
      {
        kind: "function",
        location: { range: { start: { character: 1, line: 2 } }, uri: `file://${tmpFile}` },
        name: "ws",
      },
    ]);

    const hit = (await lspTool.execute({
      action: "workspaceSymbols",
      file: tmpFile,
      symbol: "ws",
    })) as any;
    expect(hit.success).toBe(true);
    expect(hit.engine).toBe("lsp");
    expect(hit.total).toBe(1);

    const empty = (await lspTool.execute({
      action: "workspaceSymbols",
      file: tmpFile,
      symbol: "missing",
    })) as any;
    expect(empty.success).toBe(true);
    expect(empty.engine).toBe("lsp-empty");

    (lspManager.workspaceSymbols as any).mockRejectedValueOnce(new Error("ws exploded"));
    const failed = (await lspTool.execute({
      action: "workspaceSymbols",
      file: tmpFile,
      symbol: "broken",
    })) as any;
    expect(failed.success).toBe(false);
    expect(String(failed.error)).toContain("ws exploded");
  });

  test("codeActions - LSP 命中、空结果、异常", async () => {
    const tmpFile = path.join(tmpDir, "actions.ts");
    fs.writeFileSync(tmpFile, "const x = 1;\n");
    spyOn(lspManager, "codeActions").mockResolvedValueOnce([
      { command: "fix.import", kind: "quickfix", title: "Fix import" },
    ]);

    const hit = (await lspTool.execute({
      action: "codeActions",
      column: 1,
      file: tmpFile,
      line: 1,
    })) as any;
    expect(hit.success).toBe(true);
    expect(hit.engine).toBe("lsp");
    expect(hit.total).toBe(1);
    expect(hit.results[0].title).toBe("Fix import");

    const empty = (await lspTool.execute({
      action: "codeActions",
      column: 1,
      file: tmpFile,
      line: 1,
    })) as any;
    expect(empty.success).toBe(true);
    expect(empty.engine).toBe("lsp-empty");

    (lspManager.codeActions as any).mockRejectedValueOnce(new Error("actions exploded"));
    const failed = (await lspTool.execute({
      action: "codeActions",
      column: 1,
      file: tmpFile,
      line: 1,
    })) as any;
    expect(failed.success).toBe(false);
    expect(String(failed.error)).toContain("actions exploded");
  });
});

// ── Plan Mode ───────────────────────────────────────────────────

describe("plan_mode", () => {
  test("工具结构完整", () => {
    expect(planModeTool.name).toBe("plan-mode");
    expect(typeof planModeTool.execute).toBe("function");
  });

  test("退出规划模式", async () => {
    const result = (await planModeTool.execute({
      action: "exit_plan_mode",
      plan: "重构认证模块",
      steps: ["1. 分析现有代码", "2. 提取接口", "3. 实现新方案"],
    })) as any;

    expect(result.success).toBe(true);
    expect(result.mode).toBe("execute");
    expect(result.plan).toContain("重构认证模块");
    expect(result.steps.length).toBe(3);
    expect(result.requireConfirmation).toBe(true);
  });

  test("进入规划模式", async () => {
    const result = (await planModeTool.execute({
      action: "enter_plan_mode",
    })) as any;

    expect(result.success).toBe(true);
    expect(result.mode).toBe("plan");
    expect(result.allowedTools).toContain("filesystem-read");
    expect(result.allowedTools).toContain("glob");
    expect(result.allowedTools).not.toContain("filesystem-write");
  });

  test("缺少 plan 参数返回错误", async () => {
    const result = (await planModeTool.execute({
      action: "exit_plan_mode",
    })) as any;

    expect(result.success).toBe(false);
  });

  test("查询状态", async () => {
    const result = (await planModeTool.execute({ action: "status" })) as any;
    expect(result.success).toBe(true);
    expect(result.mode).toBe("execute");
  });

  test("exit_plan_mode 只提供 steps 也可成功", async () => {
    const result = (await planModeTool.execute({
      action: "exit_plan_mode",
      steps: ["step 1", "step 2"],
    })) as any;

    expect(result.success).toBe(true);
    expect(result.mode).toBe("execute");
    expect(result.steps.length).toBe(2);
  });

  test("exit_plan_mode requireConfirmation=false", async () => {
    const result = (await planModeTool.execute({
      action: "exit_plan_mode",
      plan: "自动执行方案",
      requireConfirmation: false,
    })) as any;

    expect(result.success).toBe(true);
    expect(result.requireConfirmation).toBe(false);
    expect(result.message).toContain("自动");
  });

  test("规划模式的 allowedTools 包含只读工具", async () => {
    const result = (await planModeTool.execute({
      action: "enter_plan_mode",
    })) as any;

    expect(result.success).toBe(true);
    expect(result.allowedTools).toContain("lsp");
    expect(result.allowedTools).toContain("ide-diagnostics");
    expect(result.allowedTools).toContain("grep");
  });
});

// ── ToolSearch ──────────────────────────────────────────────────

describe("tool-search", () => {
  test("工具结构完整", () => {
    expect(toolSearchTool.name).toBe("tool-search");
    expect(typeof toolSearchTool.execute).toBe("function");
  });

  test("默认返回分组摘要", async () => {
    const result = (await toolSearchTool.execute({})) as any;
    expect(result.success).toBe(true);
    expect(result.action).toBe("summary");
    expect(result.totalTools).toBeGreaterThan(0);
    expect(result.groups.length).toBeGreaterThan(0);
  });

  test("搜索工具", async () => {
    const result = (await toolSearchTool.execute({ query: "edit" })) as any;
    expect(result.success).toBe(true);
    expect(result.action).toBe("search");
    expect(result.tools.length).toBeGreaterThan(0);
    const names = result.tools.map((t: any) => t.name);
    expect(names.some((n: string) => n.includes("edit"))).toBe(true);
  });

  test("列出所有工具", async () => {
    const result = (await toolSearchTool.execute({ listAll: true })) as any;
    expect(result.success).toBe(true);
    expect(result.total).toBeGreaterThan(20);
  });

  test("按分组筛选", async () => {
    const result = (await toolSearchTool.execute({ group: "filesystem" })) as any;
    expect(result.success).toBe(true);
    expect(result.tools.length).toBeGreaterThan(0);
    const names = result.tools.map((t: any) => t.name);
    expect(names).toContain("filesystem-read");
  });

  test("不存在的分组返回错误", async () => {
    const result = (await toolSearchTool.execute({ group: "nonexistent_group" })) as any;
    expect(result.success).toBe(false);
  });

  test("搜索 notebook 相关工具", async () => {
    const result = (await toolSearchTool.execute({ query: "notebook" })) as any;
    expect(result.success).toBe(true);
    const names = result.tools.map((t: any) => t.name);
    expect(names.some((n: string) => n.includes("notebook"))).toBe(true);
  });

  test("搜索 lsp 相关工具", async () => {
    const result = (await toolSearchTool.execute({ query: "lsp" })) as any;
    expect(result.success).toBe(true);
    const names = result.tools.map((t: any) => t.name);
    expect(names).toContain("lsp");
  });

  test("按 notebook-jupyter 分组筛选", async () => {
    const result = (await toolSearchTool.execute({ group: "notebook-jupyter" })) as any;
    expect(result.success).toBe(true);
    const names = result.tools.map((t: any) => t.name);
    expect(names).toContain("notebook-read");
    expect(names).toContain("notebook-edit");
  });

  test("按独立 builtin group 筛选 goal / agent-comms / codebase-search / ide-diagnostics", async () => {
    const goalResult = (await toolSearchTool.execute({ group: "goal" })) as any;
    expect(goalResult.success).toBe(true);
    expect(goalResult.tools.map((t: any) => t.name)).toEqual(["goal"]);

    const agentCommsResult = (await toolSearchTool.execute({ group: "agent-comms" })) as any;
    expect(agentCommsResult.success).toBe(true);
    expect(agentCommsResult.tools.map((t: any) => t.name)).toEqual([
      "agent-comms-send-message",
      "agent-comms-query-status",
    ]);

    const codebaseSearchResult = (await toolSearchTool.execute({ group: "codebase-search" })) as any;
    expect(codebaseSearchResult.success).toBe(true);
    expect(codebaseSearchResult.tools.map((t: any) => t.name)).toEqual(["codebase-search"]);

    const ideDiagnosticsResult = (await toolSearchTool.execute({ group: "ide-diagnostics" })) as any;
    expect(ideDiagnosticsResult.success).toBe(true);
    expect(ideDiagnosticsResult.tools.map((t: any) => t.name)).toEqual(["ide-diagnostics"]);
  });

  test("verbose 模式返回参数 schema", async () => {
    const result = (await toolSearchTool.execute({ query: "lsp", verbose: true })) as any;
    expect(result.success).toBe(true);
    const tool = result.tools[0];
    if (tool.parameters) {
      expect(typeof tool.parameters).toBe("object");
    }
  });
});

// ── 集成验证:注册表和 AI SDK Schema ────────────────────────────

describe("集成验证:工具注册表", () => {
  const getRegistry = async () => {
    const mod = await import("@/tool/registry/toolRegistry");
    return {
      getBuiltinGroupName: mod.getBuiltinGroupName,
      getBuiltinToolGroups: mod.getBuiltinToolGroups,
      getRegisteredTools: mod.getRegisteredTools,
      getToolsForAiSdk: mod.getToolsForAiSdk,
      isBuiltinTool: mod.isBuiltinTool,
    };
  };

  test("所有新工具已注册", async () => {
    const { getRegisteredTools } = await getRegistry();
    const tools = getRegisteredTools();
    expect(tools["filesystem-multi-edit"]).toBeDefined();
    expect(tools["notebook-read"]).toBeDefined();
    expect(tools["notebook-edit"]).toBeDefined();
    expect(tools["lsp"]).toBeDefined();
    expect(tools["plan-mode"]).toBeDefined();
    expect(tools["tool-search"]).toBeDefined();
  });

  test("所有新工具出现在 AI SDK Schema", async () => {
    const { getToolsForAiSdk } = await getRegistry();
    const schema = getToolsForAiSdk();
    expect(schema["filesystem-multi-edit"]).toBeDefined();
    expect(schema["filesystem-multi-edit"]?.description).toBeTruthy();
    expect(schema["filesystem-multi-edit"]?.inputSchema).toBeDefined();

    expect(schema["notebook-read"]).toBeDefined();
    expect(schema["notebook-edit"]).toBeDefined();
    expect(schema["lsp"]).toBeDefined();
    expect(schema["plan-mode"]).toBeDefined();
    expect(schema["tool-search"]).toBeDefined();
  });

  test("所有新工具属于正确的内置分组", async () => {
    const { isBuiltinTool, getBuiltinGroupName } = await getRegistry();
    expect(isBuiltinTool("filesystem-multi-edit")).toBe(true);
    expect(isBuiltinTool("notebook-read")).toBe(true);
    expect(isBuiltinTool("notebook-edit")).toBe(true);
    expect(isBuiltinTool("lsp")).toBe(true);
    expect(isBuiltinTool("plan-mode")).toBe(true);
    expect(isBuiltinTool("tool-search")).toBe(true);

    expect(getBuiltinGroupName("filesystem-multi-edit")).toBe("filesystem");
    expect(getBuiltinGroupName("notebook-read")).toBe("notebook-jupyter");
    expect(getBuiltinGroupName("notebook-edit")).toBe("notebook-jupyter");
    expect(getBuiltinGroupName("lsp")).toBe("lsp");
    expect(getBuiltinGroupName("tool-search")).toBe("tool-search");
    expect(getBuiltinGroupName("goal")).toBe("goal");
    expect(getBuiltinGroupName("codebase-search")).toBe("codebase-search");
    expect(getBuiltinGroupName("ide-diagnostics")).toBe("ide-diagnostics");
    expect(getBuiltinGroupName("agent-comms-send-message")).toBe("agent-comms");
    expect(getBuiltinGroupName("agent-comms-query-status")).toBe("agent-comms");
  });

  test("BUILTIN_GROUPS 包含新分组", async () => {
    const { getBuiltinToolGroups } = await getRegistry();
    const groups = getBuiltinToolGroups();
    const groupNames = groups.map((g: any) => g.name);

    expect(groupNames).toContain("notebook-jupyter");
    expect(groupNames).toContain("lsp");
    expect(groupNames).toContain("plan-mode");
    expect(groupNames).toContain("tool-search");
    expect(groupNames).toContain("filesystem");
    expect(groupNames).toContain("goal");
    expect(groupNames).toContain("agent-comms");
    expect(groupNames).toContain("ide-diagnostics");
    expect(groupNames).toContain("codebase-search");

    const multiEditGroup = groups.find((g: any) => g.tools.includes("filesystem-multi-edit"));
    expect(multiEditGroup).toBeDefined();
    expect(multiEditGroup!.tools).toContain("filesystem-multi-edit");

    const nbGroup = groups.find((g: any) => g.name === "notebook-jupyter");
    expect(nbGroup?.tools).toContain("notebook-read");
    expect(nbGroup?.tools).toContain("notebook-edit");

    const goalGroup = groups.find((g: any) => g.name === "goal");
    expect(goalGroup?.tools).toEqual(["goal"]);
  });
});

describe("集成验证:ToolExecutor 调度", () => {
  const createExecutor = () =>
    new ToolExecutor({
      getConfig: () => ({ permissions: [{ action: "allow", pattern: "*", permission: "*" }] }) as any,
    });

  test("ToolExecutor 能发现 multi-edit", async () => {
    const executor = createExecutor();
    const tool = executor.findTool("filesystem-multi-edit");
    expect(tool).toBeDefined();
    expect(tool!.name).toBe("filesystem-multi-edit");
    expect(tool!.permission).toBe("fs.edit");
  });

  test("ToolExecutor 能发现 lsp", async () => {
    const executor = createExecutor();
    const tool = executor.findTool("lsp");
    expect(tool).toBeDefined();
    expect(tool!.name).toBe("lsp");
  });

  test("ToolExecutor 能发现 notebook-read", async () => {
    const executor = createExecutor();
    const tool = executor.findTool("notebook-read");
    expect(tool).toBeDefined();
    expect(tool!.name).toBe("notebook-read");
  });

  test("ToolExecutor 能发现 plan_mode", async () => {
    const executor = createExecutor();
    const tool = executor.findTool("plan-mode");
    expect(tool).toBeDefined();
    expect(tool!.name).toBe("plan-mode");
  });

  test("ToolExecutor 能发现 tool-search", async () => {
    const executor = createExecutor();
    const tool = executor.findTool("tool-search");
    expect(tool).toBeDefined();
    expect(tool!.name).toBe("tool-search");
  });

  test("ToolExecutor listToolNames 包含所有新工具", () => {
    const executor = createExecutor();
    const names = executor.listToolNames();
    expect(names).toContain("filesystem-multi-edit");
    expect(names).toContain("notebook-read");
    expect(names).toContain("notebook-edit");
    expect(names).toContain("lsp");
    expect(names).toContain("plan-mode");
    expect(names).toContain("tool-search");
  });

  test("ToolExecutor 能执行 plan_mode status", async () => {
    const executor = createExecutor();
    const result = await executor.execute("plan-mode", { action: "status" });
    expect(result.success).toBe(true);
    expect((result.output as any).mode).toBe("execute");
  });

  test("ToolExecutor 参数验证失败返回错误", async () => {
    const executor = createExecutor();
    const result = await executor.execute("plan-mode", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("Parameter validation failed");
  });

  test("ToolExecutor 未注册工具返回 not found", async () => {
    const executor = createExecutor();
    const result = await executor.execute("nonexistent_tool_xyz", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("Tool not found");
  });

  test("ToolExecutor 能执行 tool-search summary", async () => {
    const executor = createExecutor();
    const result = await executor.execute("tool-search", {});
    expect(result.success).toBe(true);
    expect((result.output as any).action).toBe("summary");
  });

  test("ToolExecutor 能执行 lsp symbols(临时文件)", async () => {
    const tmpDir = createGlobalTmpTestDir("crab-test-exec-");
    const tmpFile = path.join(tmpDir, "sym.ts");
    fs.writeFileSync(tmpFile, "export function testFn() {}\n");

    const executor = createExecutor();
    const result = await executor.execute("lsp", {
      action: "symbols",
      file: tmpFile,
    });

    expect(result.success).toBe(true);
    expect((result.output as any).total).toBeGreaterThanOrEqual(1);

    cleanupTestDir(tmpDir);
  });
});
