/**
 * LSP Manager 测试 — 基础结构验证
 *
 * 注意: 由于 Bun 的 export * 模块重评估 bug，每个测试文件只能有一个测试
 * 能正确看到导入的模块。后续测试会看到被损坏的模块定义。
 * 因此本文件只保留一个综合性测试。
 */
import { describe, expect, test } from "bun:test";
import { lspManager } from "@/lsp/manager/manager";
import type { LspClient, LspDiagnostic, LspLocation } from "@/lsp/manager/manager";
import {
  builtinServers,
  findServerForLanguage,
  getServerDefinition,
  listBuiltinServers,
} from "@/lsp/registry/serverRegistry";
import { detectLanguage, getLspServerForFile, listSupportedLanguages } from "@/lsp/language";

describe("LSP Manager", () => {
  test("基础结构验证", () => {
    // lspManager
    expect(lspManager).toBeDefined();
    expect(typeof (lspManager as any).startForFile).toBe("function");
    expect(typeof (lspManager as any).getClients).toBe("function");
    expect(typeof (lspManager as any).getDiagnostics).toBe("function");
    expect(typeof (lspManager as any).getAllDiagnostics).toBe("function");
    expect(typeof (lspManager as any).stop).toBe("function");
    expect(typeof (lspManager as any).stopAll).toBe("function");

    // builtinServers
    expect(builtinServers).toBeDefined();
    expect(typeof builtinServers["typescript-language-server"]).toBe("object");

    // findServerForLanguage
    expect(typeof findServerForLanguage).toBe("function");

    // getServerDefinition
    expect(typeof getServerDefinition).toBe("function");

    // listBuiltinServers
    expect(typeof listBuiltinServers).toBe("function");

    // detectLanguage
    expect(typeof detectLanguage).toBe("function");

    // getLspServerForFile
    expect(typeof getLspServerForFile).toBe("function");

    // listSupportedLanguages
    expect(typeof listSupportedLanguages).toBe("function");

    // 类型导出验证
    const _typeCheck: LspClient | null = null;
    const _typeCheck2: LspDiagnostic | null = null;
    const _typeCheck3: LspLocation | null = null;
    expect(_typeCheck).toBeNull();
  });
});
