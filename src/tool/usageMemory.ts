import fs from "node:fs";
import path from "node:path";
import { getConfigDir, getProjectCrabDir } from "@/config";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("tool:usage-memory");
const USAGE_MEMORY_FILE = "usage-memory.json";
const MAX_RECORDS = 500;
const KEYWORD_LIMIT = 12;

/** 使用记忆条目的类型分类 */
export type UsageMemoryKind = "skill" | "external_tool";
/** 使用记忆的来源渠道 */
export type UsageMemorySource = "recommend" | "search" | "explicit" | "direct_call" | "info" | "execute";

/** 单条使用记忆记录，包含使用统计与来源信息 */
export interface UsageMemoryRecord {
  kind: UsageMemoryKind;
  name: string;
  scenario: string;
  intentKeywords: string[];
  source: UsageMemorySource;
  successCount: number;
  failureCount: number;
  lastUsedAt: number;
  firstUsedAt: number;
  projectDir?: string;
  phase?: string;
  permissionsPassed?: boolean;
}

/** 使用记忆持久化存储结构 */
export interface UsageMemoryStore {
  version: 1;
  records: UsageMemoryRecord[];
}

/** 记录使用记忆的输入参数 */
export interface RecordUsageInput {
  kind: UsageMemoryKind;
  name: string;
  scenario?: string;
  source: UsageMemorySource;
  success: boolean;
  projectDir?: string;
  phase?: string;
  permissionsPassed?: boolean;
}

/** 使用记忆推荐加权分数及原因 */
export interface UsageBoost {
  score: number;
  reasons: string[];
}

/** 带推荐加权的使用记忆候选项 */
export interface UsageMemoryCandidate {
  name: string;
  boost: UsageBoost;
}

function getProjectUsageMemoryPath(projectDir = process.cwd()): string {
  return path.join(getProjectCrabDir(projectDir), USAGE_MEMORY_FILE);
}

function getGlobalUsageMemoryPath(): string {
  return path.join(getConfigDir(), USAGE_MEMORY_FILE);
}

function emptyStore(): UsageMemoryStore {
  return { records: [], version: 1 };
}

/** 运行时类型守卫：验证对象是否为合法的 UsageMemoryStore 结构 */
function isUsageMemoryStore(value: unknown): value is { version: number; records: unknown[] } {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return obj.version === 1 && Array.isArray(obj.records);
}

function readStore(filePath: string): UsageMemoryStore {
  try {
    if (!fs.existsSync(filePath)) {
      return emptyStore();
    }
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) {
      return emptyStore();
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isUsageMemoryStore(parsed)) {
      return emptyStore();
    }
    return {
      records: parsed.records.filter(isUsageMemoryRecord).slice(0, MAX_RECORDS),
      version: 1,
    };
  } catch (error) {
    log.warn(`读取 usage memory 失败: ${error instanceof Error ? error.message : String(error)}`);
    return emptyStore();
  }
}

function writeStore(filePath: string, store: UsageMemoryStore): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf8");
  } catch (error) {
    log.warn(`写入 usage memory 失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isUsageMemoryRecord(value: unknown): value is UsageMemoryRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as UsageMemoryRecord;
  return (
    (item.kind === "skill" || item.kind === "external_tool") &&
    typeof item.name === "string" &&
    typeof item.scenario === "string" &&
    Array.isArray(item.intentKeywords) &&
    typeof item.successCount === "number" &&
    typeof item.failureCount === "number" &&
    typeof item.lastUsedAt === "number" &&
    typeof item.firstUsedAt === "number"
  );
}

function sanitizeScenario(input?: string): string {
  const value = (input ?? "").replace(/\s+/g, " ").trim();
  if (!value) {
    return "";
  }
  return value.slice(0, 120);
}

/** 从文本中提取意图关键词，用于记忆匹配
 * @param input 输入文本
 * @returns 去重后的关键词数组，最多返回 KEYWORD_LIMIT 个
 */
/** extractIntentKeywords 的实现 */
export function extractIntentKeywords(input?: string): string[] {
  const text = sanitizeScenario(input).toLowerCase();
  if (!text) {
    return [];
  }
  const raw = text.match(/[\p{Script=Han}a-z0-9._-]{2,}/gu) ?? [];
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "this",
    "that",
    "需要",
    "使用",
    "调用",
    "工具",
    "技能",
    "当前",
    "这个",
  ]);
  const keywords: string[] = [];
  for (const item of raw) {
    if (stop.has(item)) {
      continue;
    }
    if (!keywords.includes(item)) {
      keywords.push(item);
    }
    if (keywords.length >= KEYWORD_LIMIT) {
      break;
    }
  }
  return keywords;
}

function recordKey(record: Pick<UsageMemoryRecord, "kind" | "name" | "intentKeywords">): string {
  const keywordKey = record.intentKeywords.slice(0, 6).join("|");
  return `${record.kind}:${record.name}:${keywordKey}`;
}

function normalizeProjectDir(projectDir?: string): string | undefined {
  return projectDir ? path.resolve(projectDir) : undefined;
}

/** 记录一条工具/技能使用记忆，更新成功/失败计数并持久化
 * @param input 使用记录输入参数
 * @returns 更新后的使用记忆记录
 */
/** recordUsageMemory 的实现 */
export function recordUsageMemory(input: RecordUsageInput): UsageMemoryRecord {
  const projectDir = normalizeProjectDir(input.projectDir ?? process.cwd());
  const scenario = sanitizeScenario(input.scenario);
  const intentKeywords = extractIntentKeywords(scenario || input.name);
  const filePath = getProjectUsageMemoryPath(projectDir);
  const store = readStore(filePath);
  const now = Date.now();
  const key = recordKey({ intentKeywords, kind: input.kind, name: input.name });
  let record = store.records.find((item) => recordKey(item) === key);

  if (!record) {
    record = {
      failureCount: 0,
      firstUsedAt: now,
      intentKeywords,
      kind: input.kind,
      lastUsedAt: now,
      name: input.name,
      permissionsPassed: input.permissionsPassed,
      phase: input.phase,
      projectDir,
      scenario,
      source: input.source,
      successCount: 0,
    };
    store.records.push(record);
  }

  record.scenario = scenario || record.scenario;
  record.source = input.source;
  record.lastUsedAt = now;
  record.phase = input.phase ?? record.phase;
  record.permissionsPassed = input.permissionsPassed ?? record.permissionsPassed;
  if (input.success) {
    record.successCount += 1;
  } else {
    record.failureCount += 1;
  }

  store.records = store.records.toSorted((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, MAX_RECORDS);
  writeStore(filePath, store);
  return record;
}

/** 读取项目级与全局使用记忆，按最近使用时间降序返回去重结果
 * @param projectDir 项目目录路径
 * @returns 去重排序后的使用记忆记录数组
 */
/** readUsageMemory 的实现 */
export function readUsageMemory(projectDir = process.cwd()): UsageMemoryRecord[] {
  const projectPath = getProjectUsageMemoryPath(projectDir);
  const globalPath = getGlobalUsageMemoryPath();
  const records = [...readStore(globalPath).records, ...readStore(projectPath).records];
  const deduped = new Map<string, UsageMemoryRecord>();
  for (const record of records) {
    const key = recordKey(record);
    const existing = deduped.get(key);
    if (!existing || record.lastUsedAt > existing.lastUsedAt) {
      deduped.set(key, record);
    }
  }
  return [...deduped.values()].toSorted((a, b) => b.lastUsedAt - a.lastUsedAt);
}

/** 根据使用记忆计算某工具/技能的推荐加权分数
 * @param kind 记忆类型（skill 或 external_tool）
 * @param name 工具/技能名称
 * @param scenario 当前场景描述，用于关键词匹配
 * @param projectDir 项目目录路径
 * @returns 推荐分数及原因
 */
/** getUsageBoost 的实现 */
export function getUsageBoost(
  kind: UsageMemoryKind,
  name: string,
  scenario?: string,
  projectDir = process.cwd(),
): UsageBoost {
  const queryKeywords = extractIntentKeywords(scenario);
  if (queryKeywords.length === 0) {
    return { reasons: [], score: 0 };
  }

  let score = 0;
  const reasons: string[] = [];
  for (const record of readUsageMemory(projectDir)) {
    if (record.kind !== kind || record.name !== name) {
      continue;
    }
    const overlap = record.intentKeywords.filter((keyword) =>
      queryKeywords.some((queryKeyword) => keywordMatches(keyword, queryKeyword)),
    );
    if (overlap.length === 0) {
      continue;
    }
    const successSignal = Math.max(0, record.successCount * sourceWeight(record.source) - record.failureCount * 2);
    const localBonus = record.projectDir && path.resolve(projectDir) === path.resolve(record.projectDir) ? 2 : 0;
    const failurePenalty = record.failureCount * 10 + (record.permissionsPassed === false ? 8 : 0);
    const boost = Math.min(40, overlap.length * 8 + successSignal * 4 + localBonus - failurePenalty);
    if (boost > 0) {
      score += boost;
      reasons.push(`usage memory: ${overlap.slice(0, 4).join(", ")}`);
    }
  }
  return { reasons: [...new Set(reasons)].slice(0, 3), score: Math.min(60, score) };
}

/** 获取指定类型的所有使用记忆候选项，按推荐分数降序排列
 * @param kind 记忆类型（skill 或 external_tool）
 * @param scenario 当前场景描述
 * @param projectDir 项目目录路径
 * @returns 推荐分数大于零的候选项数组
 */
/** getUsageCandidates 的实现 */
export function getUsageCandidates(
  kind: UsageMemoryKind,
  scenario?: string,
  projectDir = process.cwd(),
): UsageMemoryCandidate[] {
  const names = new Set(
    readUsageMemory(projectDir)
      .filter((record) => record.kind === kind)
      .map((record) => record.name),
  );
  return [...names]
    .map((name) => ({ boost: getUsageBoost(kind, name, scenario, projectDir), name }))
    .filter((candidate) => candidate.boost.score > 0)
    .toSorted((a, b) => b.boost.score - a.boost.score || a.name.localeCompare(b.name));
}

function sourceWeight(source: UsageMemorySource): number {
  switch (source) {
    case "direct_call":
    case "execute": {
      return 1;
    }
    case "explicit": {
      return 0.75;
    }
    case "info": {
      return 0.35;
    }
    case "recommend":
    case "search": {
      return 0.15;
    }
  }
}

function keywordMatches(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }
  return a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a));
}

/** 清除指定项目的使用记忆文件，仅用于测试 */
export function clearUsageMemoryForTest(projectDir = process.cwd()): void {
  fs.rmSync(getProjectUsageMemoryPath(projectDir), { force: true });
}

/** 测试专用：暴露内部路径获取函数，供单元测试访问 */
export const __usageMemoryPathsForTest = {
  getGlobalUsageMemoryPath,
  getProjectUsageMemoryPath,
};
