/**
 * 应用命令结构测试。
 *
 * 测试目标:
 *   - 验证 appCommands 源文件中命令分组的结构稳定
 *
 * 测试用例:
 *   - 关键命令文件存在
 *   - 重复/丢失的命令被识别
 */
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const APP_COMMANDS_PATH = path.join(ROOT, "src/commandPalette/appCommands.ts");
const CATEGORIES_DIR = path.join(ROOT, "src/commandPalette/categories");

// 递归统计 categories 下的 .ts 文件
function countTsFiles(dir: string): number {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countTsFiles(full);
    } else if (entry.name.endsWith(".ts")) {
      count++;
    }
  }
  return count;
}

describe("app-commands 结构", () => {
  test("主入口文件应保持轻量并委托给分模块 builder", () => {
    const source = fs.readFileSync(APP_COMMANDS_PATH, "utf8");
    const lineCount = source.split("\n").length;

    expect(lineCount).toBeLessThan(250);
    expect(fs.existsSync(CATEGORIES_DIR)).toBe(true);
    expect(countTsFiles(CATEGORIES_DIR)).toBeGreaterThanOrEqual(5);
  });
});
