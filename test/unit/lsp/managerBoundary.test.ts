/**
 * LSP 管理器模块边界测试。
 *
 * 测试用例:
 *   - 公共 `@lsp` 入口重导出与直接导入模块引用一致
 */
import { describe, expect, test } from "bun:test";
import { LspManager as PublicLspManager, lspManager as publicLspManager } from "@/lsp";
import { LspManager as DirectLspManager, lspManager as directLspManager } from "@/lsp/manager";

describe("LSP 管理器模块边界", () => {
  test("公共 lsp 入口重导出与规范管理器模块一致", () => {
    expect(PublicLspManager).toBe(DirectLspManager);
    expect(publicLspManager).toBe(directLspManager);
  });
});
