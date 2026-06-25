/**
 * 像素编辑器测试。
 *
 * 测试用例:
 *   - gridToArray / arrayToGrid 双向转换
 *   - cropGrid 裁剪空白边距
 *   - 全空网格处理
 *   - 像素数据存储
 *   - PixelEditor 关键交互入口存在
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "path";
import { existsSync, readFileSync, rmSync } from "fs";

describe("Pixel Store", () => {
  const testDir = join(import.meta.dir, "__test_draw__");

  afterAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { force: true, recursive: true });
    }
  });

  test("gridToArray / arrayToGrid 双向转换", async () => {
    const { gridToArray, arrayToGrid } = await import("@/core/storage");
    const original = new Int16Array(4).fill(-1);
    original[1] = 3;
    original[2] = 5;
    const arr = gridToArray(original, 2, 2);
    expect(arr).toEqual([
      [-1, 3],
      [5, -1],
    ]);
    const back = arrayToGrid(arr, 2, 2);
    expect([...back]).toEqual([...original]);
  });

  test("cropGrid 裁剪空白边距", async () => {
    const { cropGrid } = await import("@/core/storage");
    const grid = [
      [-1, -1, -1, -1],
      [-1, 1, -1, -1],
      [-1, -1, 2, -1],
      [-1, -1, -1, -1],
    ];
    const cropped = cropGrid(grid, 4, 4);
    expect(cropped).toEqual([
      [1, -1],
      [-1, 2],
    ]);
  });

  test("cropGrid 全空返回空数组", async () => {
    const { cropGrid } = await import("@/core/storage");
    const grid = [
      [-1, -1],
      [-1, -1],
    ];
    const cropped = cropGrid(grid, 2, 2);
    expect(cropped).toEqual([]);
  });

  test("PixelEditor 保留关键菜单与编辑交互入口", () => {
    const source = readFileSync(`${import.meta.dir}/../../../../src/ui/pages/pixelEditor.tsx`, "utf8");

    expect(source).toContain('type View = "menu" | "editor" | "manager"');
    expect(source).toContain("iconTheme} 新建画布");
    expect(source).toContain("iconFolder} 管理绘画");
    expect(source).toContain('if (view() === "menu")');
    expect(source).toContain('if (view() === "editor")');
    expect(source).toContain('if (view() === "manager")');
    expect(source).toContain("Ctrl+S");
    expect(source).toContain("setShowExport(true)");
  });
});
