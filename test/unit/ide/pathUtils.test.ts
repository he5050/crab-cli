/**
 * IDE 共享路径工具测试
 */
import { describe, it, expect, mock } from "bun:test";

// 隔离 mock：防止其他测试文件的 @/config 或 @/ide/shared/pathUtils mock 泄漏
mock.module("@/config", () => ({
  getGlobalTmpDir: () => "/tmp/crab",
}));

import { normalizePath, IDE_CLI_COMMANDS } from "@/ide/shared/pathUtils";

describe("pathUtils", () => {
  describe("normalizePath", () => {
    it("Windows 路径: 反斜杠转正斜杠 + 盘符小写", () => {
      expect(normalizePath(String.raw`C:\Users\test`)).toBe("c:/Users/test");
    });

    it("混合路径: 反斜杠和正斜杠混合", () => {
      expect(normalizePath(String.raw`C:\foo\bar/baz`)).toBe("c:/foo/bar/baz");
    });

    it("Unix 路径保持不变", () => {
      expect(normalizePath("/home/user")).toBe("/home/user");
    });

    it("根路径保持不变", () => {
      expect(normalizePath("/")).toBe("/");
    });

    it("空字符串保持不变", () => {
      expect(normalizePath("")).toBe("");
    });

    it("小写盘符路径不变", () => {
      expect(normalizePath(String.raw`c:\Users`)).toBe("c:/Users");
    });

    it("大写盘符转小写", () => {
      expect(normalizePath(String.raw`D:\projects`)).toBe("d:/projects");
    });

    it("纯反斜杠路径(无盘符)转正斜杠", () => {
      expect(normalizePath(String.raw`path\to\file`)).toBe("path/to/file");
    });
  });

  describe("IDE_CLI_COMMANDS", () => {
    it("包含 Cursor → cursor", () => {
      expect(IDE_CLI_COMMANDS["Cursor"]).toBe("cursor");
    });

    it("包含 VSCode → code", () => {
      expect(IDE_CLI_COMMANDS["VSCode"]).toBe("code");
    });

    it("包含 VSCode Insiders → code-insiders", () => {
      expect(IDE_CLI_COMMANDS["VSCode Insiders"]).toBe("code-insiders");
    });

    it("未知 IDE 返回 undefined", () => {
      expect(IDE_CLI_COMMANDS["Unknown"]).toBeUndefined();
    });
  });
});
