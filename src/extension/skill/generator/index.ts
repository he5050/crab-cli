/**
 * AI Skill 生成器。
 *
 * 职责:
 *   - 调用 LLM 生成 Skill 草稿
 *   - 解析和校验 AI 输出
 *   - 将草稿写入项目级或全局 Skill 目录
 */
import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import type { ModelMessage } from "ai";
import type { AppConfigSchema } from "@/schema/config";
import { completeLlm } from "@/api";
import { parseSkillFile } from "../discovery";
import { UserError } from "@/core/errors/appError";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("skills:generator");

export interface GeneratedSkillDraft {
  name: string;
  description: string;
  category: string;
  content: string;
  reference?: string;
  examples?: string;
}

export interface GenerateSkillDraftOptions {
  nameHint?: string;
  category?: string;
  complete?: typeof completeLlm;
}

export interface WriteSkillDraftOptions {
  projectDir?: string;
  scope?: "project" | "global";
  overwrite?: boolean;
}

export interface WriteSkillDraftResult {
  skillName: string;
  skillDir: string;
  skillFile: string;
  files: string[];
}

const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const ALLOWED_EXTRA_FILES = new Set(["reference.md", "examples.md"]);

/** LLM 调用最大重试次数 */
const LLM_MAX_RETRIES = 2;

const defaultSkillGeneratorDeps = {
  completeLlm,
};

let skillGeneratorDeps = { ...defaultSkillGeneratorDeps };

export function setGeneratorDepsForTesting(overrides: Partial<typeof skillGeneratorDeps>): void {
  skillGeneratorDeps = { ...skillGeneratorDeps, ...overrides };
}

export function resetGeneratorDepsForTesting(): void {
  skillGeneratorDeps = { ...defaultSkillGeneratorDeps };
}

export async function generateSkillDraftWithAI(
  requirement: string,
  config: AppConfigSchema,
  options: GenerateSkillDraftOptions = {},
): Promise<GeneratedSkillDraft> {
  const normalizedRequirement = requirement.trim();
  if (!normalizedRequirement) {
    throw new UserError("USER-201", "Skill requirement is required", {
      context: { module: "skillGenerator" },
    });
  }

  const messages: ModelMessage[] = [
    {
      content: [
        "你为 Crab CLI 生成 Skill。",
        "仅返回 JSON，不要 markdown 代码块。",
        "JSON Schema 如下:",
        '{"name":"kebab-case","description":"简短描述","category":"general|code|test|docs|debug|deploy","content":"SKILL.md 正文","reference":"可选 markdown","examples":"可选 markdown"}',
        "不要生成可执行脚本、Shell 命令、凭据或危险自动化操作。",
        "content 字段必须足够详细，可直接作为 SKILL.md 正文使用。",
      ].join("\n"),
      role: "system",
    },
    {
      content: [
        `Requirement: ${normalizedRequirement}`,
        options.nameHint ? `Preferred name: ${options.nameHint}` : "",
        options.category ? `Preferred category: ${options.category}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      role: "user",
    },
  ];

  const complete = options.complete ?? skillGeneratorDeps.completeLlm;

  // 带重试的 LLM 调用（网络超时或服务不可用时自动重试）
  let raw: string | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt <= LLM_MAX_RETRIES; attempt++) {
    try {
      const result = await complete(config, messages, {
        maxTokens: 1800,
        temperature: 0.2,
      });
      raw = result.text;
      break;
    } catch (error) {
      lastError = error;
      if (attempt < LLM_MAX_RETRIES) {
        log.warn(`AI Skill 生成第 ${attempt + 1} 次调用失败，正在重试...`);
        continue;
      }
    }
  }

  if (raw === undefined) {
    throw new UserError("USER-207", `AI Skill 生成失败: LLM 调用 ${LLM_MAX_RETRIES + 1} 次均失败`, {
      cause: lastError,
      context: { module: "skillGenerator" },
    });
  }

  return parseGeneratedSkillDraft(raw);
}

export function parseGeneratedSkillDraft(raw: string): GeneratedSkillDraft {
  const jsonText = extractJsonObject(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new UserError(
      `USER-206`,
      `Invalid AI skill draft JSON: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
        context: { module: "skillGenerator" },
      },
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new UserError("USER-206", "Invalid AI skill draft: expected object", {
      context: { module: "skillGenerator" },
    });
  }

  const obj = parsed as Record<string, unknown>;
  const name = normalizeSkillName(readString(obj.name));
  const description = readString(obj.description).trim();
  const category = readString(obj.category).trim() || "general";
  const content = readString(obj.content).trim();
  const reference = readOptionalMarkdown(obj.reference, "reference");
  const examples = readOptionalMarkdown(obj.examples, "examples");

  assertValidSkillName(name);
  if (!description) {
    throw new UserError("USER-206", "Generated skill description is required", {
      context: { module: "skillGenerator" },
    });
  }
  if (!content || content.length < 40) {
    throw new UserError("USER-206", "Generated skill content is too short", {
      context: { module: "skillGenerator" },
    });
  }
  assertNoDisallowedGeneratedFiles(obj);

  return {
    category,
    content,
    description,
    name,
    ...(reference ? { reference } : {}),
    ...(examples ? { examples } : {}),
  };
}

export function writeSkillDraft(
  draft: GeneratedSkillDraft,
  options: WriteSkillDraftOptions = {},
): WriteSkillDraftResult {
  assertValidSkillName(draft.name);
  const scope = options.scope ?? "project";
  const rootDir =
    scope === "global"
      ? path.join(homedir(), ".crab", "skills")
      : path.join(options.projectDir ?? process.cwd(), ".crab", "skills");
  const skillDir = path.join(rootDir, draft.name);
  const skillFile = path.join(skillDir, "SKILL.md");
  const existingBackup =
    fs.existsSync(skillDir) && options.overwrite
      ? fs.mkdtempSync(path.join(path.dirname(skillDir), `.${draft.name}-backup-`))
      : null;

  if (fs.existsSync(skillDir) && !options.overwrite) {
    throw new UserError("USER-205", `Skill already exists: ${draft.name}`, {
      context: { module: "skillGenerator", skillDir, skillName: draft.name },
    });
  }

  try {
    if (existingBackup) {
      fs.cpSync(skillDir, existingBackup, { recursive: true });
      fs.rmSync(skillDir, { force: true, recursive: true });
    }

    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(skillFile, renderSkillMarkdown(draft), "utf8");

    const files = [skillFile];
    if (draft.reference) {
      const file = path.join(skillDir, "reference.md");
      fs.writeFileSync(file, draft.reference, "utf8");
      files.push(file);
    }
    if (draft.examples) {
      const file = path.join(skillDir, "examples.md");
      fs.writeFileSync(file, draft.examples, "utf8");
      files.push(file);
    }

    const parsed = parseSkillFile(skillFile, scope === "global" ? "global" : "project");
    if (!parsed || parsed.name !== draft.name || parsed.content.trim().length < 40) {
      throw new UserError("USER-206", "Generated SKILL.md failed validation", {
        context: { module: "skillGenerator", skillFile, skillName: draft.name },
      });
    }

    if (existingBackup) {
      fs.rmSync(existingBackup, { force: true, recursive: true });
    }

    return { files, skillDir, skillFile, skillName: draft.name };
  } catch (error) {
    fs.rmSync(skillDir, { force: true, recursive: true });
    if (existingBackup && fs.existsSync(existingBackup)) {
      fs.cpSync(existingBackup, skillDir, { recursive: true });
      fs.rmSync(existingBackup, { force: true, recursive: true });
    }
    throw error;
  }
}

function renderSkillMarkdown(draft: GeneratedSkillDraft): string {
  return [
    "---",
    `name: ${draft.name}`,
    `description: ${escapeFrontmatterValue(draft.description)}`,
    `category: ${escapeFrontmatterValue(draft.category)}`,
    "---",
    "",
    draft.content.trim(),
    "",
  ].join("\n");
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new UserError("USER-206", "AI skill draft did not contain a JSON object", {
      context: { module: "skillGenerator" },
    });
  }
  return candidate.slice(start, end + 1);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readOptionalMarkdown(value: unknown, fieldName: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new UserError("USER-206", `Generated ${fieldName} must be markdown text`, {
      context: { fieldName, module: "skillGenerator" },
    });
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeSkillName(name: string): string {
  return name.trim().toLowerCase().replace(/_/g, "-");
}

function assertValidSkillName(name: string): void {
  if (!SKILL_NAME_RE.test(name)) {
    throw new UserError("USER-202", `Invalid skill name: ${name || "(empty)"}`, {
      context: { module: "skillGenerator", skillName: name },
    });
  }
}

function assertNoDisallowedGeneratedFiles(obj: Record<string, unknown>): void {
  const { files } = obj;
  if (files === undefined) {
    return;
  }
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    throw new UserError("USER-206", "Generated files must be an object", {
      context: { module: "skillGenerator" },
    });
  }
  for (const fileName of Object.keys(files)) {
    if (!ALLOWED_EXTRA_FILES.has(fileName)) {
      throw new UserError("USER-206", `Generated file is not allowed: ${fileName}`, {
        context: { fileName, module: "skillGenerator" },
      });
    }
  }
}

function escapeFrontmatterValue(value: string): string {
  if (/^[a-zA-Z0-9 _./:-]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}
