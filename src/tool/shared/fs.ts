import { existsSync, mkdirSync } from "node:fs";

/**
 * 确保目录存在，不存在时递归创建
 * @param dir - 目标目录路径
 */
/** ensureDir 的实现 */
export function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}
