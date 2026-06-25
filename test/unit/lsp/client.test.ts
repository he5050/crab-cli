/**
 * LSP Client 测试 — 基础结构验证
 *
 * 注意: 由于 Bun 的 mock.module 与 ES 模块静态绑定存在兼容性问题，
 * 需要真实进程启动的测试已移至集成测试。
 * 本文件只包含不需要 mock Bun.spawn 的基础测试。
 *
 * 重要: 必须直接从 @/lsp/core/client 导入 LSPClient，
 * 而不是从 @/lsp/client 导入，因为 Bun 会对 export * 重导出模式
 * 在测试间重新评估模块，导致类定义损坏。
 */
import { describe, expect, test } from "bun:test";
import { LSPClient } from "@/lsp/core/client";
import { builtinServers } from "@/lsp/registry/serverRegistry";
import type { LSPClientOptions } from "@/lsp/core/client";

describe("LSPClient", () => {
  const testServerDef = builtinServers["typescript-language-server"];
  const testOptions: LSPClientOptions = {
    args: testServerDef?.args ?? [],
    command: testServerDef?.command ?? "echo",
    rootPath: "/tmp/test",
  };

  describe("LSPClient 类结构", () => {
    test("LSPClient 类存在", () => {
      expect(LSPClient).toBeDefined();
    });

    test("创建客户端实例并验证方法存在", () => {
      if (!testServerDef) {
        throw new Error("typescript-language-server not found in builtinServers");
      }
      const c = new LSPClient(testServerDef, testOptions);
      expect(c).toBeInstanceOf(LSPClient);
      expect(typeof (c as any).start).toBe("function");
      expect(typeof (c as any).getState).toBe("function");
      expect(typeof (c as any).initialize).toBe("function");
      expect(typeof (c as any).shutdown).toBe("function");
      expect(typeof (c as any).exit).toBe("function");
      expect(typeof (c as any).definition).toBe("function");
      expect(typeof (c as any).references).toBe("function");
      expect(typeof (c as any).hover).toBe("function");
      expect(typeof (c as any).didOpen).toBe("function");
      expect(typeof (c as any).didChange).toBe("function");
      expect(typeof (c as any).didClose).toBe("function");
      expect(typeof (c as any).completion).toBe("function");
    });

    test("初始状态为 stopped", () => {
      if (!testServerDef) {
        return;
      }
      const c = new LSPClient(testServerDef, testOptions);
      expect((c as any).getState()).toBe("stopped");
    });
  });
});
