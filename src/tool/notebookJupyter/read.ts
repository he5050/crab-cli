/**
 * Jupyter Notebook 读取工具 — 读取 .ipynb 文件内容。
 *
 * 职责:
 *   - 读取 Jupyter Notebook 文件
 *   - 解析单元格内容
 *   - 支持代码/Markdown/Raw 单元格
 *   - 返回执行输出
 *
 * 模块功能:
 *   - notebookReadTool: Notebook 读取工具定义
 *   - 解析 .ipynb 格式
 *   - 读取单元格源码
 *   - 读取单元格输出
 *   - 支持指定单元格范围
 *
 * 使用场景:
 *   - AI 需要读取 Notebook 文件
 *   - 查看代码单元格内容
 *   - 查看 Markdown 文档
 *   - 获取执行结果
 *
 * 边界:
 *   1. 权限:fs.read
 *   2. 仅支持 .ipynb 格式
 *   3. 支持指定单元格范围
 *   4. 返回单元格类型和源码
 *   5. 返回执行输出(如有)
 *
 * 流程:
 *   1. 接收文件路径
 *   2. 读取 .ipynb 文件
 *   3. 解析 JSON 格式
 *   4. 提取单元格信息
 *   5. 返回单元格列表
 */
import { z } from "zod";
import { defineTool } from "@/tool/types";
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("tool:notebook_read");

/** Notebook 单元格 */
interface NotebookCell {
  index: number;
  type: "code" | "markdown" | "raw";
  source: string;
  outputs?: {
    type: string;
    text?: string;
    data?: Record<string, string>;
  }[];
  executionCount?: number | null;
}

/** Notebook 单元格输出（JSON 规范，类型多样） */
interface NotebookCellOutput {
  data?: Record<string, string>;
  text?: string | string[];
  output_type?: string;
}

/** .ipynb 格式（与 JSON.parse 原始结构对齐） */
interface NotebookFormat {
  nbformat: number;
  nbformat_minor: number;
  metadata?: Record<string, unknown>;
  cells: {
    cell_type: string;
    source: string | string[];
    outputs?: NotebookCellOutput[];
    execution_count?: number | null;
    metadata?: Record<string, unknown>;
  }[];
}

/** Jupyter Notebook 读取工具 — 返回单元格源码和执行输出 */
export const notebookReadTool = defineTool({
  description:
    "读取 Jupyter Notebook (.ipynb) 文件内容。" +
    "返回所有单元格的源码、类型(code/markdown/raw)和执行输出。" +
    "支持指定读取特定单元格范围。",
  execute: async ({ path: filePath, fromCell, toCell }) => {
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
        return { error: "仅支持 .ipynb 格式的 Jupyter Notebook 文件", success: false };
      }

      const raw = fs.readFileSync(resolvedPath, "utf8");
      const notebook = JSON.parse(raw) as NotebookFormat;

      if (!notebook.cells || !Array.isArray(notebook.cells)) {
        return { error: "无效的 Notebook 格式:缺少 cells 数组", success: false };
      }

      const start = fromCell ?? 0;
      const end = toCell ?? notebook.cells.length;
      const cells = notebook.cells.slice(start, end);

      const parsedCells: NotebookCell[] = cells.map((cell, i) => {
        const source =
          typeof cell.source === "string" ? cell.source : Array.isArray(cell.source) ? cell.source.join("") : "";

        const outputs = (cell.outputs ?? []).map((out: NotebookCellOutput | undefined) => ({
          data: out?.data,
          text: typeof out?.text === "string" ? out.text : Array.isArray(out?.text) ? out.text.join("") : undefined,
          type: out?.output_type ?? "unknown",
        }));

        return {
          index: start + i,
          type: (cell.cell_type as "code" | "markdown" | "raw") ?? "raw",
          source,
          ...(outputs.length > 0 && { outputs }),
          executionCount: cell.execution_count ?? null,
        };
      });

      // 格式化为可读文本
      const lines: string[] = [];
      for (const cell of parsedCells) {
        const header =
          cell.type === "code"
            ? `## Cell ${cell.index} [code]${cell.executionCount != null ? ` (exec: ${cell.executionCount})` : ""}`
            : `## Cell ${cell.index} [${cell.type}]`;
        lines.push(header);
        lines.push(cell.source);

        if (cell.outputs && cell.outputs.length > 0) {
          lines.push("### Output:");
          for (const out of cell.outputs) {
            if (out.text) {
              lines.push(out.text);
            }
            if (out.data?.["text/plain"]) {
              lines.push(out.data["text/plain"]);
            }
            if (out.data?.["image/png"]) {
              lines.push("[图片输出]");
            }
          }
        }
        lines.push("");
      }

      log.info(`读取 Notebook: ${filePath} (${parsedCells.length}/${notebook.cells.length} cells)`);

      const metadata = {
        nbformat: notebook.nbformat,
        nbformat_minor: notebook.nbformat_minor,
      } as Record<string, unknown>;
      const languageInfo = notebook.metadata?.language_info;
      if (languageInfo && typeof languageInfo === "object" && "name" in languageInfo) {
        metadata.language = (languageInfo as { name?: string }).name;
      }

      return {
        cells: parsedCells,
        content: lines.join("\n"),
        displayedCells: parsedCells.length,
        metadata,
        path: filePath,
        success: true,
        totalCells: notebook.cells.length,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error(`读取 Notebook 失败: ${filePath}`, { error: msg });
      return { error: msg, success: false };
    }
  },
  name: "notebook-read",
  parameters: z.object({
    /** 起始单元格索引(从 0 开始) */
    fromCell: z.number().optional().describe("起始单元格索引(从 0 开始)，默认 0"),
    /** 文件路径 */
    path: z.string().describe("Notebook 文件路径(.ipynb)"),
    /** 结束单元格索引(不包含) */
    toCell: z.number().optional().describe("结束单元格索引(不包含)，默认到末尾"),
  }),
  permission: "fs.read",
  builtin: true,
});
