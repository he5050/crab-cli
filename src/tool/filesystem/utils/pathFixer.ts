/**
 * 路径修复 — 尝试修正常见的路径错误。
 *
 * 职责:
 *   - 检测路径错误
 *   - 尝试修复常见路径问题
 *   - 提供多种修复策略
 *   - 验证修复后的路径
 *
 * 模块功能:
 *   - tryFixPath: 尝试修复路径
 *   - 移除多余目录层级
 *   - 缩短路径
 *   - 在常见目录中搜索
 *
 * 使用场景:
 *   - 文件未找到时尝试修复
 *   - 处理路径拼写错误
 *   - 自动路径纠正
 *   - 跨平台路径处理
 *
 * 边界:
 *   1. 尝试移除 'utils' 目录
 *   2. 尝试缩短路径层级
 *   3. 在常见目录中搜索
 *   4. 验证修复后的路径存在性
 *   5. 无法修复时返回 null
 *
 * 流程:
 *   1. 解析原始路径
 *   2. 尝试移除 utils 目录
 *   3. 尝试缩短路径
 *   4. 在常见目录搜索
 *   5. 返回修复后的路径或 null
 */

import { access } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * 尝试修复常见的路径问题。
 * 当文件未找到时，尝试多种修正策略。
 *
 * @returns 修正后的路径，无法修正时返回 null
 */
export async function tryFixPath(originalPath: string, basePath: string): Promise<string | null> {
  try {
    const segments = originalPath.split("/");

    // 尝试移除 'utils' 目录
    if (segments.includes("utils")) {
      const withoutUtils = segments.filter((s) => s !== "utils").join("/");
      const fixedPath = resolve(basePath, withoutUtils);
      try {
        await access(fixedPath);
        return withoutUtils;
      } catch {
        /* Continue */
      }
    }

    // 尝试缩短路径(保留文件名，逐级减少目录层级)
    for (let i = 0; i < segments.length - 1; i++) {
      const reducedPath = [...segments.slice(0, i), segments[segments.length - 1]!].join("/");
      const fixedPath = resolve(basePath, reducedPath);
      try {
        await access(fixedPath);
        return reducedPath;
      } catch {
        /* Continue */
      }
    }

    // 在常见目录中搜索文件
    const fileName = segments[segments.length - 1];
    const commonDirs = ["source", "src", "lib", "dist"];

    for (const dir of commonDirs) {
      const searchPath = `${dir}/${fileName}`;
      const fixedPath = resolve(basePath, searchPath);
      try {
        await access(fixedPath);
        return searchPath;
      } catch {
        /* Continue */
      }
    }

    return null;
  } catch {
    return null;
  }
}
