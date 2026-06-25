/**
 * Skill 类型统一出口。
 *
 * 本文件集中 re-export Skill 系统的所有公共类型，
 * 供外部模块（UI、tool、conversation）按需导入。
 *
 * 核心类型定义在 `types/index.ts`（含 Zod Schema），
 * 其他模块的类型通过 re-export 聚合到此文件。
 *
 * 使用方式:
 *   import type { SkillDefinition } from "@extension/skill/type";
 */
export type {
  SkillConfig,
  SkillDefinition,
  SkillExecutionResult,
  SkillFrontmatter,
  SkillParameter,
  SkillSource,
} from "./types";
export type { SkillSearchResult } from "./manager";
export type { ToolRegistryView } from "./runner";
export type {
  GeneratedSkillDraft,
  GenerateSkillDraftOptions,
  WriteSkillDraftOptions,
  WriteSkillDraftResult,
} from "./generator";
export type {
  ExplicitSkillResolution,
  SkillIndexEntry,
  SkillRecommendation,
  SkillRecommendationContext,
} from "./recommendation";
