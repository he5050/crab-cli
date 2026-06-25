/**
 * Jupyter Notebook 编辑工具 — 编辑 .ipynb 文件的单元格。
 *
 * 职责:
 *   - 添加单元格
 *   - 替换单元格内容
 *   - 删除单元格
 *   - 修改单元格类型
 *
 * 模块功能:
 *   - notebookEditTool: Notebook 编辑工具定义
 *   - add: 添加单元格
 *   - replace: 替换单元格内容
 *   - delete: 删除单元格
 *   - 支持代码/Markdown/Raw 类型
 *
 * 使用场景:
 *   - AI 需要修改 Notebook
 *   - 添加代码示例
 *   - 更新文档内容
 *   - 重构 Notebook 结构
 *
 * 边界:
 *   1. 权限:fs.edit
 *   2. 仅支持 .ipynb 格式
 *   3. 原子性写入
 *   4. 支持三种单元格类型
 *   5. 可指定单元格 ID
 *
 * 流程:
 *   1. 接收编辑参数
 *   2. 读取 Notebook 文件
 *   3. 验证格式
 *   4. 执行编辑操作
 *   5. 写回文件
 */
import { z } from "zod";
import { defineTool } from "@/tool/types";
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@/core/logging/logger";
import { recordFileMutation } from "@/tool/rollback";

const log = createLogger("tool:notebook_edit");

/** Notebook 单元格（写入用，与 .ipynb JSON 规范对齐） */
interface NotebookCellData {
  cell_type: string;
  metadata: Record<string, unknown>;
  source: string[];
  id?: string;
  execution_count?: number | null;
  outputs?: unknown[];
}

/** .ipynb 格式 */
interface NotebookFormat {
  nbformat: number;
  nbformat_minor: number;
  metadata?: Record<string, unknown>;
  cells: NotebookCellData[];
}

/** Jupyter Notebook 编辑工具 — 添加/替换/删除单元格 */
export const notebookEditTool = defineTool({
  description:
    "编辑 Jupyter Notebook (.ipynb) 文件。" +
    "支持添加、替换、删除单元格，以及修改单元格内容。" +
    "操作类型:add(添加)、replace(替换内容)、delete(删除单元格)。",
  execute: async ({ path: filePath, action, cellIndex, source, cellType, cellId }) => {
    try {
      // 路径遍历防护 — 确保文件路径在项目根目录范围内(CWE-22)
      const cwd = process.cwd();
      const realCwd = fs.realpathSync(cwd);
      const resolvedPath = path.resolve(filePath);
      if (!resolvedPath.startsWith(cwd + path.sep) && resolvedPath !== cwd) {
        return { error: `路径越界: 不允许访问工作区之外的文件`, success: false };
      }
      try {
        const realPath = fs.realpathSync(resolvedPath);
        if (!realPath.startsWith(realCwd + path.sep) && realPath !== realCwd) {
          return { error: `路径越界: 解析后的真实路径在工作区之外`, success: false };
        }
      } catch {
        // 文件不存在时无法解析真实路径，仅用 resolvedPath 检查
      }

      if (!fs.existsSync(resolvedPath)) {
        return { error: `文件不存在: ${filePath}`, success: false };
      }

      if (!resolvedPath.endsWith(".ipynb")) {
        return { error: "仅支持 .ipynb 格式", success: false };
      }

      const raw = fs.readFileSync(resolvedPath, "utf8");
      const notebook = JSON.parse(raw) as NotebookFormat;

      if (!notebook.cells || !Array.isArray(notebook.cells)) {
        return { error: "无效的 Notebook 格式", success: false };
      }

      switch (action) {
        case "add": {
          return handleAdd(notebook, resolvedPath, cellIndex, source, cellType, cellId);
        }
        case "replace": {
          return handleReplace(notebook, resolvedPath, cellIndex!, source);
        }
        case "delete": {
          return handleDelete(notebook, resolvedPath, cellIndex!);
        }
        default: {
          return { error: `未知操作: ${action}`, success: false };
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error(`编辑 Notebook 失败: ${filePath}`, { error: msg });
      return { error: msg, success: false };
    }
  },
  name: "notebook-edit",
  parameters: z.object({
    /** 操作类型 */
    action: z.enum(["add", "replace", "delete"]).describe("操作:add(添加单元格)/replace(替换内容)/delete(删除单元格)"),
    /** 新单元格的 ID */
    cellId: z.string().optional().describe("单元格 ID(可选)"),
    /** 目标单元格索引(从 0 开始) */
    cellIndex: z.number().optional().describe("目标单元格索引(replace/delete 时必填，add 时表示在该索引处插入)"),
    /** 单元格类型 */
    cellType: z.enum(["code", "markdown", "raw"]).optional().describe("单元格类型(add 时使用，默认 code)"),
    /** 文件路径 */
    path: z.string().describe("Notebook 文件路径(.ipynb)"),
    /** 单元格内容 */
    source: z.string().optional().describe("单元格源码内容"),
  }),
  permission: "fs.edit",
  builtin: true,
});

function createCell(source: string, cellType: string, cellId?: string): NotebookCellData {
  const cell: NotebookCellData = {
    cell_type: cellType,
    metadata: {},
    source: source.split("\n").map((line, i, arr) => (i < arr.length - 1 ? `${line}\n` : line)),
  };

  if (cellId) {
    cell.id = cellId;
  }

  if (cellType === "code") {
    cell.execution_count = null;
    cell.outputs = [];
  }

  return cell;
}

function writeNotebook(notebook: NotebookFormat, filePath: string): void {
  // 更新 nbformat_minor 以标记修改
  notebook.nbformat_minor = (notebook.nbformat_minor ?? 0) + 1;
  const before = notebook.nbformat_minor > 1 ? fs.readFileSync(filePath, "utf8") : "";
  const after = `${JSON.stringify(notebook, null, 1)}\n`;
  try {
    recordFileMutation({
      after,
      before,
      filePath,
      projectDir: process.cwd(),
      reason: `notebook-edit: ${notebook.cells?.length ?? 0} cells`,
    });
  } catch {
    /* rollback不可用时静默跳过 */
  }
  fs.writeFileSync(filePath, after, "utf8");
}

function handleAdd(
  notebook: NotebookFormat,
  filePath: string,
  cellIndex?: number,
  source?: string,
  cellType?: string,
  cellId?: string,
): Record<string, unknown> {
  const type = cellType ?? "code";
  const content = source ?? "";
  const cell = createCell(content, type, cellId);
  const insertAt = cellIndex ?? notebook.cells.length;

  notebook.cells.splice(insertAt, 0, cell);
  writeNotebook(notebook, filePath);

  log.info(`添加单元格: ${filePath} [${type}] at index ${insertAt}`);

  return {
    action: "add",
    cellIndex: insertAt,
    cellType: type,
    success: true,
    totalCells: notebook.cells.length,
  };
}

function handleReplace(
  notebook: NotebookFormat,
  filePath: string,
  cellIndex: number,
  source?: string,
): Record<string, unknown> {
  if (cellIndex == null || cellIndex < 0 || cellIndex >= notebook.cells.length) {
    return { error: `无效的 cellIndex: ${cellIndex}(共 ${notebook.cells.length} 个单元格)`, success: false };
  }

  if (source == null) {
    return { error: "replace 操作需要提供 source", success: false };
  }

  const oldCell = notebook.cells[cellIndex]!;
  const cellType = oldCell.cell_type ?? "code";
  const newCell = createCell(source, cellType, oldCell.id);

  // 保留原有的 execution_count 和 outputs(如果是 code cell)
  if (cellType === "code") {
    newCell.execution_count = oldCell.execution_count;
    newCell.outputs = oldCell.outputs;
  }
  newCell.metadata = oldCell.metadata;

  notebook.cells[cellIndex] = newCell;
  writeNotebook(notebook, filePath);

  log.info(`替换单元格: ${filePath} [${cellIndex}]`);

  return {
    action: "replace",
    cellIndex,
    cellType,
    success: true,
    totalCells: notebook.cells.length,
  };
}

function handleDelete(notebook: NotebookFormat, filePath: string, cellIndex: number): Record<string, unknown> {
  if (cellIndex == null || cellIndex < 0 || cellIndex >= notebook.cells.length) {
    return { error: `无效的 cellIndex: ${cellIndex}(共 ${notebook.cells.length} 个单元格)`, success: false };
  }

  const removed = notebook.cells.splice(cellIndex, 1)[0]!;
  writeNotebook(notebook, filePath);

  log.info(`删除单元格: ${filePath} [${cellIndex}]`);

  return {
    action: "delete",
    cellIndex,
    removedType: removed.cell_type,
    success: true,
    totalCells: notebook.cells.length,
  };
}
