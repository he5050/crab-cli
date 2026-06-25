/**
 * Skill 管理器
 *
 * 职责:
 *   - 从多目录加载 Skill(discover + builtin)
 *   - 提供 list/get/has 查询接口
 *   - 通过 SkillRunner 执行 Skill
 *   - 管理 Skill 的启用/禁用状态
 *   - 持久化 Skill 配置到文件
 *
 * 模块功能:
 *   - 初始化 Skill 系统(init)
 *   - 重新加载所有 Skill(reload)
 *   - 查询 Skill 列表和详情
 *   - 按分类分组返回 Skill
 *   - 格式化 Skill 列表为 Markdown
 *   - 启用/禁用特定 Skill
 *   - 执行指定的 Skill
 *
 * 使用场景:
 *   - 系统启动时初始化 Skill 系统
 *   - CLI 命令查询可用 Skill 列表
 *   - 根据用户输入匹配并执行 Skill
 *   - 动态启用或禁用特定 Skill
 *   - 重新扫描磁盘加载新 Skill
 *
 * 边界:
 *   1. 内置 Skill 优先级低于磁盘上的同名 Skill
 *   2. 禁用的 Skill 不会加载到内存中
 *   3. 配置优先写入项目级，其次全局配置
 *   4. Skill 执行前会触发 Hook 检查
 *   5. 启用 Skill 后自动后台 reload 生效
 *
 * 流程:
 *   1. 读取配置(加载禁用列表和额外路径)
 *   2. 注册内置 Skill(跳过禁用的)
 *   3. 从磁盘发现自定义 Skill(覆盖同名内置)
 *   4. 提供查询接口供外部使用
 *   5. 通过 SkillRunner 执行选中的 Skill
 */
import type { SkillConfig, SkillDefinition } from "../types";
import { discoverSkills } from "../discovery";
import { builtinSkills } from "../builtin";
import { SkillRunner } from "../runner";
import { globalBus } from "@/bus";
import { AppEvent } from "@/bus";
import { hookExecutor } from "@/hooks/hookExecutor";
import { createLogger } from "@/core/logging/logger";
import { getUsageBoost } from "@/tool/usageMemory";
import { existsSync, mkdirSync, readFileSync, renameSync, chmodSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const log = createLogger("skills:manager");

/** Skill 执行阶段及其默认排序权重 */
const PHASE_ORDER: Record<SkillSearchResult["phase"], number> = {
  analyze: 20,
  document: 50,
  general: 70,
  implement: 30,
  operate: 60,
  plan: 10,
  verify: 40,
};

export interface SkillSearchResult {
  skill: SkillDefinition;
  score: number;
  matchReasons: string[];
  phase: NonNullable<SkillDefinition["phase"]>;
  order: number;
  recommendedAction: "info" | "execute";
  nextStep: string;
}

/** 从 Skill 元数据推导执行阶段（纯函数，供搜索和索引模块复用）。 */
export function inferSkillPhase(skill: SkillDefinition): SkillSearchResult["phase"] {
  if (skill.phase) {
    return skill.phase;
  }
  const haystack = `${skill.name} ${skill.description ?? ""} ${skill.category} ${skill.trigger ?? ""}`.toLowerCase();
  if (/(plan|规划|计划|拆解|设计|architect)/.test(haystack)) {
    return "plan";
  }
  if (/(explain|review|审查|解释|分析|诊断|audit)/.test(haystack)) {
    return "analyze";
  }
  if (/(fix|bug|refactor|重构|修复|实现|implement|code)/.test(haystack)) {
    return "implement";
  }
  if (/(test|测试|verify|验证|qa)/.test(haystack)) {
    return "verify";
  }
  if (/(doc|文档|docs|总结|说明)/.test(haystack)) {
    return "document";
  }
  if (/(config|配置|operate|操作|运维)/.test(haystack)) {
    return "operate";
  }
  return "general";
}

function phaseDefaultOrder(phase: SkillSearchResult["phase"]): number {
  return PHASE_ORDER[phase] ?? 70;
}

function getRecommendedAction(skill: SkillDefinition): SkillSearchResult["recommendedAction"] {
  const hasRequiredParams = skill.parameters?.some((param) => param.required);
  return hasRequiredParams ? "info" : "execute";
}

function getNextStep(skill: SkillDefinition, action: SkillSearchResult["recommendedAction"]): string {
  if (action === "execute") {
    return `可直接调用 skills execute，skillName=${skill.name}；如需先确认完整指令，再调用 skills info。`;
  }
  const required = skill.parameters?.filter((param) => param.required).map((param) => param.name) ?? [];
  return required.length > 0
    ? `先调用 skills info 查看完整指令和必填参数 (${required.join(", ")})，收集输入后再调用 skills execute。`
    : `先调用 skills info 确认完整指令，必要时再调用 skills execute。`;
}

/** Skill 管理器 */
class SkillManager {
  private skills = new Map<string, SkillDefinition>();
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private runner = new SkillRunner();
  private disabledNames = new Set<string>();
  private projectDir?: string;

  /** 读取 Skill 配置(disabled 列表 + 额外路径) */
  private loadConfig(projectDir?: string): SkillConfig {
    const configPaths: string[] = [];

    if (projectDir) {
      configPaths.push(join(projectDir, ".crab", "skills.json"));
    }
    configPaths.push(join(homedir(), ".crab", "skills.json"));

    for (const path of configPaths) {
      if (!existsSync(path)) {
        continue;
      }
      try {
        const data = JSON.parse(readFileSync(path, "utf8"));
        return {
          disabled: Array.isArray(data.disabled) ? data.disabled : [],
          paths: Array.isArray(data.paths) ? data.paths : [],
        };
      } catch (parseErr) {
        // 配置文件格式错误，忽略
        log.debug(`Skill 配置解析失败: ${path}`, parseErr as Parameters<typeof log.debug>[1]);
      }
    }
    return { disabled: [], paths: [] };
  }

  /** 持久化 disabled 列表到 skills.json（原子写入） */
  private saveConfig(projectDir?: string): void {
    const targetDir = projectDir ?? this.projectDir;
    // 优先写入项目级配置，其次全局配置
    const configPath = targetDir ? join(targetDir, ".crab", "skills.json") : join(homedir(), ".crab", "skills.json");

    try {
      // 读取现有配置合并
      let existing: Record<string, unknown> = {};
      if (existsSync(configPath)) {
        try {
          existing = JSON.parse(readFileSync(configPath, "utf8"));
        } catch (parseErr) {
          log.debug(`Skill 配置合并时 JSON 解析失败: ${configPath}`, parseErr as Parameters<typeof log.debug>[1]);
        }
      }

      const merged = {
        ...existing,
        disabled: [...this.disabledNames],
      };

      // 原子写入：tmpfile → renameSync → chmod 0o600
      const dir = dirname(configPath);
      mkdirSync(dir, { recursive: true });
      const tmpFile = `${configPath}.tmp`;
      writeFileSync(tmpFile, JSON.stringify(merged, null, 2), "utf8");
      renameSync(tmpFile, configPath);
      chmodSync(configPath, 0o600);

      log.info(`Skill 配置已保存: ${configPath}`);
    } catch (error) {
      log.warn(`保存 Skill 配置失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 初始化 Skill 系统。
   * 注册内置 Skill，发现并加载自定义 Skill，过滤禁用的 Skill。
   */
  init(projectDir?: string): Promise<void> {
    // 并发保护：复用同一 Promise 避免重复初始化
    if (this.initPromise) {
      return this.initPromise;
    }
    this.initPromise = this._init(projectDir);
    return this.initPromise;
  }

  private async _init(projectDir?: string): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    this.projectDir = projectDir;

    // 0. 读取配置(disabled 列表)
    const config = this.loadConfig(projectDir);
    this.disabledNames = new Set(config.disabled ?? []);
    if (this.disabledNames.size > 0) {
      log.info(`Skill 禁用列表: ${[...this.disabledNames].join(", ")}`);
    }

    // 0.1 注入 toolRegistry 到 runner(Phase 5 / C2 [P2-06])
    // 使用懒加载 getter 以反映 MCP 动态注册
    this.runner.setToolRegistry(null); // null → runner 内部使用默认懒加载

    // 1. 注册内置 Skill(低优先级，可被磁盘上的同名 Skill 覆盖)
    for (const skill of builtinSkills) {
      if (!this.disabledNames.has(skill.name)) {
        this.skills.set(skill.name, skill);
      }
    }

    // 2. 从磁盘发现自定义 Skill(覆盖同名内置 Skill)
    const discovered = await discoverSkills(projectDir, config.paths ?? []);
    for (const skill of discovered) {
      if (!this.disabledNames.has(skill.name)) {
        this.skills.set(skill.name, skill);
      }
    }

    log.info(
      `Skill 系统已初始化: ${this.skills.size} 个 Skill (${builtinSkills.length} 内置 + ${discovered.length} 自定义, ${this.disabledNames.size} 禁用)`,
    );
  }

  /** 重新加载(强制重新扫描磁盘，保留禁用列表) */
  async reload(projectDir?: string): Promise<void> {
    // 并发保护：复用同一 Promise 避免重复 reload
    if (this.reloadPromise) {
      return this.reloadPromise;
    }
    this.reloadPromise = this._reload(projectDir);
    try {
      await this.reloadPromise;
    } finally {
      this.reloadPromise = null;
    }
  }

  private reloadPromise: Promise<void> | null = null;

  private async _reload(projectDir?: string): Promise<void> {
    this.skills.clear();
    this.projectDir = projectDir;
    this.initialized = false;
    this.initPromise = null; // 重置并发保护，允许下次 init 重新初始化

    // 重新读取配置
    const config = this.loadConfig(projectDir);
    this.disabledNames = new Set(config.disabled ?? []);

    // 重新注册内置(跳过禁用)
    for (const skill of builtinSkills) {
      if (!this.disabledNames.has(skill.name)) {
        this.skills.set(skill.name, skill);
      }
    }

    // 重新发现(跳过禁用)
    const discovered = await discoverSkills(projectDir, config.paths ?? []);
    for (const skill of discovered) {
      if (!this.disabledNames.has(skill.name)) {
        this.skills.set(skill.name, skill);
      }
    }

    this.initialized = true;
    log.info(`Skill 系统已重新加载: ${this.skills.size} 个 Skill, ${this.disabledNames.size} 禁用`);
  }

  /** 获取所有 Skill */
  list(category?: string): SkillDefinition[] {
    const all = [...this.skills.values()];
    if (category) {
      return all.filter((s) => s.category === category);
    }
    return all;
  }

  /** 获取可见 Skill(排除 hidden) */
  listVisible(category?: string): SkillDefinition[] {
    return this.list(category).filter((s) => !s.hidden);
  }

  /** 按 source 过滤 */
  listBySource(source: string): SkillDefinition[] {
    return [...this.skills.values()].filter((s) => s.source === source);
  }

  /** 搜索可见 Skill，并返回匹配原因、阶段和推荐下一步 */
  searchDetailed(query: string, limit = 10): SkillSearchResult[] {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return [];
    }

    const terms = normalizedQuery.split(/\s+/).filter(Boolean);
    const scored = this.listVisible()
      .map((skill) => {
        const name = skill.name.toLowerCase();
        const description = (skill.description ?? "").toLowerCase();
        const category = skill.category.toLowerCase();
        const trigger = (skill.trigger ?? "").toLowerCase();
        const whenToUse = (skill.whenToUse ?? "").toLowerCase();
        const content = skill.content.toLowerCase();

        let score = 0;
        const matchReasons: string[] = [];
        for (const term of terms) {
          if (name === term) {
            score += 100;
            matchReasons.push(`name exact: ${term}`);
          } else if (name.includes(term)) {
            score += 60;
            matchReasons.push(`name contains: ${term}`);
          }
          if (trigger.includes(term)) {
            score += 45;
            matchReasons.push(`trigger contains: ${term}`);
          }
          if (whenToUse.includes(term)) {
            score += 40;
            matchReasons.push(`whenToUse contains: ${term}`);
          }
          if (description.includes(term)) {
            score += 35;
            matchReasons.push(`description contains: ${term}`);
          }
          if (category.includes(term)) {
            score += 20;
            matchReasons.push(`category contains: ${term}`);
          }
          if (content.includes(term)) {
            score += 5;
            matchReasons.push(`content contains: ${term}`);
          }
        }

        const phase = inferSkillPhase(skill);
        const order = skill.order ?? phaseDefaultOrder(phase);
        const recommendedAction = getRecommendedAction(skill);
        const usageBoost = getUsageBoost("skill", skill.name, query, this.projectDir ?? process.cwd());
        if (usageBoost.score > 0) {
          score += usageBoost.score;
          matchReasons.push(...usageBoost.reasons);
        }
        return {
          matchReasons: [...new Set(matchReasons)].slice(0, 8),
          nextStep: getNextStep(skill, recommendedAction),
          order,
          phase,
          recommendedAction,
          score,
          skill,
        };
      })
      .filter((entry) => entry.score > 0)
      .toSorted((a, b) => b.score - a.score || a.order - b.order || a.skill.name.localeCompare(b.skill.name));

    return scored.slice(0, Math.max(1, limit));
  }

  /** 搜索可见 Skill(名称、描述、分类、触发词和内容摘要) */
  search(query: string, limit = 10): SkillDefinition[] {
    return this.searchDetailed(query, limit).map((entry) => entry.skill);
  }

  /** 获取单个 Skill */
  get(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  /** 检查 Skill 是否存在 */
  has(name: string): boolean {
    return this.skills.has(name);
  }

  /** 获取 Skill 总数 */
  get size(): number {
    return this.skills.size;
  }

  /** 获取禁用列表 */
  getDisabledList(): string[] {
    return [...this.disabledNames];
  }

  /** 检查 Skill 是否被禁用 */
  isDisabled(name: string): boolean {
    return this.disabledNames.has(name);
  }

  /** 禁用一个 Skill(运行时 + 持久化到 skills.json) */
  disable(name: string): boolean {
    if (!this.skills.has(name) && !this.disabledNames.has(name)) {
      return false;
    }
    this.disabledNames.add(name);
    this.skills.delete(name);
    this.saveConfig();
    log.info(`Skill 已禁用: ${name}`);
    return true;
  }

  /** 启用一个已禁用的 Skill（自动重新加载到内存中） */
  enable(name: string): boolean {
    if (!this.disabledNames.has(name)) {
      return false;
    }
    this.disabledNames.delete(name);
    this.saveConfig();
    log.info(`Skill 已启用: ${name}（正在重新加载）`);

    // 异步重新加载该 Skill 到内存，无需用户手动调用 reload
    this.reloadInBackground().catch((err) => {
      log.warn(`enable 后台 reload 失败: ${err instanceof Error ? err.message : String(err)}`);
    });
    return true;
  }

  /** 后台 reload（不阻塞 enable 返回值） */
  private async reloadInBackground(): Promise<void> {
    try {
      await this.reload(this.projectDir);
    } catch (reloadErr) {
      // 后台 reload 失败不影响 enable 的返回值
      log.debug(`enable 后台 reload 失败`, reloadErr as Parameters<typeof log.debug>[1]);
    }
  }

  /**
   * 执行 Skill。
   *
   * 将 Skill 内容作为指令注入到对话中。
   * 支持参数替换和追加用户输入。
   * 执行前触发 SkillExecute Hook(可阻止)。
   */
  async run(
    skillName: string,
    params?: Record<string, unknown>,
    userInput?: string,
  ): Promise<import("../types").SkillExecutionResult> {
    const skill = this.skills.get(skillName);
    if (!skill) {
      return {
        error: `Skill 不存在: ${skillName}`,
        ok: false,
        prompt: "",
        skillName,
      };
    }

    // Hook: SkillExecute(允许阻止执行)
    const hookResult = await hookExecutor.skillExecute(skillName, params);
    if (!hookResult.allowed) {
      log.info(`Skill 执行被 Hook 阻止: ${skillName} (${hookResult.reason ?? "未提供原因"})`);
      return {
        error: `Skill 执行被 Hook 阻止: ${hookResult.reason ?? "未提供原因"}`,
        ok: false,
        prompt: "",
        skillName,
      };
    }

    globalBus.publish(AppEvent.ToolCall, {
      args: { hasInput: Boolean(userInput), skillName },
      callId: `skill-${Date.now()}`,
      tool: "skill",
    });

    return this.runner.run(skill, params, userInput);
  }

  /**
   * 按分类分组返回 Skill 列表。
   */
  listGrouped(): Map<string, SkillDefinition[]> {
    const grouped = new Map<string, SkillDefinition[]>();
    const visible = this.listVisible();

    for (const skill of visible) {
      const cat = skill.category;
      const list = grouped.get(cat) ?? [];
      list.push(skill);
      grouped.set(cat, list);
    }

    // 每个分类内按 name 排序
    for (const [, list] of grouped) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }

    return grouped;
  }

  /** 格式化为 Markdown 列表(用于系统提示词注入) */
  formatList(): string {
    const visible = this.listVisible().filter((s) => s.description);
    if (visible.length === 0) {
      return "暂无可用 Skill。";
    }

    return [
      "## 可用 Skills",
      ...visible.toSorted((a, b) => a.name.localeCompare(b.name)).map((s) => `- **${s.name}**: ${s.description}`),
    ].join("\n");
  }
}

/** 全局 Skill 管理器实例 */
export const skillManager = new SkillManager();

/**
 * 创建独立的 SkillManager 实例（供测试使用）。
 *
 * 与模块级单例 skillManager 隔离，避免测试间状态泄漏。
 */
export function createSkillManager(): SkillManager {
  return new SkillManager();
}
