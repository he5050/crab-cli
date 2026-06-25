/**
 * Skill API 路由 — 技能管理。
 *
 * 端点:
 *   GET /api/skills       — 技能列表
 *   GET /api/skills/:name — 技能详情
 */
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { notFoundResponse, ErrorSchema } from "./index";

const SkillSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  category: z.string().optional(),
  source: z.string().optional(),
  hidden: z.boolean().optional(),
  file: z.string().optional(),
});

const SkillListResponseSchema = z.object({
  skills: z.array(SkillSchema),
  total: z.number(),
});

// ─── 路由定义 ───────────────────────────────────────────────

const listSkillsRoute = createRoute({
  method: "get",
  path: "/skills",
  tags: ["Skill"],
  summary: "技能列表",
  description: "获取所有已注册的技能列表(排除隐藏技能)",
  request: {
    query: z.object({
      category: z.string().optional().describe("按分类过滤"),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: SkillListResponseSchema } },
      description: "技能列表",
    },
  },
});

const getSkillRoute = createRoute({
  method: "get",
  path: "/skills/{name}",
  tags: ["Skill"],
  summary: "技能详情",
  request: {
    params: z.object({ name: z.string() }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: SkillSchema } },
      description: "技能详情",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "技能不存在",
    },
  },
});

// ─── 路由处理 ───────────────────────────────────────────────

export const skillRoutes = new OpenAPIHono();

skillRoutes.openapi(listSkillsRoute, async (c) => {
  const { skillManager } = await import("@skills");
  const { category } = c.req.valid("query");
  const skills = skillManager.listVisible(category);
  return c.json({ skills, total: skills.length }, 200);
});

skillRoutes.openapi(getSkillRoute, async (c) => {
  const { skillManager } = await import("@skills");
  const { name } = c.req.valid("param");
  const allSkills = skillManager.list();
  const skill = allSkills.find((s) => s.name === name);
  if (!skill) {
    return notFoundResponse("技能不存在");
  }
  return c.json(skill, 200);
});
