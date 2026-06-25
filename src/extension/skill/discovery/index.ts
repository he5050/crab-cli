/**
 * Skill 发现模块
 *
 * 职责:
 *   - 从多个目录扫描 SKILL.md 文件
 *   - 解析 Markdown 和 JSON 格式的 Skill 文件
 *   - 提取 frontmatter 元数据和 body 内容
 *   - 处理 Skill 优先级(高优先级覆盖低优先级)
 *
 * 模块功能:
 *   - 发现所有可用 Skill(discoverSkills)
 *   - 递归扫描目录(scanDirectory)
 *   - 解析单个 Skill 文件(parseSkillFile)
 *   - 解析 Markdown 格式(parseMarkdownSkill)
 *   - 解析 JSON 格式(parseJsonSkill)
 *   - 简易 YAML frontmatter 解析
 *
 * 使用场景:
 *   - 系统初始化时扫描所有 Skill 目录
 *   - 动态加载项目级、全局、兼容层 Skill
 *   - 解析用户自定义的 SKILL.md 文件
 *   - 支持 codex/claude 兼容的 Skill 格式
 *
 * 边界:
 *   1. 仅识别 SKILL.md/skill.md 或 .md/.json 文件
 *   2. YAML 解析器为简易实现，不支持复杂特性
 *   3. 高优先级 Skill 会覆盖低优先级同名 Skill
 *   4. 扫描失败时记录警告但不中断流程
 *   5. 解析失败返回 null 而非抛出异常
 *
 * 流程:
 *   1. 配置扫描目录(项目级 → 全局)
 *   2. 递归扫描每个目录中的 Skill 文件
 *   3. 解析文件内容提取元数据和 body
 *   4. 使用 Zod 验证 frontmatter 数据
 *   5. 按优先级合并同名 Skill
 */
import { createLogger } from "@/core/logging/logger";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import type { SkillDefinition, SkillFrontmatter, SkillSource } from "../types";
import { skillFrontmatterSchema } from "../types";

const log = createLogger("skills:discovery");

/** Skill 文件匹配模式 */
const SKILL_FILE_NAMES = new Set(["SKILL.md", "skill.md"]);

/**
 * 从所有目录发现 Skill。
 */
export async function discoverSkills(projectDir?: string, extraPaths: string[] = []): Promise<SkillDefinition[]> {
  const skills: SkillDefinition[] = [];
  const seen = new Set<string>();

  // 扫描目录配置(优先级从高到低)
  const scanDirs: { dir: string; source: SkillSource }[] = [];

  if (projectDir) {
    scanDirs.push(
      { dir: join(projectDir, ".crab", "skills"), source: "project" },
      { dir: join(projectDir, ".claude", "skills"), source: "claude-compat" },
      { dir: join(projectDir, ".agents", "skills"), source: "codex-compat" },
    );
  }

  for (const configuredPath of extraPaths) {
    const resolved = resolveConfiguredSkillPath(configuredPath, projectDir);
    scanDirs.push({ dir: resolved, source: projectDir ? "project" : "global" });
  }

  scanDirs.push({ dir: join(homedir(), ".crab", "skills"), source: "global" });

  for (const { dir, source } of scanDirs) {
    if (!existsSync(dir)) {
      continue;
    }

    try {
      const discovered = scanDirectory(dir, source);
      for (const skill of discovered) {
        // 高优先级的覆盖低优先级同名 Skill
        if (!seen.has(skill.name)) {
          seen.add(skill.name);
          skills.push(skill);
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.warn(`扫描 Skill 目录失败: ${dir}: ${msg}`);
    }
  }

  log.info(`发现了 ${skills.length} 个 Skill`);
  return skills;
}

function resolveConfiguredSkillPath(configuredPath: string, projectDir?: string): string {
  if (configuredPath.startsWith("~/")) {
    return join(homedir(), configuredPath.slice(2));
  }
  if (isAbsolute(configuredPath)) {
    return configuredPath;
  }
  return join(projectDir ?? homedir(), configuredPath);
}

/** 默认最大递归深度 */
const MAX_SCAN_DEPTH = 10;

/**
 * 递归扫描单个目录。
 *
 * @param maxDepth 最大递归深度，防止符号链接循环导致栈溢出（默认 10）
 */
function scanDirectory(dir: string, source: SkillSource, maxDepth = MAX_SCAN_DEPTH): SkillDefinition[] {
  const skills: SkillDefinition[] = [];

  if (maxDepth <= 0) {
    log.warn(`扫描深度超限，跳过: ${dir}`);
    return skills;
  }

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isFile()) {
        if (SKILL_FILE_NAMES.has(entry.name) || entry.name.endsWith(".md") || entry.name.endsWith(".json")) {
          const skill = parseSkillFile(fullPath, source);
          if (skill) {
            skills.push(skill);
          }
        }
      } else if (entry.isDirectory()) {
        // 递归扫描子目录（深度 -1）
        skills.push(...scanDirectory(fullPath, source, maxDepth - 1));
      }
    }
  } catch (scanErr) {
    // 目录不存在或无权限，跳过
    log.debug(`扫描目录失败: ${dir}`, scanErr as Parameters<typeof log.debug>[1]);
  }

  return skills;
}

/**
 * 解析单个 Skill 文件。
 *
 * 支持 SKILL.md(frontmatter + body)和 .json 格式。
 */
export function parseSkillFile(filePath: string, source: SkillSource): SkillDefinition | null {
  try {
    const content = readFileSync(filePath, "utf8");
    if (!content.trim()) {
      return null;
    }

    const fileName = basename(filePath);

    // JSON 格式
    if (fileName.endsWith(".json")) {
      return parseJsonSkill(filePath, content, source);
    }

    // Markdown 格式(支持 frontmatter)
    return parseMarkdownSkill(filePath, content, source);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.warn(`解析 Skill 文件失败: ${filePath}: ${msg}`);
    return null;
  }
}

/**
 * 解析 Markdown 格式的 Skill 文件。
 *
 * 支持 YAML frontmatter:
 * ---
 * name: my-skill
 * description: My custom skill
 * category: general
 * ---
 *
 * Skill body content here...
 */
function parseMarkdownSkill(filePath: string, content: string, source: SkillSource): SkillDefinition | null {
  let frontmatter: Partial<SkillFrontmatter> = {};
  let body = content;

  // 解析 YAML frontmatter(--- 包裹)
  if (content.startsWith("---")) {
    const endIdx = content.indexOf("---", 3);
    if (endIdx > 0) {
      const fmStr = content.slice(3, endIdx).trim();
      body = content.slice(endIdx + 3).trim();

      try {
        frontmatter = parseYamlFrontmatter(fmStr);
      } catch (error) {
        log.warn(`Skill frontmatter 解析失败: ${filePath}: ${error}`);
      }
    }
  }

  // 从文件路径推导 name(如果 frontmatter 没有)
  const dirName = basename(dirname(filePath));
  const fileNameNoExt = basename(filePath, ".md");
  const derivedName = frontmatter.name ?? (SKILL_FILE_NAMES.has(`${fileNameNoExt}.md`) ? dirName : fileNameNoExt);

  if (!derivedName) {
    return null;
  }

  // 提取描述(优先 frontmatter，其次首行标题)
  let { description } = frontmatter;
  if (!description) {
    const firstLine = body.split("\n")[0] ?? "";
    description = firstLine.replace(/^#+\s*/, "").trim() || undefined;
  }

  // Zod 验证
  const validation = skillFrontmatterSchema.safeParse({
    avoidWhen: frontmatter.avoidWhen,
    category: frontmatter.category ?? "general",
    dependsOn: frontmatter.dependsOn,
    description,
    hidden: frontmatter.hidden,
    model: frontmatter.model,
    name: derivedName,
    order: frontmatter.order,
    parameters: frontmatter.parameters,
    phase: frontmatter.phase,
    tools: frontmatter.tools,
    trigger: frontmatter.trigger,
    whenToUse: frontmatter.whenToUse,
  });

  if (!validation.success) {
    const firstError = validation.error.issues[0];
    log.warn(`Skill 验证失败: ${filePath}: ${firstError?.message}`);
    return null;
  }

  const fm = validation.data;

  return {
    avoidWhen: fm.avoidWhen,
    category: fm.category,
    content: body,
    dependsOn: fm.dependsOn,
    description: (fm.description ?? description)!,
    hidden: fm.hidden,
    location: filePath,
    model: fm.model,
    name: fm.name,
    order: fm.order,
    parameters: fm.parameters,
    phase: fm.phase,
    source,
    tools: fm.tools,
    trigger: fm.trigger,
    whenToUse: fm.whenToUse,
  };
}

/**
 * 解析 JSON 格式的 Skill 文件。
 */
function parseJsonSkill(filePath: string, content: string, source: SkillSource): SkillDefinition | null {
  try {
    const data = JSON.parse(content);
    const name = data.name ?? basename(filePath, ".json");
    if (!name) {
      return null;
    }

    // Zod 验证（与 parseMarkdownSkill 保持一致）
    const validation = skillFrontmatterSchema.safeParse({
      avoidWhen: data.avoidWhen,
      category: data.category ?? "general",
      dependsOn: data.dependsOn,
      description: data.description ?? "",
      hidden: data.hidden,
      model: data.model,
      name,
      order: data.order,
      parameters: data.parameters,
      phase: data.phase,
      tools: data.tools,
      trigger: data.trigger,
      whenToUse: data.whenToUse,
    });

    if (!validation.success) {
      const firstError = validation.error.issues[0];
      log.warn(`Skill JSON 验证失败: ${filePath}: ${firstError?.message}`);
      return null;
    }

    const fm = validation.data;

    return {
      avoidWhen: fm.avoidWhen,
      category: fm.category,
      content: data.prompt ?? data.content ?? content,
      dependsOn: fm.dependsOn,
      description: fm.description ?? data.description ?? "",
      hidden: fm.hidden,
      location: filePath,
      model: fm.model,
      name: fm.name,
      order: fm.order,
      parameters: fm.parameters,
      phase: fm.phase,
      source,
      tools: fm.tools,
      trigger: fm.trigger,
      whenToUse: fm.whenToUse,
    };
  } catch (parseErr) {
    log.debug(`Skill JSON 解析失败: ${filePath}`, parseErr as Parameters<typeof log.debug>[1]);
    return null;
  }
}

/**
 * 简易 YAML frontmatter 解析（状态机实现）。
 *
 * 支持格式:
 *   - key: value（简单值）
 *   - key:（空值，视为数组开始）
 *   - key:\n  - item1\n  - item2（简单字符串数组）
 *   - key:\n  - sub: val\n    sub2: val（嵌套对象数组，如 parameters）
 *
 * 不支持: 锚点、多文档、复杂缩进嵌套、块标量(|, >)。
 */
function parseYamlFrontmatter(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split("\n");

  // 状态机：追踪当前正在构建的数组和数组项
  let currentArray: unknown[] | null = null;
  let currentArrayItem: Record<string, unknown> | null = null;

  /** 完成当前数组项并推入数组 */
  function finishArrayItem(): void {
    if (currentArrayItem && currentArray) {
      currentArray.push(currentArrayItem);
      currentArrayItem = null;
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    // 列表项（以 - 开头）
    if (trimmed.startsWith("- ")) {
      if (currentArray) {
        // 先完成上一个数组项
        finishArrayItem();
        // 解析列表项内容：" - key: value" → 可能是简单值或对象开始
        const itemContent = trimmed.slice(2).trim();
        const itemColonIdx = itemContent.indexOf(":");
        if (itemColonIdx > 0) {
          // 对象数组项："- name: code" → { name: "code" }
          const itemKey = itemContent.slice(0, itemColonIdx).trim();
          const itemValue = itemContent.slice(itemColonIdx + 1).trim();
          currentArrayItem = { [itemKey]: parseYamlValue(itemValue) };
        } else {
          // 简单值数组项："- item1"
          currentArray.push(parseYamlValue(itemContent));
        }
      }
      continue;
    }

    // Key: value（顶层或数组项内的子键）
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim();
      const valueStr = trimmed.slice(colonIdx + 1).trim();

      if (currentArrayItem) {
        // 当前正在构建数组项对象，此 key 属于数组项
        currentArrayItem[key] = valueStr === "" ? true : parseYamlValue(valueStr);
      } else if (currentArray) {
        // 在数组上下文中但不在对象项内 → 简单值行不属于数组，结束数组
        finishArrayItem();
        currentArray = null;
        // 继续作为顶层 key 处理
        if (valueStr === "" || valueStr === "|" || valueStr === ">") {
          currentArray = valueStr === "" ? [] : null;
          if (Array.isArray(currentArray)) {
            result[key] = currentArray;
          }
        } else {
          result[key] = parseYamlValue(valueStr);
        }
      } else {
        // 顶层 key
        if (valueStr === "" || valueStr === "|" || valueStr === ">") {
          // 空值视为数组开始
          currentArray = valueStr === "" ? [] : null;
          if (Array.isArray(currentArray)) {
            result[key] = currentArray;
          }
        } else {
          result[key] = parseYamlValue(valueStr);
        }
      }
    }
  }

  // 完成最后一个数组项
  finishArrayItem();

  return result;
}

function parseYamlValue(value: string): unknown {
  // 字符串(带引号)
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  // 布尔
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  // 数字
  if (/^-?\d+$/.test(value)) {
    return parseInt(value, 10);
  }
  if (/^-?\d+\.\d+$/.test(value)) {
    return parseFloat(value);
  }
  // 数组格式 [a, b]
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((s) => parseYamlValue(s.trim()));
  }
  return value;
}
