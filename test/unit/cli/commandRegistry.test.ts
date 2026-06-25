/**
 * CLI 命令注册表单元测试
 *
 * 测试重点:
 *   - registerCommand 正常注册
 *   - getCommand 查询已注册/未注册命令
 *   - 重复注册抛错
 *   - __clearCommandRegistry 清空
 *   - getAllCommands 返回所有命令
 */
import { describe, expect, test, beforeEach } from "bun:test";
import { registerCommand, getCommand, getAllCommands, __clearCommandRegistry } from "@/cli/core/commandRegistry";
import type { CliCommand } from "@/cli/core/commandRegistry";

describe("CommandRegistry", () => {
  beforeEach(() => {
    __clearCommandRegistry();
  });

  const mockCommand: CliCommand = {
    mode: "setup",
    description: "测试命令",
    execute: async () => {},
  };

  test("registerCommand 注册命令后可通过 getCommand 获取", () => {
    registerCommand(mockCommand);
    const result = getCommand("setup");
    expect(result).toBe(mockCommand);
  });

  test("getCommand 返回 undefined 当命令未注册", () => {
    const result = getCommand("acp");
    expect(result).toBeUndefined();
  });

  test("重复注册相同 mode 抛出错误", () => {
    registerCommand(mockCommand);
    expect(() => registerCommand(mockCommand)).toThrow("命令已存在: setup");
  });

  test("getAllCommands 返回所有已注册命令", () => {
    const cmd2: CliCommand = {
      mode: "acp",
      description: "第二个命令",
      execute: async () => {},
    };
    registerCommand(mockCommand);
    registerCommand(cmd2);
    const all = getAllCommands();
    expect(all).toHaveLength(2);
    expect(all.map((c) => c.mode)).toEqual(["setup", "acp"]);
  });

  test("__clearCommandRegistry 清空所有注册", () => {
    registerCommand(mockCommand);
    expect(getCommand("setup")).toBe(mockCommand);
    __clearCommandRegistry();
    expect(getCommand("setup")).toBeUndefined();
  });

  test("getCommand 在空注册表中返回 undefined", () => {
    expect(getAllCommands()).toHaveLength(0);
    expect(getCommand("acp")).toBeUndefined();
  });
});
