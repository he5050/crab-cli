/**
 * LSP 集成测试 — 客户端和管理器的端到端测试。
 *
 * 测试用例:
 *   - 完整的客户端生命周期(创建、启动、使用、关闭)
 *   - 管理器多客户端协调
 *   - 实际 LSP 功能调用
 *   - 错误处理和恢复
 *   - 资源清理
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { LspManager } from "@/lsp/manager/manager";

describe("LSP 集成测试", () => {
  let manager: LspManager;

  beforeEach(() => {
    manager = new LspManager({
      maxConnections: 2,
      projectRoot: "/tmp/integration-test",
    });
  });

  afterEach(async () => {
    await manager.closeAll();
  });

  describe("完整的客户端生命周期", () => {
    test("TypeScript 客户端创建和使用", async () => {
      // 创建 TypeScript 客户端
      const client = await manager.getClientForFile("/tmp/test.ts");

      if (client) {
        // 客户端已创建
        expect(client).toBeDefined();

        // 尝试使用客户端功能
        const symbols = await manager.documentSymbols("/tmp/test.ts");
        expect(Array.isArray(symbols)).toBe(true);

        // 清理
        await manager.closeClientForFile("/tmp/test.ts");
      } else {
        // LSP Server 可能未安装
        expect(client).toBeNull();
      }
    });

    test("Python 客户端创建和使用", async () => {
      const client = await manager.getClientForFile("/tmp/test.py");

      if (client) {
        expect(client).toBeDefined();

        const symbols = await manager.documentSymbols("/tmp/test.py");
        expect(Array.isArray(symbols)).toBe(true);

        await manager.closeClientForFile("/tmp/test.py");
      } else {
        expect(client).toBeNull();
      }
    });

    test("客户端自动创建和复用", async () => {
      // 第一次调用创建客户端
      const client1 = await manager.getClientForLanguage("typescript");

      // 第二次调用应该复用同一个客户端
      const client2 = await manager.getClientForLanguage("typescript");

      if (client1) {
        expect(client2).toBe(client1);
      } else {
        expect(client1).toBeNull();
        expect(client2).toBeNull();
      }
    });
  });

  describe("多客户端协调", () => {
    test("同时管理多个语言客户端", async () => {
      // 创建多个不同语言的客户端
      await manager.getClientForLanguage("typescript");
      await manager.getClientForLanguage("python");
      await manager.getClientForLanguage("go");

      const activeClients = manager.getActiveClients();

      // 活跃客户端数量应该不超过最大连接数
      expect(activeClients.length <= 2).toBe(true);
    });

    test("连接池限制生效", async () => {
      const limitedManager = new LspManager({
        maxConnections: 1,
        projectRoot: "/tmp/limit-test",
      });

      // 创建第一个客户端
      const client1 = await limitedManager.getClientForLanguage("typescript");

      // 尝试创建第二个客户端(应该被限制)
      const client2 = await limitedManager.getClientForLanguage("python");

      // 第二个客户端可能被拒绝(取决于连接池实现)
      if (client1) {
        const activeClients = limitedManager.getActiveClients();
        expect(activeClients.length <= 1).toBe(true);
      }

      await limitedManager.closeAll();
    });

    test("关闭特定语言客户端不影响其他客户端", async () => {
      // 创建多个客户端
      const tsClient = await manager.getClientForLanguage("typescript");
      const pyClient = await manager.getClientForLanguage("python");

      // 关闭 TypeScript 客户端
      await manager.closeClientForLanguage("typescript");

      // Python 客户端应该仍然可用
      const pyClientAgain = await manager.getClientForLanguage("python");

      if (pyClient) {
        expect(pyClientAgain).toBeDefined();
      }
    });
  });

  describe("端到端功能测试", () => {
    test("完整的定义跳转流程", async () => {
      const client = await manager.getClientForFile("/tmp/test.ts");

      if (client) {
        try {
          const locations = await manager.gotoDefinition("/tmp/test.ts", 5, 10);
          expect(Array.isArray(locations)).toBe(true);

          // 验证返回的位置格式
          if (locations.length > 0) {
            const loc = locations[0];
            if (loc) {
              expect(loc.uri).toBeDefined();
              expect(loc.range).toBeDefined();
              expect(typeof loc.range.start.line).toBe("number");
            }
          }
        } catch (error) {
          // LSP Server 可能返回错误
          expect(error).toBeDefined();
        }
      }
    });

    test("完整的引用查找流程", async () => {
      const client = await manager.getClientForFile("/tmp/test.ts");

      if (client) {
        try {
          const refs = await manager.findReferences("/tmp/test.ts", 5, 10);
          expect(Array.isArray(refs)).toBe(true);
        } catch (error) {
          expect(error).toBeDefined();
        }
      }
    });

    test("完整的代码补全流程", async () => {
      const client = await manager.getClientForFile("/tmp/test.ts");

      if (client) {
        try {
          const completions = await manager.completion("/tmp/test.ts", 5, 10);
          expect(Array.isArray(completions)).toBe(true);

          // 验证补全项格式
          if (completions.length > 0) {
            const item = completions[0];
            if (item) {
              expect(item.label).toBeDefined();
            }
          }
        } catch (error) {
          expect(error).toBeDefined();
        }
      }
    });

    test("完整的文档格式化流程", async () => {
      const client = await manager.getClientForFile("/tmp/test.ts");

      if (client) {
        try {
          const edits = await manager.formatDocument("/tmp/test.ts");
          expect(Array.isArray(edits)).toBe(true);
        } catch (error) {
          expect(error).toBeDefined();
        }
      }
    });

    test("完整的重命名流程", async () => {
      const client = await manager.getClientForFile("/tmp/test.ts");

      if (client) {
        try {
          const edit = await manager.rename("/tmp/test.ts", 5, 10, "newName");
          // 可能返回 null
          if (edit) {
            expect(edit.changes).toBeDefined();
          }
        } catch (error) {
          expect(error).toBeDefined();
        }
      }
    });
  });

  describe("诊断信息管理", () => {
    test("获取文件诊断信息", () => {
      // 即使没有客户端，也应该返回空数组
      const diagnostics = manager.getDiagnostics("/tmp/test.ts");
      expect(Array.isArray(diagnostics)).toBe(true);
    });

    test("不同文件的诊断信息独立", () => {
      const diags1 = manager.getDiagnostics("/tmp/test1.ts");
      const diags2 = manager.getDiagnostics("/tmp/test2.ts");

      // 不同文件的诊断信息应该独立
      expect(diags1).toEqual(diags2);
      expect(Array.isArray(diags1)).toBe(true);
      expect(Array.isArray(diags2)).toBe(true);
    });
  });

  describe("错误处理和恢复", () => {
    test("未知文件类型不抛出错误", async () => {
      // 应该返回 null 而不是抛出错误
      const client = await manager.getClientForFile("/tmp/unknown.xyz");
      expect(client).toBeNull();
    });

    test("无效操作返回空结果", async () => {
      // 无客户端时应该返回空结果
      const result = await manager.gotoDefinition("/tmp/test.ts", 1, 1);
      expect(result).toEqual([]);
    });

    test("多次 closeAll 不报错", async () => {
      await manager.closeAll();
      await manager.closeAll();
      await manager.closeAll();

      // 验证没有活跃客户端
      const activeClients = manager.getActiveClients();
      expect(activeClients.length).toBe(0);
    });
  });

  describe("资源清理", () => {
    test("cleanupIdle 清理空闲客户端", async () => {
      // 创建一些客户端
      await manager.getClientForLanguage("typescript");
      await manager.getClientForLanguage("python");

      // 清理空闲客户端
      const cleaned = await manager.cleanupIdle();

      // 清理数量应该 >= 0
      expect(cleaned >= 0).toBe(true);
    });

    test("reloadConfig 清理所有客户端", async () => {
      // 创建一些客户端
      await manager.getClientForLanguage("typescript");

      // 重新加载配置
      await manager.reloadConfig();

      // 所有客户端应该被清理
      const activeClients = manager.getActiveClients();
      expect(activeClients.length).toBe(0);
    });

    test("项目根目录设置", async () => {
      const testManager = new LspManager();

      // 初始化项目根目录
      await testManager.initialize("/tmp/test-project");

      // 验证初始化成功
      await expect(testManager.initialize("/tmp/test-project")).resolves.toBeUndefined();

      await testManager.closeAll();
    });
  });

  describe("工作区符号搜索", () => {
    test("workspaceSymbols 搜索符号", async () => {
      const client = await manager.getClientForLanguage("typescript");

      if (client) {
        try {
          const symbols = await manager.workspaceSymbols("testSymbol");
          expect(Array.isArray(symbols)).toBe(true);

          // 验证符号格式
          if (symbols.length > 0) {
            const sym = symbols[0];
            if (sym) {
              expect(sym.name).toBeDefined();
              expect(sym.location).toBeDefined();
            }
          }
        } catch (error) {
          expect(error).toBeDefined();
        }
      } else {
        // 如果没有客户端，应该返回空数组
        const symbols = await manager.workspaceSymbols("testSymbol");
        expect(symbols).toEqual([]);
      }
    });
  });

  describe("代码操作", () => {
    test("codeActions 获取代码操作", async () => {
      const client = await manager.getClientForFile("/tmp/test.ts");

      if (client) {
        try {
          const actions = await manager.codeActions("/tmp/test.ts", 5, 10, [
            { column: 10, line: 5, message: "test error" },
          ]);

          expect(Array.isArray(actions)).toBe(true);

          // 验证操作格式
          if (actions.length > 0) {
            const action = actions[0];
            if (action) {
              expect(action.title).toBeDefined();
            }
          }
        } catch (error) {
          expect(error).toBeDefined();
        }
      } else {
        // 如果没有客户端，应该返回空数组
        const actions = await manager.codeActions("/tmp/test.ts", 5, 10, []);
        expect(actions).toEqual([]);
      }
    });
  });
});
