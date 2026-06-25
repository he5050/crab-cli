/**
 * 项目设置 — 项目级工具/模式配置的便捷读写。
 *
 * 职责:
 *   - 提供项目级工具/模式配置的便捷读写
 *   - 基于统一设置存储
 *   - 提供类型安全的 getter/setter
 *
 * 模块功能:
 *   - getToolSearchEnabled: 获取工具搜索启用状态
 *   - setToolSearchEnabled: 设置工具搜索启用状态
 *   - getAutoFormatEnabled: 获取自动格式化启用状态
 *   - setAutoFormatEnabled: 设置自动格式化启用状态
 *   - getSubAgentMaxSpawnDepth: 获取子代理最大生成深度
 *   - setSubAgentMaxSpawnDepth: 设置子代理最大生成深度
 *   - getFileListDisplayMode: 获取文件列表显示模式
 *   - setFileListDisplayMode: 设置文件列表显示模式
 *   - getYoloMode: 获取 YOLO 模式状态
 *   - setYoloMode: 设置 YOLO 模式状态
 *   - getPlanMode: 获取计划模式状态
 *   - setPlanMode: 设置计划模式状态
 *   - getVulnerabilityHuntingMode: 获取漏洞扫描模式状态
 *   - setVulnerabilityHuntingMode: 设置漏洞扫描模式状态
 *   - getHybridCompressEnabled: 获取混合压缩启用状态
 *   - setHybridCompressEnabled: 设置混合压缩启用状态
 *   - getTeamMode: 获取团队模式状态
 *   - setTeamMode: 设置团队模式状态
 *   - ProjectSettings: 项目设置接口
 *
 * 使用场景:
 *   - 项目级配置管理
 *   - 模式切换(YOLO、Plan 等)
 *   - 工具行为配置
 *
 * 边界:
 *   1. 基于统一设置存储(unifiedSettings)
 *   2. 优先级:项目级 > 全局级 > 默认值
 *   3. 提供类型安全的 getter/setter
 *
 * 流程:
 *   1. 读取合并后的设置
 *   2. 提供类型安全的 getter
 *   3. 通过 setter 更新设置
 *   4. 持久化到 settings.json
 */

import { type SettingsScope, type UnifiedSettings, readMergedSettings, updateSettings } from "./unifiedSettings";
import { MAX_SPAWN_DEPTH } from "../constants";

/** 项目级设置结构 */
export interface ProjectSettings {
  toolSearchEnabled?: boolean;
  autoFormatEnabled?: boolean;
  subAgentMaxSpawnDepth?: number;
  fileListDisplayMode?: "list" | "tree";
  yoloMode?: boolean;
  planMode?: boolean;
  vulnerabilityHuntingMode?: boolean;
  hybridCompressEnabled?: boolean;
  teamMode?: boolean;
}

export const DEFAULT_SUB_AGENT_MAX_SPAWN_DEPTH = MAX_SPAWN_DEPTH;

/** 设置缓存（避免高频调用时重复读取文件） */
let settingsCache: { data: ProjectSettings; ts: number } | null = null;
const SETTINGS_CACHE_TTL_MS = 100; // 缓存有效期 100ms

/** 加载合并设置(项目 > 全局)，带简易缓存 */
function loadSettings(): ProjectSettings {
  const now = Date.now();
  if (settingsCache && now - settingsCache.ts < SETTINGS_CACHE_TTL_MS) {
    return settingsCache.data;
  }
  const merged = readMergedSettings();

  const result: ProjectSettings = {
    autoFormatEnabled: merged.autoFormatEnabled,
    fileListDisplayMode: merged.fileListDisplayMode,
    hybridCompressEnabled: merged.hybridCompressEnabled,
    planMode: merged.planMode,
    subAgentMaxSpawnDepth: merged.subAgentMaxSpawnDepth,
    teamMode: merged.teamMode,
    toolSearchEnabled: merged.toolSearchEnabled,
    vulnerabilityHuntingMode: merged.vulnerabilityHuntingMode,
    yoloMode: merged.yoloMode,
  };
  settingsCache = { data: result, ts: now };
  return result;
}

/** 设置单个字段（写入后立即失效缓存） */
function setField<K extends keyof ProjectSettings>(
  key: K,
  value: ProjectSettings[K],
  scope: SettingsScope = "project",
): void {
  updateSettings(scope, (settings) => {
    (settings as UnifiedSettings)[key] = value as UnifiedSettings[K];
  });
  settingsCache = null; // 写入后立即失效缓存
}

function normalizeSubAgentMaxSpawnDepth(depth: unknown): number {
  if (typeof depth !== "number" || !Number.isFinite(depth)) {
    return DEFAULT_SUB_AGENT_MAX_SPAWN_DEPTH;
  }
  const normalizedDepth = Math.floor(depth);
  return normalizedDepth < 0 ? 0 : normalizedDepth;
}

// ─── Getter / Setter ──────────────────────────────────────────

export function getToolSearchEnabled(): boolean {
  return loadSettings().toolSearchEnabled ?? false;
}

export function setToolSearchEnabled(enabled: boolean): void {
  setField("toolSearchEnabled", enabled);
}

export function getAutoFormatEnabled(): boolean {
  return loadSettings().autoFormatEnabled ?? true;
}

export function setAutoFormatEnabled(enabled: boolean): void {
  setField("autoFormatEnabled", enabled);
}

export function getSubAgentMaxSpawnDepth(): number {
  return normalizeSubAgentMaxSpawnDepth(loadSettings().subAgentMaxSpawnDepth);
}

export function setSubAgentMaxSpawnDepth(depth: number): number {
  const normalizedDepth = normalizeSubAgentMaxSpawnDepth(depth);
  setField("subAgentMaxSpawnDepth", normalizedDepth);
  return normalizedDepth;
}

export function getFileListDisplayMode(): "list" | "tree" {
  return loadSettings().fileListDisplayMode ?? "list";
}

export function setFileListDisplayMode(mode: "list" | "tree"): void {
  setField("fileListDisplayMode", mode);
}

export function getYoloMode(): boolean {
  return loadSettings().yoloMode ?? false;
}

export function setYoloMode(enabled: boolean): void {
  setField("yoloMode", enabled);
}

export function getPlanMode(): boolean {
  return loadSettings().planMode ?? false;
}

export function setPlanMode(enabled: boolean): void {
  setField("planMode", enabled);
}

export function getVulnerabilityHuntingMode(): boolean {
  return loadSettings().vulnerabilityHuntingMode ?? false;
}

export function setVulnerabilityHuntingMode(enabled: boolean): void {
  setField("vulnerabilityHuntingMode", enabled);
}

export function getHybridCompressEnabled(): boolean {
  return loadSettings().hybridCompressEnabled ?? false;
}

export function setHybridCompressEnabled(enabled: boolean): void {
  setField("hybridCompressEnabled", enabled);
}

export function getTeamMode(): boolean {
  return loadSettings().teamMode ?? false;
}

export function setTeamMode(enabled: boolean): void {
  setField("teamMode", enabled);
}
