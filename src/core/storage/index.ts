/**
 * Pixel Store — 绘画持久化管理。
 *
 * 职责:
 *   - 保存/加载/列出/删除绘画文件到 ~/.crab/draw/
 *   - 管理绘画数据的持久化
 *   - 提供绘画元数据列表
 *
 * 模块功能:
 *   - saveDrawing: 保存绘画到磁盘
 *   - loadDrawing: 加载绘画数据
 *   - listDrawings: 列出所有已保存绘画
 *   - deleteDrawing: 删除绘画文件
 *   - cropGrid: 裁剪网格(移除空白边距)
 *   - gridToArray: Int16Array 转换为二维数组
 *   - arrayToGrid: 二维数组转换为 Int16Array
 *
 * 使用场景:
 *   - 像素画编辑器保存作品
 *   - 加载历史绘画继续编辑
 *   - 管理绘画文件列表
 *
 * 边界:
 *   1. 仅管理文件 I/O，不涉及 UI 渲染
 *   2. 绘画数据存储在 ~/.crab/draw/ 目录
 *   3. 文件名为绘画名称的安全化版本
 *
 * 流程:
 *   1. 确保绘画目录存在
 *   2. 安全化文件名
 *   3. 序列化绘画数据为 JSON
 *   4. 写入文件系统
 *   5. 读取时解析 JSON 并验证数据
 */
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";

/** 绘画数据(磁盘格式) */
export interface DrawingData {
  name: string;
  width: number;
  height: number;
  /** 调色板索引，-1 = 空白 */
  grid: number[][];
  updatedAt: string;
}

/** 绘画元数据(列表用) */
export interface DrawingMeta {
  name: string;
  fileName: string;
  updatedAt: string;
}

const DRAW_DIR = join(homedir(), ".crab", "draw");

function ensureDrawDir(): void {
  if (!existsSync(DRAW_DIR)) {
    mkdirSync(DRAW_DIR, { recursive: true });
  }
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9一-龥_-]/g, "_");
}

/** 保存绘画到磁盘 */
export function saveDrawing(name: string, width: number, height: number, grid: number[][]): void {
  ensureDrawDir();
  const safeName = sanitizeFileName(name);
  const filePath = join(DRAW_DIR, `${safeName}.json`);
  const data: DrawingData = {
    grid,
    height,
    name,
    updatedAt: new Date().toISOString(),
    width,
  };
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

/** 加载绘画(返回 grid 二维数组，失败返回 undefined) */
export function loadDrawing(fileName: string): DrawingData | undefined {
  const filePath = join(DRAW_DIR, fileName);
  if (!existsSync(filePath)) {
    return undefined;
  }
  try {
    const content = readFileSync(filePath, "utf8");
    const data = JSON.parse(content) as DrawingData;
    if (data.grid) {
      return data;
    }
  } catch {
    // Ignore
  }
  return undefined;
}

/** 列出所有已保存绘画(按更新时间倒序) */
export function listDrawings(): DrawingMeta[] {
  ensureDrawDir();
  try {
    const files = readdirSync(DRAW_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const filePath = join(DRAW_DIR, f);
        try {
          const content = readFileSync(filePath, "utf8");
          const data = JSON.parse(content) as { name?: string; updatedAt?: string };
          const stat = statSync(filePath);
          return {
            fileName: f,
            name: data.name ?? f.replace(/\.json$/, ""),
            updatedAt: data.updatedAt ?? stat.mtime.toISOString(),
          };
        } catch {
          return null;
        }
      })
      .filter((d): d is DrawingMeta => d !== null)
      .toSorted((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return files;
  } catch {
    return [];
  }
}

/** 删除绘画文件 */
export function deleteDrawing(fileName: string): boolean {
  const filePath = join(DRAW_DIR, fileName);
  try {
    unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

/** 裁剪网格(移除空白边距) */
export function cropGrid(grid: number[][], width: number, height: number): number[][] {
  if (!grid || grid.length === 0) {
    return [];
  }
  let minY = height,
    maxY = -1,
    minX = width,
    maxX = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const val = grid[y]?.[x] ?? -1;
      if (val !== -1) {
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
    }
  }
  if (maxY < 0) {
    return [];
  }
  return grid.slice(minY, maxY + 1).map((row) => row.slice(minX, maxX + 1));
}

/** 将 Int16Array 转换为二维数组(用于保存) */
export function gridToArray(data: Int16Array, width: number, height: number): number[][] {
  const result: number[][] = [];
  for (let y = 0; y < height; y++) {
    const row: number[] = [];
    for (let x = 0; x < width; x++) {
      row.push(data[y * width + x] ?? -1);
    }
    result.push(row);
  }
  return result;
}

/** 将二维数组转换为 Int16Array(用于加载) */
export function arrayToGrid(arr: number[][], width: number, height: number): Int16Array {
  const data = new Int16Array(width * height).fill(-1);
  for (let y = 0; y < Math.min(arr.length, height); y++) {
    for (let x = 0; x < Math.min(arr[y]?.length ?? 0, width); x++) {
      data[y * width + x] = arr[y]?.[x] ?? -1;
    }
  }
  return data;
}
