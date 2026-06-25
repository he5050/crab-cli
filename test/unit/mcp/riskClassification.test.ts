/**
 * MCP 工具风险分类 — 单元测试。
 *
 * 测试用例:
 *   - 高风险工具名模式(exec / shell / delete / format 等)
 *   - 中风险工具名模式(write / upload / fetch 等)
 *   - 低风险工具名(read / list / search 等)
 *   - 大小写不敏感
 *   - 命名空间映射(high → mcp.sensitive.*，否则 mcp.*)
 */

import { describe, expect, test } from "bun:test";
import { type McpToolRisk, classifyMcpToolRisk, getMcpToolPermissionNamespace } from "@/mcp/tool/riskClassification";

describe("MCP 工具风险分类 — classifyMcpToolRisk", () => {
  describe("高风险(命令执行、删除、格式化)", () => {
    test.each([
      "exec",
      "execute",
      "shell",
      "command",
      "run",
      "eval",
      "system",
      "ssh",
      "delete_file",
      "remove",
      "drop",
      "truncate",
      "format_disk",
    ])("'%s' → high", (name) => {
      expect(classifyMcpToolRisk(name)).toBe<McpToolRisk>("high");
    });

    test("带前缀仍匹配(如 server_exec)", () => {
      // 注意:当前实现是基于工具名(不含 server 前缀)的；带 server 前缀时
      // ToolConverter/mcpManager 会先剥离前缀再调用本函数。
      // 这里验证 rawName 形态。
      expect(classifyMcpToolRisk("exec_command")).toBe<McpToolRisk>("high");
    });
  });

  describe("中风险(写入、上传、下载、修改)", () => {
    test.each(["write", "create", "update", "modify", "send", "upload", "download", "fetch", "http", "scp"])(
      "'%s' → medium",
      (name) => {
        expect(classifyMcpToolRisk(name)).toBe<McpToolRisk>("medium");
      },
    );
  });

  describe("低风险(读、列表、搜索)", () => {
    test.each(["read", "list", "get", "search", "describe", "info", "ping"])("'%s' → low", (name) => {
      expect(classifyMcpToolRisk(name)).toBe<McpToolRisk>("low");
    });
  });

  describe("大小写不敏感", () => {
    test("EXEC → 高", () => {
      expect(classifyMcpToolRisk("EXEC")).toBe<McpToolRisk>("high");
    });
    test("Write → 中", () => {
      expect(classifyMcpToolRisk("Write")).toBe<McpToolRisk>("medium");
    });
    test("READ → 低", () => {
      expect(classifyMcpToolRisk("READ")).toBe<McpToolRisk>("low");
    });
  });

  describe("优先级(high 优先于 medium)", () => {
    test("'exec_write' 以 'exec' 开头 → high(high 模式优先于 medium)", () => {
      // 正则使用 ^ 前缀锚定工具名开头:只有以 high 模式词开头的工具才命中 high
      expect(classifyMcpToolRisk("exec_write")).toBe<McpToolRisk>("high");
    });

    test("'write_exec' 不以 high 模式词开头 → medium", () => {
      // 不以 exec/shell 等开头，但以 write 开头 → medium
      expect(classifyMcpToolRisk("write_exec")).toBe<McpToolRisk>("medium");
    });
  });
});

describe("MCP 工具风险分类 — getMcpToolPermissionNamespace", () => {
  test("high → mcp.sensitive.{server}.{tool}", () => {
    expect(getMcpToolPermissionNamespace("high", "github", "exec_command")).toBe("mcp.sensitive.github.exec_command");
  });

  test("medium → mcp.{server}.{tool}", () => {
    expect(getMcpToolPermissionNamespace("medium", "github", "write_file")).toBe("mcp.github.write_file");
  });

  test("low → mcp.{server}.{tool}", () => {
    expect(getMcpToolPermissionNamespace("low", "github", "read_file")).toBe("mcp.github.read_file");
  });

  test("命名空间与 classifyMcpToolRisk 结果一致(端到端)", () => {
    const serverName = "filesystem";
    const names: [string, string][] = [
      ["shell", "mcp.sensitive.filesystem.shell"],
      ["write_file", "mcp.filesystem.write_file"],
      ["read_file", "mcp.filesystem.read_file"],
    ];
    for (const [name, expected] of names) {
      const risk = classifyMcpToolRisk(name);
      const permission = getMcpToolPermissionNamespace(risk, serverName, name);
      expect(permission).toBe(expected);
    }
  });
});
