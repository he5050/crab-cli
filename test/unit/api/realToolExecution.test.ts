/**
 * 真实工具执行测试。
 *
 * 测试用例:
 *   - 工具实际调用
 *   - 结果验证
 *   - 错误处理
 */
import { beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import { createGlobalTmpTestDir } from "../../helpers/testPaths";

describe("真实工具执行 — fsReadTool", () => {
  let fsReadTool: any;
  let tempDir: string;

  beforeAll(async () => {
    const mod = await import("@/tool/filesystem/read");
    ({ fsReadTool } = mod);

    // 创建临时目录和测试文件
    tempDir = createGlobalTmpTestDir("crab-test-");
    await fs.writeFile(path.join(tempDir, "hello.txt"), "Hello, World!");
    await fs.writeFile(path.join(tempDir, "data.json"), '{"key": "value"}');
  });

  test("工具结构完整", () => {
    expect(fsReadTool.name).toBe("filesystem-read");
    expect(fsReadTool.description).toBeDefined();
    expect(fsReadTool.permission).toBe("fs.read");
    expect(typeof fsReadTool.execute).toBe("function");
    expect(fsReadTool.parameters).toBeDefined();
  });

  test("读取存在的文本文件", async () => {
    const result = (await fsReadTool.execute({ path: path.join(tempDir, "hello.txt") })) as any;
    // Hashline 格式: "lineNum:hash\tcontent"
    expect(result.content).toMatch(/1:[0-9a-f]{8}\tHello, World!/);
    expect(result.totalLines).toBe(1);
  });

  test("读取 JSON 文件", async () => {
    const result = (await fsReadTool.execute({ path: path.join(tempDir, "data.json") })) as any;
    expect(result.content).toMatch(/1:[0-9a-f]{8}\t/);
    expect(result.content).toContain('"key": "value"');
    expect(result.totalLines).toBe(1);
  });

  test("读取不存在的文件返回错误(不 throw)", async () => {
    const result = (await fsReadTool.execute({ path: path.join(tempDir, "nonexistent.txt") })) as any;
    expect(result).toHaveProperty("error");
    expect(typeof result.error).toBe("string");
  });

  test("参数 Schema 验证 — 缺少 path 参数", async () => {
    const schema = fsReadTool.parameters;
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
  });

  test("参数 Schema 验证 — path 类型错误", async () => {
    const schema = fsReadTool.parameters;
    const result = schema.safeParse({ path: 123 });
    expect(result.success).toBe(false);
  });

  test("参数 Schema 验证 — 正确参数", async () => {
    const schema = fsReadTool.parameters;
    const result = schema.safeParse({ path: "/some/file.txt" });
    expect(result.success).toBe(true);
  });
});
