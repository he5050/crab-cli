/**
 * 通配符权限测试。
 *
 * 测试用例:
 *   - 通配符匹配
 *   - 多级通配符
 *   - 优先级处理
 */
import { describe, expect, test } from "bun:test";
import { wildcardMatch } from "@/permission/core/wildcard";

describe("通配符匹配引擎", () => {
  test("* 匹配任意字符串", () => {
    expect(wildcardMatch("*", "anything")).toBe(true);
    expect(wildcardMatch("*", "")).toBe(true);
  });

  test("** 匹配任意(含路径分隔符)", () => {
    expect(wildcardMatch("**", "src/a/b.ts")).toBe(true);
  });

  test("*.ts 匹配 .ts 文件", () => {
    expect(wildcardMatch("*.ts", "foo.ts")).toBe(true);
    expect(wildcardMatch("*.ts", "src/foo.ts")).toBe(true);
    expect(wildcardMatch("*.ts", "foo.js")).toBe(false);
  });

  test("src/** 匹配深层路径", () => {
    expect(wildcardMatch("src/**", "src/a/b/c.ts")).toBe(true);
    expect(wildcardMatch("src/**", "src/foo.ts")).toBe(true);
    expect(wildcardMatch("src/**", "lib/foo.ts")).toBe(false);
  });

  test("精确匹配", () => {
    expect(wildcardMatch("exact-cmd", "exact-cmd")).toBe(true);
    expect(wildcardMatch("exact-cmd", "other-cmd")).toBe(false);
  });

  test("git * 匹配 git 子命令", () => {
    expect(wildcardMatch("git *", "git status")).toBe(true);
    expect(wildcardMatch("git *", "git diff")).toBe(true);
    expect(wildcardMatch("git *", "git log --oneline")).toBe(true);
    expect(wildcardMatch("git *", "svn status")).toBe(false);
  });

  test("rm -rf /* 不匹配普通 rm", () => {
    expect(wildcardMatch("rm -rf /*", "rm -rf /")).toBe(true);
    expect(wildcardMatch("rm -rf /*", "rm -rf /*")).toBe(true);
    expect(wildcardMatch("rm -rf /*", "rm file.txt")).toBe(false);
  });

  test("sudo * 匹配 sudo 子命令", () => {
    expect(wildcardMatch("sudo *", "sudo apt install")).toBe(true);
    expect(wildcardMatch("sudo *", "apt install")).toBe(false);
  });

  test("** 匹配所有路径", () => {
    expect(wildcardMatch("**", "/")).toBe(true);
    expect(wildcardMatch("**", "a/b/c/d")).toBe(true);
  });

  test("? 匹配单字符", () => {
    expect(wildcardMatch("file?.ts", "file1.ts")).toBe(true);
    expect(wildcardMatch("file?.ts", "fileA.ts")).toBe(true);
    expect(wildcardMatch("file?.ts", "file12.ts")).toBe(false);
  });

  test("空模式只匹配空串", () => {
    expect(wildcardMatch("", "")).toBe(true);
    expect(wildcardMatch("", "a")).toBe(false);
  });

  test("字符集匹配单个候选字符", () => {
    expect(wildcardMatch("file[abc].ts", "filea.ts")).toBe(true);
    expect(wildcardMatch("file[abc].ts", "filec.ts")).toBe(true);
    expect(wildcardMatch("file[abc].ts", "filez.ts")).toBe(false);
  });

  test("字符范围匹配边界字符并拒绝范围外字符", () => {
    expect(wildcardMatch("file[0-9].ts", "file0.ts")).toBe(true);
    expect(wildcardMatch("file[0-9].ts", "file9.ts")).toBe(true);
    expect(wildcardMatch("file[0-9].ts", "filex.ts")).toBe(false);
  });

  test("未闭合字符集按字面量逐字符匹配", () => {
    expect(wildcardMatch("file[abc", "file[abc")).toBe(true);
    expect(wildcardMatch("file[abc", "file[abx")).toBe(false);
    expect(wildcardMatch("file[abc", "filexabc")).toBe(false);
  });

  test("中段双星号失败时返回 false", () => {
    expect(wildcardMatch("src/**/index.ts", "lib/a/index.ts")).toBe(false);
  });

  test("模式末尾剩余星号可以匹配空后缀", () => {
    expect(wildcardMatch("abc***", "abc")).toBe(true);
    expect(wildcardMatch("abc***", "ab")).toBe(false);
  });
});
