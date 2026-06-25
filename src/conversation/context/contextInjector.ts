/**
 * 上下文注入器 — 注入代码库上下文到对话中。
 *
 * 职责:
 *   - 获取当前目录结构
 *   - 获取最近修改文件列表
 *   - 将代码库上下文文本化供系统提示词使用
 *
 * 模块功能:
 *   - buildCodebaseContext(): 构建代码库上下文文本
 *   - injectContextToMessage(): 将上下文注入用户消息
 *
 * 使用场景:
 *   - 对话开始前获取代码库上下文
 *   - 系统提示词构建时注入目录结构
 *
 * 边界:
 * 1. 使用 tree 命令获取目录树，回退到 find 命令
 * 2. 使用 git ls-files 获取最近修改文件
 * 3. 排除 node_modules、.git、dist 等无关目录
 *
 * 流程:
 * 1. 执行 tree 命令获取目录结构(受 maxDirDepth 限制)
 * 2. 执行 git 命令获取最近修改文件
 * 3. 格式化输出为 Markdown 文本
 */

import { createLogger } from "@/core/logging/logger";

const log = createLogger("conversation:context");

/** 上下文注入选项 */
export interface ContextInjectOptions {
  /** 当前工作目录 */
  cwd: string;
  /** 是否注入目录结构 */
  includeDirTree?: boolean;
  /** 是否注入最近修改文件 */
  includeRecentFiles?: boolean;
  /** 目录树最大深度 */
  maxDirDepth?: number;
  /** 最近修改文件数量 */
  recentFileCount?: number;
}

/** 默认上下文注入选项 */
const DEFAULT_OPTIONS: Required<ContextInjectOptions> = {
  cwd: process.cwd(),
  includeDirTree: true,
  includeRecentFiles: true,
  maxDirDepth: 3,
  recentFileCount: 10,
};

/**
 * 构建代码库上下文文本。
 *
 * 包含:
 *   1. 目录树结构(受 maxDirDepth 限制)
 *   2. 最近修改文件列表
 *
 *
 * @returns 格式化的上下文文本(可直接拼接到系统提示词中)
 */
export async function buildCodebaseContext(options?: Partial<ContextInjectOptions>): Promise<string> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const sections: string[] = [];

  try {
    // 1. 目录树
    if (opts.includeDirTree) {
      const dirTree = await getDirectoryTree(opts.cwd, opts.maxDirDepth);
      if (dirTree) {
        sections.push(`## 目录结构\n\n\`\`\`\n${dirTree}\n\`\`\``);
      }
    }
  } catch (error) {
    log.debug(`获取目录树失败: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    // 2. 最近修改文件
    if (opts.includeRecentFiles) {
      const recentFiles = await getRecentFiles(opts.cwd, opts.recentFileCount);
      if (recentFiles.length > 0) {
        sections.push(`## 最近修改文件\n\n${recentFiles.map((f) => `- ${f}`).join("\n")}`);
      }
    }
  } catch (error) {
    log.debug(`获取最近修改文件失败: ${error instanceof Error ? error.message : String(error)}`);
  }

  return sections.join("\n\n");
}

/**
 * 获取目录树(简化版)。
 *
 * 使用 Bun.$ 执行 tree 命令，如果不可用则回退到手动遍历。
 * 排除 node_modules、.git、dist 等常见无关目录。
 */
async function getDirectoryTree(cwd: string, maxDepth: number): Promise<string> {
  try {
    // Bun.$ 标签模板对 ${cwd} 插值自动转义，不存在命令注入风险
    const proc = Bun.$`cd ${cwd} && tree -L ${String(maxDepth)} -I 'node_modules|.git|dist|.next|build|coverage' --dirsfirst 2>/dev/null || true`;
    const result = await proc;
    const output = result.stdout.toString().trim();
    if (output && !output.includes("command not found")) {
      // 截断过长的输出
      return output.length > 4000 ? `${output.slice(0, 4000)}\n...[截断]` : output;
    }
  } catch {
    // Tree 命令不可用，回退
  }

  // 回退:使用 find 模拟
  try {
    const proc = Bun.$`cd ${cwd} && find . -maxdepth ${String(maxDepth)} -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/build/*' | head -100 | sort`;
    const result = await proc;
    const output = result.stdout.toString().trim();
    return output.length > 4000 ? `${output.slice(0, 4000)}\n...[截断]` : output;
  } catch {
    return "";
  }
}

/**
 * 获取最近修改的文件列表。
 *
 * 使用 git ls-files + stat 获取，如果不是 git 仓库则使用 find + sort。
 */
async function getRecentFiles(cwd: string, count: number): Promise<string[]> {
  try {
    // Bun.$ 标签模板对 ${cwd} 和 ${count} 插值自动转义，不存在命令注入风险
    const proc = Bun.$`cd ${cwd} && git diff --name-only HEAD~10 2>/dev/null | head -${String(count)} || git ls-files -m 2>/dev/null | head -${String(count)} || true`;
    const result = await proc;
    const output = result.stdout.toString().trim();
    if (output) {
      return output.split("\n").filter(Boolean).slice(0, count);
    }
  } catch {
    // Git 不可用
  }

  return [];
}

/**
 * 注入代码库上下文到用户消息中。
 *
 * 将代码库上下文作为前缀添加到用户消息内容中。
 * 如果用户消息已经包含了代码库上下文标记，则跳过。
 *
 *
 * @returns 注入后的消息内容，或原始内容(无需注入时)
 */
export function injectContextToMessage(userContent: string, contextText: string): string {
  if (!contextText.trim()) {
    return userContent;
  }

  // 避免重复注入
  if (userContent.includes("## 目录结构") || userContent.includes("## 最近修改文件")) {
    return userContent;
  }

  return `${contextText}\n\n---\n\n${userContent}`;
}
