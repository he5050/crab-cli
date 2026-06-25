/**
 * 路径安全验证测试
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { validatePathWithinCwd } from "@/tool/filesystem/utils/index";

describe("路径安全验证 (validatePathWithinCwd)", () => {
  let tmpdir: string;

  beforeEach(() => {
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "crab-path-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  });

  it("绝对路径在 cwd 内通过", () => {
    const absPath = path.join(tmpdir, "file.txt");
    const result = validatePathWithinCwd(absPath, tmpdir);
    expect(result).toBeNull();
  });

  it("子目录绝对路径通过", () => {
    const subDir = path.join(tmpdir, "src", "index.ts");
    fs.mkdirSync(path.join(tmpdir, "src"), { recursive: true });
    const result = validatePathWithinCwd(subDir, tmpdir);
    expect(result).toBeNull();
  });

  it("路径遍历 ../ 被拒绝", () => {
    const result = validatePathWithinCwd("../etc/passwd", tmpdir);
    expect(result).not.toBeNull();
    expect(result).toContain("路径越界");
  });

  it("绝对路径在 cwd 外被拒绝", () => {
    const result = validatePathWithinCwd("/etc/passwd", tmpdir);
    expect(result).not.toBeNull();
    expect(result).toContain("路径越界");
  });

  it("符号链接指向 cwd 外被拒绝", () => {
    // 创建符号链接指向 cwd 外部
    const linkPath = path.join(tmpdir, "outside_link");
    try {
      fs.symlinkSync("/etc/passwd", linkPath);
    } catch {
      // macOS 可能需要额外权限，跳过
      fs.writeFileSync(linkPath, "placeholder");
      return;
    }
    const result = validatePathWithinCwd(linkPath, tmpdir);
    expect(result).not.toBeNull();
    expect(result).toContain("路径越界");
  });

  it("符号链接指向 cwd 内通过", () => {
    // 创建文件和指向它的符号链接
    const targetFile = path.join(tmpdir, "target.txt");
    fs.writeFileSync(targetFile, "hello");

    const linkPath = path.join(tmpdir, "inner_link");
    try {
      fs.symlinkSync(targetFile, linkPath);
    } catch {
      // macOS 可能需要额外权限，跳过
      return;
    }
    const result = validatePathWithinCwd(linkPath, tmpdir);
    expect(result).toBeNull();
  });

  it("相对路径遍历到上级被拒绝", () => {
    const subDir = path.join(tmpdir, "subdir");
    fs.mkdirSync(subDir);
    const result = validatePathWithinCwd("../../etc/passwd", subDir);
    expect(result).not.toBeNull();
  });

  it("使用 cwd 本身通过", () => {
    const result = validatePathWithinCwd(tmpdir, tmpdir);
    expect(result).toBeNull();
  });

  it("深层子目录绝对路径通过", () => {
    const deep = path.join(tmpdir, "a", "b", "c", "d", "e", "f.txt");
    fs.mkdirSync(path.join(tmpdir, "a", "b", "c", "d", "e"), { recursive: true });
    const result = validatePathWithinCwd(deep, tmpdir);
    expect(result).toBeNull();
  });

  it("绝对路径 cwd 外上层目录被拒绝", () => {
    const outside = path.dirname(tmpdir);
    const result = validatePathWithinCwd(outside, tmpdir);
    expect(result).not.toBeNull();
    expect(result).toContain("路径越界");
  });
});
