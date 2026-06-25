/**
 * 子代理角色绑定 — 支持 ROLE-<agentName>.md 文件。
 *
 * 职责:
 *   - 为特定子代理加载专属角色文件
 *   - 查找优先级:项目级 > 全局级
 *
 * 命名规范:
 *   - .crab/ROLE-explore.md → explore 子代理
 *   - .crab/ROLE-general.md → general 子代理
 *   - .crab/ROLE-<agentName>.md → 任意子代理
 *
 */

import fs from "node:fs";
import path from "node:path";
import { getGlobalCrabDir } from "@/config";

/**
 * 加载子代理专属角色内容。
 *
 * 查找优先级:
 * 1. <projectRoot>/.crab/ROLE-<agentName>.md(项目级)
 * 2. ~/.crab/ROLE-<agentName>.md(全局级)
 *
 * @param agentName 子代理名称(如 'explore', 'general')
 * @param projectRoot 项目根目录(默认 process.cwd())
 * @returns 角色内容字符串，未找到则返回 null
 */
export function loadSubAgentCustomRole(agentName: string, projectRoot?: string): string | null {
  const filename = `ROLE-${agentName}.md`;
  const root = projectRoot ?? process.cwd();

  // 1. 项目级优先
  const projectPath = path.join(root, ".crab", filename);
  if (fs.existsSync(projectPath)) {
    try {
      const content = fs.readFileSync(projectPath, "utf8");
      if (content.trim()) {
        return content;
      }
    } catch {
      // 读取失败，继续查找全局
    }
  }

  // 2. 全局级
  const globalPath = path.join(getGlobalCrabDir(), filename);
  if (fs.existsSync(globalPath)) {
    try {
      const content = fs.readFileSync(globalPath, "utf8");
      if (content.trim()) {
        return content;
      }
    } catch {
      // 读取失败
    }
  }

  return null;
}

/**
 * 获取所有可用的子代理角色文件名列表。
 *
 * @returns 子代理角色文件名数组(不含 ROLE- 前缀和 .md 后缀)
 */
export function listAvailableSubAgentRoles(projectRoot?: string): string[] {
  const root = projectRoot ?? process.cwd();
  const agentNames = new Set<string>();

  // 扫描项目级
  const projectRoleDir = path.join(root, ".crab");
  if (fs.existsSync(projectRoleDir)) {
    try {
      for (const file of fs.readdirSync(projectRoleDir)) {
        const match = file.match(/^ROLE-([a-zA-Z0-9_-]+)\.md$/i);
        if (match && match[1]) {
          agentNames.add(match[1]);
        }
      }
    } catch {
      // 忽略
    }
  }

  // 扫描全局级
  const globalDir = getGlobalCrabDir();
  if (fs.existsSync(globalDir)) {
    try {
      for (const file of fs.readdirSync(globalDir)) {
        const match = file.match(/^ROLE-([a-zA-Z0-9_-]+)\.md$/i);
        if (match && match[1]) {
          agentNames.add(match[1]);
        }
      }
    } catch {
      // 忽略
    }
  }

  return [...agentNames].toSorted();
}
