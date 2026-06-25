/**
 * LSP 工具 — 通过 Language Server Protocol 提供代码智能。
 *
 * 职责:
 *   - 跳转到定义
 *   - 查找所有引用
 *   - 获取悬浮类型信息
 *   - 获取实时诊断
 *   - 获取文档符号
 *
 * 模块功能:
 *   - lspTool: LSP 工具定义
 *   - definition: 跳转到定义
 *   - references: 查找引用
 *   - hover: 悬浮类型信息
 *   - diagnostics: 实时诊断
 *   - symbols: 文档符号
 *   - workspaceSymbols: 工作区符号搜索
 *   - codeActions: 代码操作/快速修复
 *
 * 使用场景:
 *   - AI 需要了解代码定义位置
 *   - 查找函数/变量引用
 *   - 获取类型信息
 *   - 代码导航
 *
 * 边界:
 *   1. 权限:fs.read
 *   2. 三层回退策略:
 *      - 优先使用 lspManager(真实 LSP Server)
 *      - 回退到 tsc 命令行(TypeScript)
 *      - 最终回退到正则符号搜索
 *   3. 支持多种编程语言
 *   4. 需要 LSP 服务器支持
 *
 * 流程:
 *   1. 接收 LSP 操作参数
 *   2. 尝试使用 lspManager
 *   3. 失败时回退到 tsc
 *   4. 最终回退到正则搜索
 *   5. 返回搜索结果
 */
import { z } from "zod";
import { defineTool } from "@/tool/types";
import { createLogger } from "@/core/logging/logger";
import fs from "node:fs";
import path from "node:path";
import {
  findDefinition,
  findReferences,
  getCodeActions,
  getDiagnostics,
  getDocumentSymbols,
  getHoverInfo,
  getWorkspaceSymbols,
} from "./lspHandlers";

const log = createLogger("tool:lsp");

/** LSP 工具的实验性标签 */
export const LSP_STUB_LABEL = "Experimental stub / preview";
/** LSP 工具列表定义 */
export const LSP_TOOLS = [{ label: `lsp (${LSP_STUB_LABEL})`, name: "lsp" }] as const;

/** 获取 LSP 工具的显示标签 */
export function getLspToolLabel(name: string): string {
  return LSP_TOOLS.find((tool) => tool.name === name)?.label ?? `${name} (${LSP_STUB_LABEL})`;
}

/** LSP 语言服务协议工具 — 跳转定义/引用/诊断/符号 */
export const lspTool = defineTool({
  description:
    "[Experimental stub / preview] 通过 LSP(Language Server Protocol)提供代码智能功能。" +
    "支持:跳转定义(definition)、查找引用(references)、悬浮信息(hover)、诊断(diagnostics)、文档符号(symbols)。" +
    "优先使用真实 LSP 服务器，自动回退到正则搜索。",
  execute: async ({ action, file, line, column, symbol, cwd }) => {
    const projectRoot = cwd ?? process.cwd();
    const filePath = path.resolve(projectRoot, file);

    if (!fs.existsSync(filePath)) {
      return { error: `文件不存在: ${filePath}`, success: false };
    }

    try {
      switch (action) {
        case "definition": {
          return await findDefinition(filePath, line, column, symbol, projectRoot);
        }
        case "references": {
          return await findReferences(filePath, line, column, symbol, projectRoot);
        }
        case "hover": {
          return await getHoverInfo(filePath, line, column);
        }
        case "diagnostics": {
          return await getDiagnostics(filePath);
        }
        case "symbols": {
          return await getDocumentSymbols(filePath, projectRoot);
        }
        case "workspaceSymbols": {
          return await getWorkspaceSymbols(symbol ?? "");
        }
        case "codeActions": {
          return await getCodeActions(filePath, line ?? 1, column ?? 1);
        }
        default: {
          return { error: `未知操作: ${action}`, success: false };
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error(`LSP 操作失败: ${action}`, { error: msg });
      return { action, error: msg, file: filePath, success: false };
    }
  },
  name: "lsp",
  parameters: z.object({
    action: z
      .enum(["definition", "references", "hover", "diagnostics", "symbols", "workspaceSymbols", "codeActions"])
      .describe(
        "操作:definition(跳转定义)/references(查找引用)/hover(悬浮类型信息)/diagnostics(诊断)/symbols(文档符号)/workspaceSymbols(工作区符号搜索)/codeActions(代码操作/快速修复)",
      ),
    column: z.number().optional().describe("列号(从 1 开始)"),
    cwd: z.string().optional().describe("项目根目录"),
    file: z.string().describe("源文件路径"),
    line: z.number().optional().describe("行号(从 1 开始)"),
    symbol: z.string().optional().describe("符号名称"),
  }),
  permission: "fs.read",
  builtin: true,
});
