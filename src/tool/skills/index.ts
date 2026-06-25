/**
 * Skills 工具 — 执行已安装的 Skill(技能/模板)。
 *
 * 职责:
 *   - 列出可用技能
 *   - 执行指定技能
 *   - 查看技能详情
 *   - 管理技能状态(启用/禁用)
 *
 * 模块功能:
 *   - skillsTool: Skills 工具定义
 *   - list/search: 列出或搜索技能
 *   - execute: 执行技能
 *   - info: 查看技能详情
 *   - reload: 重新加载技能
 *   - disable/enable: 禁用/启用技能
 *
 * 使用场景:
 *   - AI 需要执行预定义任务模板
 *   - 代码解释、审查、测试生成
 *   - 重构、文档生成、Bug 修复
 *
 * 边界:
 *   1. 权限:fs.read
 *   2. Skill 是预定义的任务模板
 *   3. 通过 SkillManager 统一管理
 *   4. 支持参数替换
 *   5. 内置多种常用技能
 *
 * 流程:
 *   1. 接收操作参数
 *   2. 初始化 SkillManager(首次)
 *   3. 根据 action 执行对应操作
 *   4. 返回操作结果
 */
import { z } from "zod";
import { defineTool } from "@/tool/types";
import { createLogger } from "@/core/logging/logger";
import { recommendSkillsForContext, resolveExplicitSkillReference } from "@/extension/skill";

const log = createLogger("tool:skills");

/** 技能工具：执行预定义的技能模板，支持搜索、推荐和执行 */
export const skillsTool = defineTool({
  description:
    "执行预定义的技能(Skill)。技能是封装好的任务模板，" +
    "包含优化的 prompt 和工具配置。支持上下文推荐、搜索、查看可用技能和执行指定技能。" +
    "内置:explain-code、review-code、write-test、refactor、generate-docs、fix-bug、customize-crab。",
  execute: async ({ action, query, context, limit, skillName, input, params }) => {
    try {
      const { skillManager } = await import("@/extension/skill");
      // 自动初始化(首次调用时)
      if (skillManager.size === 0) {
        await skillManager.init();
      }

      switch (action) {
        case "list": {
          const skills = skillManager.listVisible().map((s) => ({
            category: s.category,
            description: s.description ?? "",
            name: s.name,
            source: s.source,
          }));
          return { action: "list", skills, success: true, total: skills.length };
        }
        case "recommend": {
          const userMessage = context?.trim() || query?.trim();
          if (!userMessage) {
            return { action: "recommend", error: "需要 context 或 query", success: false };
          }
          const explicit = resolveExplicitSkillReference(userMessage);
          const recommendations = recommendSkillsForContext({
            limit: limit ?? 6,
            userMessage,
          });
          return {
            action: "recommend",
            context: userMessage,
            explicitSkill: explicit,
            message:
              explicit.status === "unique"
                ? `检测到显式 Skill 引用: ${explicit.skillName}，可直接调用 skills info/execute。`
                : "已根据当前上下文推荐 Skills；请按 recommendedAction 自动调用 info 或 execute。",
            recommendations,
            success: true,
            total: recommendations.length,
          };
        }
        case "search": {
          if (!query?.trim()) {
            return { action: "search", error: "需要 query", success: false };
          }
          const results = skillManager.searchDetailed(query, limit ?? 10);
          const skills = results.map((result) => {
            const s = result.skill;
            return {
              avoidWhen: s.avoidWhen,
              category: s.category,
              dependsOn: s.dependsOn,
              description: s.description ?? "",
              hasContent: s.content.length > 0,
              matchReasons: result.matchReasons,
              matchScore: result.score,
              name: s.name,
              nextStep: result.nextStep,
              order: result.order,
              parameters: s.parameters,
              phase: result.phase,
              recommendedAction: result.recommendedAction,
              source: s.source,
              tools: s.tools,
              trigger: s.trigger,
              whenToUse: s.whenToUse,
            };
          });
          const recommendedOrder = [...skills]
            .toSorted((a, b) => a.order - b.order || b.matchScore - a.matchScore)
            .map((s) => s.name);
          return {
            action: "search",
            message:
              skills.length > 0
                ? "已发现匹配的 Skills；请根据 matchReasons、phase、recommendedOrder 和 recommendedAction 自动选择并调用。"
                : "未发现匹配的 Skills，可尝试更通用的 query 或使用 list 查看全部。",
            query,
            recommendedOrder,
            selectionPolicy: [
              "优先选择 matchScore 高、phase 符合当前任务阶段的 Skill。",
              "多个 Skill 同时适用时，按 recommendedOrder 顺序处理:plan -> analyze -> implement -> verify -> document -> operate。",
              "recommendedAction=info 时先查看完整指令和参数；recommendedAction=execute 时可直接执行。",
              "不要让用户手动选择，除非搜索结果不足以判断或存在明显业务歧义。",
            ],
            skills,
            success: true,
            total: skills.length,
          };
        }
        case "reload": {
          await skillManager.reload();
          const skills = skillManager.listVisible().map((s) => ({
            category: s.category,
            description: s.description ?? "",
            name: s.name,
          }));
          return {
            action: "reload",
            message: `已重新加载，共 ${skills.length} 个技能`,
            skills,
            success: true,
            total: skills.length,
          };
        }
        case "info": {
          if (!skillName) {
            return { error: "需要 skillName", success: false };
          }
          const skill = skillManager.get(skillName);
          if (!skill) {
            return { error: `技能不存在: ${skillName}`, success: false };
          }
          return {
            action: "info",
            skill: {
              category: skill.category,
              description: skill.description,
              hasContent: skill.content.length > 0,
              location: skill.location,
              name: skill.name,
              parameters: skill.parameters,
              prompt: skill.content,
              source: skill.source,
              tools: skill.tools,
            },
            success: true,
          };
        }
        case "execute": {
          if (!skillName) {
            return { error: "需要 skillName", success: false };
          }
          // 自动将 input 映射到缺失的必填 string 参数
          const skill = skillManager.get(skillName);
          let mergedParams = params;
          if (skill?.parameters && input) {
            const missing = skill.parameters.find((p) => p.required && p.type === "string" && !params?.[p.name]);
            if (missing) {
              mergedParams = { ...params, [missing.name]: input };
            }
          }
          const result = await skillManager.run(skillName, mergedParams, input);
          if (!result.ok) {
            return { action: "execute", error: result.error, success: false };
          }
          log.info(`执行技能: ${skillName}`);
          return {
            action: "execute",
            message: `技能 "${skillName}" 已准备就绪。Prompt 将传递给 AI 执行。`,
            prompt: result.prompt,
            skillName,
            success: true,
          };
        }
        case "disable": {
          if (!skillName) {
            return { error: "需要 skillName", success: false };
          }
          const ok = skillManager.disable(skillName);
          if (!ok) {
            return { error: `技能不存在: ${skillName}`, success: false };
          }
          return { action: "disable", message: `技能 "${skillName}" 已禁用`, skillName, success: true };
        }
        case "enable": {
          if (!skillName) {
            return { error: "需要 skillName", success: false };
          }
          const ok = skillManager.enable(skillName);
          if (!ok) {
            return { error: `技能未被禁用: ${skillName}`, success: false };
          }
          return {
            action: "enable",
            message: `技能 "${skillName}" 已启用(需要 reload 恢复)`,
            skillName,
            success: true,
          };
        }
        default: {
          return { error: `未知操作: ${action}`, success: false };
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error(`Skills 操作失败: ${action}: ${msg}`);
      return { error: msg, success: false };
    }
  },
  name: "skills",
  parameters: z.object({
    action: z
      .enum(["list", "recommend", "search", "execute", "info", "reload", "disable", "enable"])
      .describe(
        "操作:list(列出所有)/recommend(基于上下文推荐)/search(按需求搜索)/execute(执行)/info(查看详情)/reload(重新加载技能目录)/disable(禁用技能)/enable(启用技能)",
      ),
    context: z.string().optional().describe("当前任务上下文(recommend 时使用，可包含用户需求、阶段、最近任务摘要)"),
    input: z.string().optional().describe("技能输入内容(execute 时追加到 prompt 末尾)"),
    limit: z.number().int().positive().max(50).optional().describe("搜索返回数量上限(默认 10)"),
    params: z.record(z.string(), z.unknown()).optional().describe("技能参数(替换模板中的占位符)"),
    query: z.string().optional().describe("搜索查询(search 时使用，可按名称、描述、分类、触发词或内容摘要匹配)"),
    skillName: z.string().optional().describe("技能名称(execute/info 时必填)"),
  }),
  permission: "fs.read",
  builtin: true,
});
