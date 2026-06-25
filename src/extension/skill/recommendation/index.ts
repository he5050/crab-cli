/**
 * Skill 推荐 — 基于任务上下文匹配最合适的可复用 Skill。
 *
 * 职责:
 *   - 构建 Skill 索引(用于快速过滤)
 *   - 基于关键词/标签/阶段/使用记忆进行多维度匹配与打分
 *   - 输出按推荐顺序排列的 Skill 候选
 *
 * 模块功能:
 *   - SkillIndexEntry: Skill 索引项
 *   - buildSkillIndex: 构建 Skill 索引
 *   - recommendSkills: 任务推荐入口
 *   - scoreSkill: 单个 Skill 评分
 *
 * 使用场景:
 *   - 系统提示词构建时向模型推荐可用 Skill
 *   - Skills recommend/search 工具调用
 *
 * 边界:
 *   1. 推荐不直接执行 Skill，仅返回候选与分数
 *   2. 不修改 Skill 注册表
 */
import type { SkillDefinition } from "../types";
import { type SkillSearchResult, inferSkillPhase, skillManager } from "../manager";

/**
 * Skill 搜索提供者接口 — 解耦 recommendation 与 skillManager 单例。
 *
 * 推荐模块仅依赖此接口，不直接引用 skillManager。
 * 默认使用 skillManager 实例；测试时可通过 setSkillSearchProvider 注入 mock。
 */
export interface SkillSearchProvider {
  searchDetailed(query: string, limit?: number): SkillSearchResult[];
  listVisible(): SkillDefinition[];
  readonly size: number;
}

/** 模块级搜索提供者（默认绑定 skillManager，测试时可替换） */
let searchProvider: SkillSearchProvider = skillManager;

/**
 * 注入 SkillSearchProvider（供测试使用）。
 * 不传或传 null 时回退到默认 skillManager。
 */
export function setSkillSearchProvider(provider: SkillSearchProvider | null): void {
  searchProvider = provider ?? skillManager;
}

/** 获取当前搜索提供者 */
function getSearchProvider(): SkillSearchProvider {
  return searchProvider;
}

export interface SkillIndexEntry {
  name: string;
  description: string;
  category: string;
  trigger?: string;
  phase: SkillSearchResult["phase"];
  source: SkillDefinition["source"];
}

export interface SkillRecommendation {
  name: string;
  description: string;
  category: string;
  phase: SkillSearchResult["phase"];
  source: SkillDefinition["source"];
  matchScore: number;
  matchReasons: string[];
  recommendedAction: SkillSearchResult["recommendedAction"];
  nextStep: string;
}

export interface ExplicitSkillResolution {
  status: "unique" | "ambiguous" | "not_found";
  skillName?: string;
  candidates?: string[];
}

export interface SkillRecommendationContext {
  userMessage?: string;
  mode?: string;
  phaseHint?: string;
  recentTaskSummary?: string;
  activeRole?: string;
  loadedSkills?: string[];
  limit?: number;
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function contextQuery(ctx: SkillRecommendationContext): string {
  const raw = [ctx.userMessage, ctx.phaseHint, ctx.recentTaskSummary, ctx.mode, ctx.activeRole]
    .filter(Boolean)
    .join(" ")
    .trim();
  return [raw, expandIntentKeywords(raw)].filter(Boolean).join(" ").trim();
}

function expandIntentKeywords(input: string): string {
  const lower = input.toLowerCase();
  const expansions: string[] = [];
  const add = (value: string) => {
    if (!expansions.includes(value)) {
      expansions.push(value);
    }
  };

  if (/(验证|验收|核验|确认|检查|是否完成|通过|收口|闭环|verify|validate)/i.test(input)) {
    add("verify validate audit review work completion gsd-verify-work gsd-validate-phase");
  }
  if (/(执行|实施|推进|落地|execute|implement)/i.test(input) && /(阶段|phase)/i.test(input)) {
    add("execute phase gsd-execute-phase");
  }
  if (/(backlog|待办|积压)/i.test(input) && /(review|审查|复盘|检查)/i.test(input)) {
    add("review backlog gsd-review-backlog");
  }
  if (/(code review|代码审查|review 反馈|审查反馈|修复反馈|fix review)/i.test(input)) {
    add("code review fix gsd-code-review-fix");
  }
  if (/(计划|规划|拆解|plan)/i.test(input) && /(阶段|phase)/i.test(input)) {
    add("plan phase gsd-plan-phase");
  }
  if (/(文档|说明|总结|docs|document)/i.test(input)) {
    add("docs document summary gsd-docs-update");
  }
  if (/(测试|test|单测|用例)/i.test(input)) {
    add("test verify gsd-add-tests write-test");
  }
  if (lower.includes("p1-7") || lower.includes("skill loading") || lower.includes("progressive skill")) {
    add("verify work validate phase skill loading gsd-verify-work");
  }

  return expansions.join(" ");
}

function toIndexEntry(skill: SkillDefinition): SkillIndexEntry {
  return {
    category: skill.category,
    description: skill.description ?? "",
    name: skill.name,
    phase: skill.phase ?? inferSkillPhase(skill),
    source: skill.source,
    trigger: skill.trigger,
  };
}

export function listSkillIndex(limit = 20): SkillIndexEntry[] {
  return [...getSearchProvider().listVisible()]
    .toSorted((a, b) => {
      const sourceOrder = sourceRank(a.source) - sourceRank(b.source);
      if (sourceOrder !== 0) {
        return sourceOrder;
      }
      return a.name.localeCompare(b.name);
    })
    .slice(0, Math.max(1, limit))
    .map(toIndexEntry);
}

function sourceRank(source: SkillDefinition["source"]): number {
  switch (source) {
    case "project": {
      return 0;
    }
    case "global": {
      return 1;
    }
    case "builtin": {
      return 2;
    }
    case "claude-compat": {
      return 3;
    }
    case "codex-compat": {
      return 4;
    }
  }
}

export function recommendSkillsForContext(ctx: SkillRecommendationContext): SkillRecommendation[] {
  const query = contextQuery(ctx);
  if (!query) {
    return [];
  }
  const loaded = new Set(ctx.loadedSkills ?? []);
  return getSearchProvider()
    .searchDetailed(query, ctx.limit ?? 6)
    .filter((result) => !loaded.has(result.skill.name))
    .map((result) => ({
      category: result.skill.category,
      description: result.skill.description ?? "",
      matchReasons: result.matchReasons,
      matchScore: result.score,
      name: result.skill.name,
      nextStep: result.nextStep,
      phase: result.phase,
      recommendedAction: result.recommendedAction,
      source: result.skill.source,
    }));
}

export function resolveExplicitSkillReference(input: string): ExplicitSkillResolution {
  const visible = getSearchProvider().listVisible();
  const normalized = input.trim().toLowerCase();
  if (!normalized) {
    return { status: "not_found" };
  }

  const exact = visible.find((skill) => skill.name.toLowerCase() === normalized);
  if (exact) {
    return { skillName: exact.name, status: "unique" };
  }

  const explicitPatterns = [
    /\/skill:([a-z0-9._-]+)/i,
    /skill:\/\/([a-z0-9._-]+)/i,
    /\buse\s+([a-z0-9._-]+)\s+skill\b/i,
    /\b用\s*([a-z0-9._-]+)\s*(?:skill|技能)?/i,
  ];
  for (const pattern of explicitPatterns) {
    const match = input.match(pattern);
    const candidate = match?.[1]?.toLowerCase();
    if (!candidate) {
      continue;
    }
    const found = visible.find((skill) => skill.name.toLowerCase() === candidate);
    if (found) {
      return { skillName: found.name, status: "unique" };
    }
  }

  const candidates = visible
    .filter((skill) => new RegExp(`(^|\\s|[:/])${escapeForRegex(skill.name)}($|\\s)`, "i").test(input))
    .map((skill) => skill.name);
  if (candidates.length === 1) {
    return { skillName: candidates[0], status: "unique" };
  }
  if (candidates.length > 1) {
    return { candidates, status: "ambiguous" };
  }
  return { status: "not_found" };
}

export function buildSkillIndexReminder(ctx: SkillRecommendationContext = {}): string {
  if (getSearchProvider().size === 0) {
    return "";
  }
  const recommendations = recommendSkillsForContext(ctx);
  const index = listSkillIndex(Math.max(1, ctx.limit ?? 8));
  const lines: string[] = ["Skill 轻量索引:Skill 正文未默认加载；需要完整指令时调用 skills info/execute。"];
  if (recommendations.length > 0) {
    lines.push("当前上下文推荐 Skills:");
    for (const item of recommendations) {
      lines.push(
        `- ${item.name} [${item.phase}/${item.recommendedAction}, score=${item.matchScore}]: ${item.description}`,
      );
    }
  } else if (index.length > 0) {
    lines.push("可发现 Skills 示例:");
    for (const item of index) {
      lines.push(`- ${item.name} [${item.phase}]: ${item.description}`);
    }
  }
  lines.push(
    "选择规则:显式 /skill:name 或 skill://name 直接加载；否则按当前需求调用 skills search 精排，再按 recommendedAction 调用 info 或 execute。",
  );
  return lines.join("\n");
}
