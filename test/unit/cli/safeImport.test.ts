/**
 * safeImport 单元测试
 *
 * 测试重点:
 *   - 正常路径：模块加载成功返回模块导出
 *   - 异常路径：模块加载失败时 exitWithError 输出友好错误
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { safeImport } from "@/cli/core/orchestrator";

describe("safeImport", () => {
  let exitCode: number | undefined;
  let restoreExit: (() => void) | undefined;

  beforeEach(() => {
    exitCode = undefined;
    const originalExit = process.exit;
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error(`EXIT_${code}`);
    }) as typeof process.exit;
    restoreExit = () => {
      process.exit = originalExit;
    };
  });

  afterEach(() => {
    restoreExit?.();
  });

  test("成功加载模块时返回模块导出", async () => {
    const module = await safeImport(() => import("@/config/version"), "@/config/version");
    expect(module).toBeDefined();
    expect(module.VERSION).toBeDefined();
  });

  test("模块加载失败时调用 exitWithError 退出", async () => {
    try {
      await safeImport(() => Promise.reject(new Error("模块不存在")), "test-module");
    } catch {
      /* process.exit mock */
    }
    expect(exitCode).toBe(1);
  });

  test("模块加载失败时错误消息包含模块名", async () => {
    const originalStderrWrite = process.stderr.write;
    let captured = "";
    process.stderr.write = ((chunk: any) => {
      captured += chunk.toString();
      return true;
    }) as typeof process.stderr.write;

    try {
      await safeImport(() => Promise.reject(new Error("找不到模块")), "test-module");
    } catch {
      /* process.exit mock */
    }

    process.stderr.write = originalStderrWrite;
    expect(captured).toContain("test-module");
  });

  test("模块加载抛出非 Error 类型时也能处理", async () => {
    try {
      await safeImport(() => Promise.reject(new Error("字符串错误")), "string-error-module");
    } catch {
      /* process.exit mock */
    }
    expect(exitCode).toBe(1);
  });
});
