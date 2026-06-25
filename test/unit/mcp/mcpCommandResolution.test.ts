/**
 * MCP 命令解析测试。
 *
 * 测试用例:
 *   - 命令解析
 *   - 参数提取
 *   - 路径解析
 */
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { type CommandCheckResult, checkCommandExists, resolveStdioCommand } from "@/mcp/cmd/commandResolution";

const bunBin = path.join(os.homedir(), ".bun", "bin");
const bunxPath = path.join(bunBin, "bunx");
const hasBunx = fs.existsSync(bunxPath);

const localBin = path.join(os.homedir(), ".local", "bin");
const uvxPath = path.join(localBin, "uvx");
// Uvx 可能在 .local/bin 或 /usr/local/bin 等位置
const hasUvx = fs.existsSync(uvxPath) || fs.existsSync("/usr/local/bin/uvx");

// 检查 shell 是否可用
const shellPath = fs.existsSync("/bin/bash") ? "/bin/bash" : fs.existsSync("/bin/zsh") ? "/bin/zsh" : null;
const hasShell = shellPath !== null;

describe("resolveStdioCommand", () => {
  test("falls back from npx -y to bunx and strips yes flags", () => {
    const result = resolveStdioCommand({
      args: ["-y", "@modelcontextprotocol/server-sequential-thinking", "--help"],
      command: "npx",
      env: {
        PATH: "/usr/bin:/bin",
      },
    });

    // -y 标志应该被移除(无论走哪种执行路径)
    const allArgs = result.args.join(" ");
    expect(allArgs).not.toContain("-y");
    expect(allArgs).toContain("@modelcontextprotocol/server-sequential-thinking");
    expect(allArgs).toContain("--help");

    if (hasBunx) {
      expect(result.command).toBe(bunxPath);
      expect(result.env.PATH!.split(path.delimiter)).toContain(bunBin);
    }
  });

  test("preserves npx for drawio MCP", () => {
    const result = resolveStdioCommand({
      args: ["-y", "@drawio/mcp"],
      command: "npx",
      env: {
        PATH: "/usr/bin:/bin",
      },
    });

    expect(result.command).not.toBe(bunxPath);
    expect(result.args).toContain("-y");
    expect(result.args).toContain("@drawio/mcp");
  });

  test("resolves uvx to absolute path when available", () => {
    const result = resolveStdioCommand({
      args: ["mcp-server-fetch"],
      command: "uvx",
      env: {
        PATH: "/usr/bin:/bin",
      },
    });

    if (hasUvx) {
      expect(result.command).toBeTruthy();
      expect(fs.existsSync(result.command)).toBe(true);
      expect(result.checkResult?.method).toMatch(/^(candidate|path)$/);
    }
    expect(result.command).toBeTruthy();
  });

  test("解析节点命令", () => {
    const result = resolveStdioCommand({
      args: ["/path/to/script.js"],
      command: "node",
      env: {
        PATH: "/usr/bin:/bin",
      },
    });

    expect(result.command).toBeTruthy();
    expect(result.args).toEqual(["/path/to/script.js"]);
  });

  test("解析 python3 命令", () => {
    const result = resolveStdioCommand({
      args: ["/path/to/server.py"],
      command: "python3",
      env: {
        PATH: "/usr/bin:/bin",
      },
    });

    expect(result.command).toBeTruthy();
    expect(result.args).toEqual(["/path/to/server.py"]);
  });

  test("保留绝对路径 as-is", () => {
    const absolutePath = "/Users/test/.agents/skill-agent-search/dist/index.js";
    const result = resolveStdioCommand({
      args: [absolutePath],
      command: "node",
      env: {
        PATH: "/usr/bin:/bin",
      },
    });

    expect(result.args).toContain(absolutePath);
    expect(result.checkResult?.method).toBe("candidate"); // Node 走候选路径
  });

  test("includes .local/bin in PATH", () => {
    const result = resolveStdioCommand({
      args: ["test"],
      command: "uvx",
      env: {
        PATH: "/usr/bin:/bin",
      },
    });

    const pathDirs = result.env.PATH!.split(path.delimiter);
    // .local/bin 只有目录存在时才加入 PATH
    if (fs.existsSync(localBin)) {
      expect(pathDirs).toContain(localBin);
    }
    // PATH 应包含用户级 bin 目录(如 .bun/bin)
    expect(pathDirs.length).toBeGreaterThanOrEqual(2);
  });
});

describe("checkCommandExists — 四层回退策略", () => {
  test("第0层: 自定义路径优先", () => {
    // 使用一个肯定存在的路径(如 /usr/bin/ls)
    const customPath = "/usr/bin/ls";
    if (!fs.existsSync(customPath)) {
      return;
    }

    const result = checkCommandExists("my-custom-command", {}, customPath);

    expect(result.found).toBe(true);
    expect(result.method).toBe("custom");
    expect(result.command).toBe(customPath);
  });

  test("第1层: 候选路径表命中 (uvx)", () => {
    const result = checkCommandExists("uvx", {});

    if (hasUvx) {
      // Uvx 存在，应通过某层找到
      expect(result.found).toBe(true);
      expect(["candidate", "path", "shell"]).toContain(result.method);
    } else {
      // Uvx 不存在时，走 shell 兜底或 not_found
      expect(["shell", "not_found"]).toContain(result.method);
    }
  });

  test("第1层: 候选路径表命中 (node)", () => {
    const result = checkCommandExists("node", {});

    // Node 应该能在某层找到
    expect(result.found || hasShell).toBe(true); // 有 shell 兜底时 found 可能为 true
  });

  test("第2层: PATH 搜索命中", () => {
    // Ls 应该在 PATH 中能找到
    const result = checkCommandExists("ls", process.env as Record<string, string>);

    expect(result.found).toBe(true);
    expect(result.method).toBe("path");
  });

  test("第3层: Shell 兜底 (当命令未安装时)", () => {
    // 使用一个几乎不可能存在的命令名
    const result = checkCommandExists("__nonexistent_command_xyz__12345", {});

    if (hasShell) {
      // Shell 兜底应该生效
      expect(result.method).toBe("shell");
      expect(result.found).toBe(true);
      expect(result.command).toMatch(/(bash|zsh)$/);
      expect(result.suggestion).toBeDefined();
    } else {
      // 无 shell 时返回 not_found
      expect(result.method).toBe("not_found");
      expect(result.found).toBe(false);
    }
  });

  test("not_found 时给出友好建议", () => {
    const result = checkCommandExists("uvx", { PATH: "/nonexistent" });

    // 如果 uvx 确实没找到
    if (result.method === "not_found") {
      expect(result.suggestion).toBeDefined();
      expect(result.suggestion).toContain("uvx");
      expect(result.suggestion).toContain("install");
    }
  });

  test("绝对路径直接返回", () => {
    const result = checkCommandExists("/bin/ls", {});

    expect(result.method).toBe("absolute");
    expect(result.found).toBe(fs.existsSync("/bin/ls"));
  });

  test("绝对路径不存在时返回 suggestion", () => {
    const result = checkCommandExists("/nonexistent/path/to/command", {});

    expect(result.method).toBe("absolute");
    expect(result.found).toBe(false);
    expect(result.suggestion).toContain("不存在");
  });
});

describe("Shell 兜底模式", () => {
  test("useShell 标志正确设置", () => {
    const result = resolveStdioCommand({
      args: ["--arg1", "value with spaces"],
      command: "__nonexistent_cmd_test_12345",
      env: { PATH: "/nonexistent" },
    });

    if (result.useShell) {
      // Shell 兜底模式
      expect(result.command).toMatch(/(bash|zsh)$/);
      expect(result.args[0]).toBe("-c");
      expect(result.args[1]).toContain("__nonexistent_cmd_test_12345");
      expect(result.args[1]).toContain("--arg1");
      expect(result.checkResult?.method).toBe("shell");
    }
  });

  test("shell 命令参数正确转义", () => {
    const result = resolveStdioCommand({
      args: ["arg with spaces", "arg'with'quotes", "normal"],
      command: "some-cmd",
      env: { PATH: "/nonexistent" },
    });

    if (result.useShell && result.args.length >= 2) {
      const cmdStr = result.args[1];
      // 空格应该被引号包裹
      expect(cmdStr).toMatch(/'[^']*arg with spaces[^']*'/);
    }
  });
});
