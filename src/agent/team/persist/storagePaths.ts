/**
 * [团队存储路径]
 *
 * 职责:
 *   - 提供团队存储目录路径
 *   - 提供团队快照目录路径
 *   - 解析项目目录
 *
 * 模块功能:
 *   - resolveTeamProjectDir:解析项目目录
 *   - getTeamStorageDir:获取团队存储目录
 *   - getTeamSnapshotDir:获取团队快照目录
 *
 * 使用场景:
 *   - 团队配置持久化
 *   - 团队快照保存
 *   - 团队数据管理
 *
 * 边界:
 *   1. 路径基于项目 .crab 目录
 *   2. 使用 node:path 处理跨平台路径
 *
 * 流程:
 *   1. 解析项目目录
 *   2. 基于 .crab 目录构建子目录路径
 *   3. 返回标准化的绝对路径
 */

import path from "node:path";
import { getProjectCrabDir } from "@/config";

/**
 * 解析团队项目目录
 * @param projectDir - 项目目录路径，默认为当前工作目录
 * @returns 解析后的绝对路径
 */
export function resolveTeamProjectDir(projectDir?: string): string {
  return path.resolve(projectDir ?? process.cwd());
}

export function getTeamStorageDir(projectDir?: string): string {
  return path.join(getProjectCrabDir(resolveTeamProjectDir(projectDir)), "teams");
}

export function getTeamSnapshotDir(projectDir?: string): string {
  return path.join(getProjectCrabDir(resolveTeamProjectDir(projectDir)), "team-snapshots");
}
