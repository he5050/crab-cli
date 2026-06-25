/**
 * Phase 24 工具注册表测试。
 *
 * 测试用例:
 *   - git 工具注册
 *   - format 工具注册
 *   - 内置工具分组
 *   - 工具识别和分组名称
 */
import { describe, expect, test } from "bun:test";
import {
  getBuiltinGroupName,
  getBuiltinToolGroups,
  getRegisteredTools,
  isBuiltinTool,
} from "@/tool/registry/toolRegistry";

describe("Phase 24 工具注册", () => {
  test("git 工具已注册", () => {
    const tools = getRegisteredTools();
    expect(tools["git"]).toBeDefined();
    expect(tools["git"]!.name).toBe("git");
    expect(tools["git"]!.permission).toBe("git");
  });

  test("format 工具已注册", () => {
    const tools = getRegisteredTools();
    expect(tools["format"]).toBeDefined();
    expect(tools["format"]!.name).toBe("format");
    expect(tools["format"]!.permission).toBe("format");
  });

  test("git 和 format 属于内置工具分组", () => {
    const groups = getBuiltinToolGroups();
    const gitGroup = groups.find((g) => g.name === "git");
    const formatGroup = groups.find((g) => g.name === "format");
    expect(gitGroup).toBeDefined();
    expect(gitGroup!.tools).toContain("git");
    expect(formatGroup).toBeDefined();
    expect(formatGroup!.tools).toContain("format");
  });

  test("isBuiltinTool 识别 git 和 format", () => {
    expect(isBuiltinTool("git")).toBe(true);
    expect(isBuiltinTool("format")).toBe(true);
  });

  test("Todo 统一工具属于内置分组", () => {
    const groups = getBuiltinToolGroups();
    const todoGroup = groups.find((g) => g.tools.includes("todo-ultra"));
    expect(todoGroup).toBeDefined();
    expect(todoGroup!.name).toBe("todo");
    expect(todoGroup!.tools).toContain("todo-ultra");
    expect(todoGroup!.tools).not.toContain("todo-manage");
    expect(isBuiltinTool("todo-ultra")).toBe(true);
    expect(isBuiltinTool("todo-manage")).toBe(false);
  });

  test("getBuiltinGroupName 返回正确分组", () => {
    expect(getBuiltinGroupName("git")).toBe("git");
    expect(getBuiltinGroupName("format")).toBe("format");
  });
});
