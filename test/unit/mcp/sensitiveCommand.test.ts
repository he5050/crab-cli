/**
 * 敏感命令测试。
 *
 * 测试用例:
 *   - 敏感命令检测
 *   - 风险提示
 *   - 确认流程
 */
import { describe, expect, test } from "bun:test";
import { isSensitiveCall } from "@/tool/executor/toolExecutor";

describe("敏感命令检测", () => {
  describe("危险 Shell 命令", () => {
    test("rm -rf", () => {
      expect(isSensitiveCall("terminal", { command: "rm -rf /" })).toBe(true);
      expect(isSensitiveCall("terminal", { command: "rm -rf /home/user" })).toBe(true);
    });

    test("rm -r (无 f)", () => {
      expect(isSensitiveCall("bash", { command: "rm -r /tmp/test" })).toBe(true);
    });

    test("sudo rm", () => {
      expect(isSensitiveCall("shell", { command: "sudo rm /etc/hosts" })).toBe(true);
    });

    test("dd 如果=", () => {
      expect(isSensitiveCall("exec", { command: "dd if=/dev/zero of=/dev/sda" })).toBe(true);
    });

    test("mkfs", () => {
      expect(isSensitiveCall("terminal_run", { command: "mkfs.ext4 /dev/sda1" })).toBe(true);
    });

    test("chmod 777", () => {
      expect(isSensitiveCall("bash_exec", { command: "chmod 777 /etc/passwd" })).toBe(true);
    });

    test("重定向至 /开发/", () => {
      expect(isSensitiveCall("shell", { command: "echo data > /dev/sda" })).toBe(true);
    });
  });

  describe("危险 Git 命令", () => {
    test("git push --force", () => {
      expect(isSensitiveCall("terminal", { command: "git push --force origin main" })).toBe(true);
    });

    test("git reset --hard", () => {
      expect(isSensitiveCall("bash", { command: "git reset --hard HEAD~5" })).toBe(true);
    });
  });

  describe("危险 SQL 命令", () => {
    test("DROP TABLE", () => {
      expect(isSensitiveCall("database_exec", { command: "DROP TABLE users" })).toBe(true);
    });

    test("DROP DATABASE", () => {
      expect(isSensitiveCall("database_exec", { command: "DROP DATABASE production" })).toBe(true);
    });

    test("TRUNCATE TABLE", () => {
      expect(isSensitiveCall("sql_terminal", { command: "TRUNCATE TABLE logs" })).toBe(true);
    });

    test("DELETE FROM (case insensitive)", () => {
      expect(isSensitiveCall("sql_run", { command: "delete from users where 1=1" })).toBe(true);
    });
  });

  describe("安全命令", () => {
    test("ls", () => {
      expect(isSensitiveCall("terminal", { command: "ls -la" })).toBe(false);
    });

    test("cat", () => {
      expect(isSensitiveCall("terminal", { command: "cat /tmp/file.txt" })).toBe(false);
    });

    test("git status", () => {
      expect(isSensitiveCall("terminal", { command: "git status" })).toBe(false);
    });

    test("回显", () => {
      expect(isSensitiveCall("terminal", { command: "echo hello" })).toBe(false);
    });

    test("npm install", () => {
      expect(isSensitiveCall("terminal", { command: "npm install" })).toBe(false);
    });
  });

  describe("非终端工具", () => {
    test("read_file 工具忽略危险命令", () => {
      expect(isSensitiveCall("read_file", { command: "rm -rf /" })).toBe(false);
    });

    test("搜索工具忽略危险命令", () => {
      expect(isSensitiveCall("search", { command: "DROP TABLE users" })).toBe(false);
    });

    test("mcp.tool tool ignores dangerous commands", () => {
      expect(isSensitiveCall("mcp_myserver_tool", { command: "rm -rf /" })).toBe(false);
    });
  });

  describe("边界条件", () => {
    test("空命令是安全", () => {
      expect(isSensitiveCall("terminal", { command: "" })).toBe(false);
    });

    test("non-string command is safe", () => {
      expect(isSensitiveCall("terminal", { command: 123 })).toBe(false);
      expect(isSensitiveCall("terminal", { command: null })).toBe(false);
      expect(isSensitiveCall("terminal", { command: undefined })).toBe(false);
    });

    test("缺失命令字段是安全", () => {
      expect(isSensitiveCall("terminal", {})).toBe(false);
    });

    test("cmd alias 被检查", () => {
      expect(isSensitiveCall("terminal", { cmd: "rm -rf /" })).toBe(true);
    });

    test("脚本别名是已检查", () => {
      expect(isSensitiveCall("bash", { script: "rm -rf /" })).toBe(true);
    });
  });
});
