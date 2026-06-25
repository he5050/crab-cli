/**
 * [Skills 系统统一入口]
 *
 * 职责:
 *   - 作为 Skills 系统的顶层模块入口
 *   - 统一导出 Skill 管理器、发现器、执行器和推荐器
 *   - 提供便捷的初始化和查询接口
 *
 * 子模块(实现在 @/extension/skill):
 *   - manager/      SkillManager 加载、注册、查找、执行
 *   - discovery/    从文件系统扫描 SKILL.md 并解析
 *   - runner/       Skill 执行器(prompt 组装 + 参数替换)
 *   - builtin/      内置 Skill 集合
 *   - generator/    AI 生成 Skill 草稿
 *   - recommendation/ 基于上下文的 Skill 推荐
 *
 * 使用场景:
 *   - 会话启动时初始化 Skill 系统
 *   - /skill 命令执行指定 Skill
 *   - 系统提示词注入 Skill 索引
 *   - AI 工具调用 skills search/execute
 *
 * 边界:
 *   1. 本文件仅作为 re-export 入口，不含实现逻辑
 *   2. 实际实现在 @/extension/skill 子模块中
 *   3. 支持 ~/.crab/skills/ 全局和 .crab/skills/ 项目级 Skill
 *   4. 兼容 Claude Code (.claude/skills/) 和 codex (.agents/skills/) 格式
 */

// ─── 管理器 ──────────────────────────────────────────────
export { skillManager, createSkillManager, inferSkillPhase } from "@/extension/skill/manager";
export type { SkillSearchResult } from "@/extension/skill/manager";

// ─── 发现器 ──────────────────────────────────────────────
export { discoverSkills, parseSkillFile } from "@/extension/skill/discovery";

// ─── 执行器 ──────────────────────────────────────────────
export { SkillRunner } from "@/extension/skill/runner";
export type { ToolRegistryView } from "@/extension/skill/runner";

// ─── 内置 Skill ──────────────────────────────────────────
export { builtinSkills } from "@/extension/skill/builtin";

// ─── 类型定义 ────────────────────────────────────────────
export { skillFrontmatterSchema } from "@/extension/skill/types";
export type {
  SkillConfig,
  SkillDefinition,
  SkillExecutionResult,
  SkillFrontmatter,
  SkillParameter,
  SkillSource,
} from "@/extension/skill/types";

// ─── 生成器 ──────────────────────────────────────────────
export { generateSkillDraftWithAI, writeSkillDraft } from "@/extension/skill/generator";
export type {
  GeneratedSkillDraft,
  GenerateSkillDraftOptions,
  WriteSkillDraftOptions,
  WriteSkillDraftResult,
} from "@/extension/skill/generator";

// ─── 推荐器 ──────────────────────────────────────────────
export {
  recommendSkillsForContext,
  resolveExplicitSkillReference,
  buildSkillIndexReminder,
  listSkillIndex,
  setSkillSearchProvider,
  type SkillSearchProvider,
} from "@/extension/skill/recommendation";
export type {
  ExplicitSkillResolution,
  SkillIndexEntry,
  SkillRecommendation,
  SkillRecommendationContext,
} from "@/extension/skill/recommendation";
