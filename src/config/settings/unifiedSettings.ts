/**
 * 统一设置存储 — 将分散的配置文件收敛到 settings.json。
 *
 * 职责:
 *   - 将分散的配置文件收敛到 settings.json
 *   - 支持 global、project、session 三种作用域
 *   - 提供配置合并和读写接口
 *
 * 模块功能:
 *   - readSettings: 读取指定作用域的设置
 *   - writeSettings: 写入完整设置对象
 *   - updateSettings: 便捷方法(加载 → 修改 → 保存)
 *   - readMergedSettings: 合并全局和项目设置
 *   - resetSessionSettings: 重置会话设置
 *   - getSettingsPath: 获取 settings.json 文件路径
 *   - UnifiedSettings: 统一设置接口
 *   - SettingsScope: 设置作用域类型
 *   - PersistentSettingsScope: 持久化设置作用域类型
 *
 * 使用场景:
 *   - 工具配置管理
 *   - 模式开关管理
 *   - 代码库配置
 *   - MCP 配置
 *   - 角色配置
 *
 * 边界:
 *   1. 配置目录: ~/.crab/ (全局), .crab/ (项目)
 *   2. 与 crab-cli 现有 config.ts 和 paths.ts 共存
 *   3. 统一配置文件: ~/.crab/settings.json (全局), .crab/settings.json (项目)
 *   4. 各模块通过本文件读写所需字段
 *
 * 流程:
 *   1. 确定作用域(global/project/session)
 *   2. 读取对应 settings.json
 *   3. 修改设置
 *   4. 保存回文件
 *   5. 合并时优先级:session > project > global
 */

import fs from "node:fs";
import path from "node:path";
import { getConfigDir } from "../paths/paths";
import { createLogger } from "@/core/logging/logger";
import { ensureDir } from "@/tool/shared/fs";

const log = createLogger("config:unified-settings");

/**
 * 统一设置的顶层结构。
 * 所有字段 optional，便于增量演进；使用方在读取时给出默认值。
 */
export interface UnifiedSettings {
  // ─── 工具相关 ───
  toolSearchEnabled?: boolean;
  autoFormatEnabled?: boolean;
  subAgentMaxSpawnDepth?: number;
  fileListDisplayMode?: "list" | "tree";
  toolDisplayMode?: "full" | "compact" | "hidden";

  // ─── 模式开关 ───
  yoloMode?: boolean;
  planMode?: boolean;
  vulnerabilityHuntingMode?: boolean;
  hybridCompressEnabled?: boolean;
  teamMode?: boolean;
  promptCaching?: {
    enabled?: boolean;
  };

  // ─── Rerank ───
  rerank?: {
    maxContextTokens?: number;
    maxDocumentRatio?: number;
  };

  // ─── 代码库 ───
  codebase?: {
    enabled?: boolean;
    enableAgentReview?: boolean;
    enableReranking?: boolean;
    batch?: {
      maxLines?: number;
      concurrency?: number;
    };
    chunking?: {
      maxLinesPerChunk?: number;
      minLinesPerChunk?: number;
      minCharsPerChunk?: number;
      overlapLines?: number;
    };
    embedding?: {
      type?: "jina" | "ollama" | "gemini" | "mistral";
      modelName?: string;
      baseUrl?: string;
      apiKey?: string;
      dimensions?: number;
    };
    reranking?: {
      modelName?: string;
      baseUrl?: string;
      apiKey?: string;
      contextLength?: number;
      topN?: number;
    };
  };

  // ─── 禁用工具/技能 ───
  disabledBuiltInServices?: string[];
  disabledMCPTools?: string[];
  optInMCPTools?: string[];
  disabledSkills?: string[];

  // ─── MCP 配置 ───
  mcpServers?: Record<string, unknown>;

  // ─── 角色配置 ───
  role?: {
    activeRoleId?: string;
    overrideRoleIds?: string[];
  };

  // ─── 敏感命令 ───
  sensitiveCommands?: {
    id: string;
    pattern: string;
    description: string;
    enabled: boolean;
    isPreset: boolean;
  }[];
}

export type PersistentSettingsScope = "project" | "global";
export type SettingsScope = PersistentSettingsScope | "session";

const SETTINGS_FILE_NAME = "settings.json";
let sessionSettings: UnifiedSettings = {};

/** 获取配置目录 */
function getCrabDir(scope: PersistentSettingsScope, workingDirectory?: string): string {
  if (scope === "global") {
    return getConfigDir();
  }
  return path.join(workingDirectory || process.cwd(), ".crab");
}

/** 获取 settings.json 文件路径 */
export function getSettingsPath(scope: PersistentSettingsScope, workingDirectory?: string): string {
  return path.join(getCrabDir(scope, workingDirectory), SETTINGS_FILE_NAME);
}

/**
 * 读取设置。文件不存在或解析失败时返回 {}。
 */
export function readSettings(scope: SettingsScope, workingDirectory?: string): UnifiedSettings {
  if (scope === "session") {
    return structuredClone(sessionSettings);
  }

  const filePath = getSettingsPath(scope, workingDirectory);
  try {
    if (!fs.existsSync(filePath)) {
      return {};
    }
    const content = fs.readFileSync(filePath, "utf8");
    if (!content.trim()) {
      return {};
    }
    const parsed = JSON.parse(content) as UnifiedSettings;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * 写入完整设置对象。
 *
 * @returns 写入是否成功（session 作用域始终返回 true）
 */
export function writeSettings(scope: SettingsScope, settings: UnifiedSettings, workingDirectory?: string): boolean {
  if (scope === "session") {
    sessionSettings = structuredClone(settings);
    return true;
  }

  try {
    const dir = getCrabDir(scope, workingDirectory);
    ensureDir(dir);
    const filePath = getSettingsPath(scope, workingDirectory);
    fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), "utf8");
    return true;
  } catch (error) {
    log.warn(`写入设置失败: ${String(error)}`);
    return false;
  }
}

/**
 * 便捷方法:加载 → 修改 → 保存。
 */
export function updateSettings(
  scope: SettingsScope,
  mutator: (settings: UnifiedSettings) => void,
  workingDirectory?: string,
): UnifiedSettings {
  const current = readSettings(scope, workingDirectory);
  mutator(current);
  writeSettings(scope, current, workingDirectory);
  return current;
}

/**
 * 合并全局和项目设置(项目级覆盖全局级)。
 */
export function readMergedSettings(workingDirectory?: string): UnifiedSettings {
  const globalSettings = readSettings("global");
  const projectSettings = readSettings("project", workingDirectory);
  const currentSessionSettings = readSettings("session");
  return mergeSettings(mergeSettings(globalSettings, projectSettings), currentSessionSettings);
}

function mergeSettings(base: UnifiedSettings, override: UnifiedSettings): UnifiedSettings {
  const result: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) {
      continue;
    }

    const current = result[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      result[key] = mergeSettings(current as UnifiedSettings, value as UnifiedSettings);
      continue;
    }

    result[key] = structuredClone(value);
  }

  return result as UnifiedSettings;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resetSessionSettings(): void {
  sessionSettings = {};
}
