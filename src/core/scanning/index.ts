/**
 * Todo 扫描器 — 扫描项目中的 TODO/FIXME/HACK 注释并提取结构化信息。
 *
 * 职责:
 *   - 递归扫描项目目录中的源代码文件
 *   - 识别 TODO/FIXME/HACK 格式的注释标记
 *   - 提取注释内容、行号、文件路径和优先级
 *   - 自动清理僵尸锁和无效锁文件
 *
 * 模块功能:
 *   - ScannedTodoItem: 扫描结果的数据接口
 *   - scanProjectTodos: 扫描项目中的所有 Todo 项
 *   - formatTodoContext: 将 Todo 列表格式化为可读文本
 *
 * 使用场景:
 *   - 代码审查前检查待办事项
 *   - 生成项目 Todo 报告
 *   - 清理代码中的遗留标记
 *
 * 边界:
 * 1. 只扫描本地文件系统，不涉及远程仓库
 * 2. 自动忽略 node_modules/.git/dist 等目录
 * 3. 单文件大小限制为 256KB，防止大文件扫描
 * 4. 只识别 UTF-8 编码文件(排除二进制文件)
 *
 * 流程:
 * 1. 初始化扫描，从项目根目录开始递归遍历
 * 2. 跳过忽略目录和过大文件
 * 3. 逐行匹配 TODO/FIXME/HACK 模式
 * 4. 提取内容并计算优先级(FIXME=high, HACK=medium, TODO=low)
 * 5. 返回格式化的 Todo 列表
 */

import fs from "node:fs";
import path from "node:path";

/**
 * 扫描到的 Todo 项
 */
export interface ScannedTodoItem {
  id: string;
  content: string;
  keyword: "TODO" | "FIXME" | "HACK";
  filePath: string;
  line: number;
  priority: "low" | "medium" | "high";
  source: "scan";
}

const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", ".turbo", ".crab", "coverage"]);

const TODO_PATTERN = /\b(TODO|FIXME|HACK)\b[:\s-]*(.+)?$/;
const MAX_FILE_SIZE = 256 * 1024;

export function scanProjectTodos(rootDir: string): ScannedTodoItem[] {
  const results: ScannedTodoItem[] = [];
  walk(rootDir, rootDir, results);
  return results;
}

export function formatTodoContext(items: ScannedTodoItem[]): string {
  if (items.length === 0) {
    return "No TODO comments found.";
  }

  return items.map((item) => `- [${item.keyword}] ${item.content} (${item.filePath}:${item.line})`).join("\n");
}

function walk(rootDir: string, currentDir: string, results: ScannedTodoItem[], depth = 0): void {
  const MAX_DEPTH = 20;
  if (depth > MAX_DEPTH) {
    return;
  }
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".env") {
      if (IGNORED_DIRS.has(entry.name)) {
        continue;
      }
    }
    if (IGNORED_DIRS.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      walk(rootDir, fullPath, results, depth + 1);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    const stat = fs.statSync(fullPath);
    if (stat.size > MAX_FILE_SIZE) {
      continue;
    }

    const content = fs.readFileSync(fullPath, "utf8");
    if (content.includes("\u0000")) {
      continue;
    }

    const relativePath = path.relative(rootDir, fullPath) || entry.name;
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index] ?? "";
      const match = line.match(TODO_PATTERN);
      if (!match) {
        continue;
      }

      const keyword = match[1] as ScannedTodoItem["keyword"];
      const text = (match[2] ?? "").trim() || line.trim();
      results.push({
        content: text,
        filePath: relativePath,
        id: `scan_${relativePath.replace(/[^\w.-]+/g, "_")}_${index + 1}`,
        keyword,
        line: index + 1,
        priority: priorityForKeyword(keyword),
        source: "scan",
      });
    }
  }
}

function priorityForKeyword(keyword: ScannedTodoItem["keyword"]): ScannedTodoItem["priority"] {
  if (keyword === "FIXME") {
    return "high";
  }
  if (keyword === "HACK") {
    return "medium";
  }
  return "low";
}
