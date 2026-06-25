/**
 * 文件工具测试。
 *
 * 测试用例:
 *   - 文本文件读写
 *   - JSON 文件读写
 *   - 文件存在检查
 */
import { afterAll, describe, expect, test } from "bun:test";
import { fileExists, readJsonFile, readTextFile, writeJsonFile, writeTextFile } from "@/core/utilities/fileUtils";
import { rmSync } from "fs";
import { join } from "path";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../helpers/testPaths";

const TMP = createGlobalTmpTestDir("crab-test-");

afterAll(() => {
  cleanupTestDir(TMP);
});

describe("File Utils — 文件工具", () => {
  test("writeTextFile + readTextFile 正常读写", async () => {
    const path = join(TMP, "test.txt");
    const ok = await writeTextFile(path, "Hello Crab");
    expect(ok).toBe(true);
    const content = await readTextFile(path);
    expect(content).toBe("Hello Crab");
  });

  test("readTextFile 不存在的文件返回 null", async () => {
    const content = await readTextFile(join(TMP, "nonexistent.txt"));
    expect(content).toBeNull();
  });

  test("fileExists 检查文件存在", async () => {
    const path = join(TMP, "exists.txt");
    await writeTextFile(path, "yes");
    expect(await fileExists(path)).toBe(true);
    expect(await fileExists(join(TMP, "nope.txt"))).toBe(false);
  });

  test("readJsonFile + writeJsonFile JSON 读写", async () => {
    const path = join(TMP, "data.json");
    await writeJsonFile(path, { name: "crab", version: 1 });
    const data = await readJsonFile<{ name: string; version: number }>(path);
    expect(data).toEqual({ name: "crab", version: 1 });
  });
});
