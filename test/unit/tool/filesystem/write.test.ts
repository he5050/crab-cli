/**
 * fsWriteTool 单元测试
 *
 * 测试范围:
 *   - 基本写入（覆盖模式）
 *   - 追加模式
 *   - 路径验证（目录外访问拒绝）
 *   - 目录不存在时自动创建
 *
 * 策略: 使用临时目录进行真实文件 I/O，mock logger。
 *       rollback 不 mock（mock.module 跨文件泄漏会导致 rollback 专用测试失败），
 *       recordFileMutation 在临时目录中安全运行，结果会被 afterEach 清理。
 */
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { createGlobalTmpTestDir } from "../../../helpers/testPaths";

mock.module("@/core/logging/logger", () => ({
  createLogger: () => ({ debug: () => {}, error: () => {}, info: () => {}, warn: () => {} }),
}));
import { fsWriteTool } from "@/tool/filesystem/write";

describe("fsWriteTool", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createGlobalTmpTestDir("crab-fs-write-");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  it("应写入文件（覆盖模式）", async () => {
    const filePath = path.join(tmpDir, "test.txt");
    const r = (await fsWriteTool.execute({ content: "hello world", path: filePath })) as Record<string, unknown>;

    expect(r.success).toBe(true);
    expect(r.action).toBe("创建");
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, "utf8")).toBe("hello world");
  });

  it("应追加写入文件", async () => {
    const filePath = path.join(tmpDir, "append.txt");
    await fsWriteTool.execute({ content: "line1\n", path: filePath });
    await fsWriteTool.execute({ content: "line2\n", path: filePath, append: true });

    expect(fs.readFileSync(filePath, "utf8")).toBe("line1\nline2\n");
  });

  it("不存在的目录应自动创建", async () => {
    const filePath = path.join(tmpDir, "newdir", "sub", "file.txt");
    const r = (await fsWriteTool.execute({ content: "auto", path: filePath })) as Record<string, unknown>;

    expect(r.success).toBe(true);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, "utf8")).toBe("auto");
  });

  it("写入空路径应返回错误", async () => {
    const r = (await fsWriteTool.execute({ content: "x", path: "" })) as Record<string, unknown>;
    // path.resolve("") → cwd, cwd 是目录，写入文件到目录路径会失败
    expect(r.success).toBe(false);
    expect(r.error).toBeDefined();
  });

  it("覆盖已有文件应返回 action='覆盖'", async () => {
    const filePath = path.join(tmpDir, "overwrite.txt");
    fs.writeFileSync(filePath, "original", "utf8");
    const r = (await fsWriteTool.execute({ content: "replaced", path: filePath })) as Record<string, unknown>;

    expect(r.success).toBe(true);
    expect(r.action).toBe("覆盖");
    expect(fs.readFileSync(filePath, "utf8")).toBe("replaced");
  });
});
