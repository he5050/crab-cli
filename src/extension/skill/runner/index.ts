/**
 * Skill 执行器
 *
 * 职责:
 *   - 组装 Skill prompt(模板 + 参数替换 + 用户输入追加)
 *   - 验证必填参数
 *   - 返回组装后的 prompt 供对话循环使用
 *   - 支持参数默认值和类型检查
 *   - 持有 toolRegistry 引用(用于解析 skill.tools 过滤的可用工具集)
 *
 * 模块功能:
 *   - 执行 Skill(run)
 *   - 验证 Skill 参数(validateParams)
 *   - 替换参数占位符(replaceParams)
 *   - 注入 toolRegistry 依赖(setToolRegistry)
 *   - 计算 Skill 的可用工具集合(listAvailableTools)
 *   - 支持 {{paramName}} 和 {{paramName:default}} 语法
 *
 * 使用场景:
 *   - SkillManager 调用以执行选中的 Skill
 *   - 将 Skill 内容注入对话上下文
 *   - 处理用户提供的参数和输入
 *   - 组装最终的 prompt 供 AI 处理
 *   - 在 Skill 执行上下文内枚举工具能力
 *
 * 边界:
 *   1. 必填参数缺失时返回错误结果
 *   2. 参数类型仅验证 number 和 boolean
 *   3. 占位符无值且无默认时保留原样
 *   4. 用户输入追加到 prompt 末尾
 *   5. 执行结果包含 ok 状态和组装后的 prompt
 *   6. toolRegistry 默认为懒加载引用，避免循环依赖
 *   7. skill.tools 为空或未定义时暴露完整注册表
 *
 * 流程:
 *   1. 验证所有必填参数是否提供
 *   2. 检查参数类型是否匹配
 *   3. 替换模板中的参数占位符
 *   4. 追加用户输入到 prompt
 *   5. 计算 skill.tools 过滤后的可用工具集合
 *   6. 返回执行结果(含 availableToolNames)
 */
import type { SkillDefinition, SkillExecutionResult, SkillParameter } from "../types";
import type { ToolDefinition } from "@/tool/types";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("skills:runner");

/** 工具注册表视图(懒加载的只读快照获取器) */
export type ToolRegistryView = () => Readonly<Record<string, ToolDefinition<any>>>;

/** 默认 toolRegistry 视图(懒加载到 src/tool/toolRegistry.ts) */
let defaultRegistryView: ToolRegistryView | null = null;

/** 懒加载默认 registry（避免 skillRunner 与 toolRegistry 循环依赖） */
let defaultRegistryLoading: Promise<ToolRegistryView> | null = null;

/**
 * 获取默认 toolRegistry 视图。
 * 使用动态 import() 懒加载避免循环依赖；结果缓存后续调用直接返回。
 */
async function getDefaultRegistryView(): Promise<ToolRegistryView> {
  if (defaultRegistryView) {
    return defaultRegistryView;
  }
  if (!defaultRegistryLoading) {
    defaultRegistryLoading = import("@/tool/registry/toolRegistry").then((mod) => {
      const view: ToolRegistryView = () =>
        (mod as { getRegisteredTools: () => Readonly<Record<string, ToolDefinition<any>>> }).getRegisteredTools();
      defaultRegistryView = view;
      return view;
    });
  }
  return defaultRegistryLoading;
}

/** Skill 执行器 */
export class SkillRunner {
  /** 当前注入的 toolRegistry 视图(未注入时使用懒加载默认) */
  private registryView: ToolRegistryView | null = null;

  /**
   * 注入 toolRegistry 依赖。
   *
   * 职责:
   *   - 替换 SkillRunner 内部的 toolRegistry 引用
   *
   * 模块功能:
   *   - 保存一个返回只读工具快照的 getter(非一次性快照)，
   *     确保每次 listAvailableTools 调用都能反映最新注册状态(MCP 动态注册)
   *
   * 使用场景:
   *   - SkillManager.init() 中调用，注入全局 toolRegistry
   *   - 测试中注入 mock registry
   *
   * 边界:
   *   1. 接受一个返回 Record<string, ToolDefinition> 的函数
   *   2. 调用时机不影响 run() 的对外签名(向后兼容)
   *   3. 不传或传 null 时回退到默认懒加载视图
   *
   * 流程:
   *   1. 校验入参
   *   2. 写入实例字段
   *   3. 记录日志
   */
  setToolRegistry(view: ToolRegistryView | null): void {
    this.registryView = view;
    log.debug("toolRegistry 已注入", { source: view ? "explicit" : "default-lazy" });
  }

  /**
   * 列出当前 Skill 可用的工具名称集合。
   *
   * 职责:
   *   - 解析 SkillDefinition.tools 与当前 toolRegistry 的交集
   *
   * 模块功能:
   *   - 纯只读计算，不修改任何状态
   *   - 当 skill.tools 未定义或为空数组时，返回完整注册表的所有工具名
   *   - 当 skill.tools 已定义时，仅返回注册表中存在的工具名
   *     (未在注册表中的工具名被静默忽略，避免下游假设错误)
   *
   * 使用场景:
   *   - 测试中验证过滤逻辑
   *   - 未来在 Skill 执行上下文中枚举可用工具(YAGNI 不在本期实现)
   *
   * 边界:
   *   1. 不调用 run()，无副作用
   *   2. 工具名顺序遵循 registry 的迭代顺序
   *   3. toolRegistry 抛错时返回空数组并 warn
   *
   * 流程:
   *   1. 解析当前 registry 视图
   *   2. 获取全部已注册工具名
   *   3. 若 skill.tools 为空/未定义，直接返回全量
   *   4. 否则取交集
   */
  async listAvailableTools(skill: SkillDefinition): Promise<string[]> {
    let view: ToolRegistryView;
    try {
      view = this.registryView ?? (await getDefaultRegistryView());
    } catch (error) {
      log.warn("toolRegistry 视图加载失败，回退为空列表", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
    let registered: Readonly<Record<string, ToolDefinition<any>>>;
    try {
      registered = view();
    } catch (error) {
      log.warn("toolRegistry 视图调用失败，回退为空列表", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
    const allNames = Object.keys(registered);
    if (!skill.tools || skill.tools.length === 0) {
      return allNames;
    }
    const allowed = new Set(skill.tools);
    return allNames.filter((name) => allowed.has(name));
  }

  /**
   * 执行 Skill。
   *
   * 流程:
   *   1. 验证必填参数
   *   2. 替换模板中的参数占位符({{paramName}})
   *   3. 追加用户输入
   *   4. 计算可用工具名(依据 skill.tools 过滤)
   *   5. 返回组装后的 prompt 与可用工具名
   */
  async run(
    skill: SkillDefinition,
    params?: Record<string, unknown>,
    userInput?: string,
  ): Promise<SkillExecutionResult> {
    // 1. 验证必填参数
    if (skill.parameters) {
      const validationError = validateParams(skill.parameters, params);
      if (validationError) {
        return {
          error: validationError,
          ok: false,
          prompt: "",
          skillName: skill.name,
        };
      }
    }

    // 2. 组装 prompt
    let prompt = skill.content;

    // 替换参数占位符
    if (params) {
      prompt = replaceParams(prompt, params);
    }

    // 3. 追加用户输入
    if (userInput) {
      prompt = `${prompt}\n\n${userInput}`;
    }

    // 4. 计算可用工具名(仅在成功路径填充)
    const availableToolNames = await this.listAvailableTools(skill);

    log.info(`Skill 执行: ${skill.name} (prompt 长度: ${prompt.length}, 可用工具: ${availableToolNames.length})`);

    return {
      availableToolNames,
      ok: true,
      prompt,
      skillName: skill.name,
    };
  }
}

/**
 * 验证 Skill 参数。
 */
function validateParams(parameters: SkillParameter[], params?: Record<string, unknown>): string | null {
  for (const param of parameters) {
    if (!param.required) {
      continue;
    }

    const value = params?.[param.name];
    if (value === undefined || value === null || value === "") {
      return `缺少必填参数: ${param.name} (${param.description || param.type})`;
    }

    // 类型检查
    if (param.type === "number" && typeof value !== "number") {
      return `参数 ${param.name} 应为 number 类型`;
    }
    if (param.type === "boolean" && typeof value !== "boolean") {
      return `参数 ${param.name} 应为 boolean 类型`;
    }
  }

  return null;
}

/**
 * 替换 prompt 中的参数占位符。
 *
 * 支持:
 *   {{paramName}} → 替换为参数值
 *   {{paramName:default}} → 带默认值
 */
function replaceParams(prompt: string, params: Record<string, unknown>): string {
  return prompt.replace(/\{\{(\w+)(?::([^}]*))?\}\}/g, (match, name, defaultVal) => {
    const value = params[name];
    if (value !== undefined && value !== null) {
      return String(value);
    }
    // 使用默认值
    if (defaultVal !== undefined) {
      return defaultVal;
    }
    // 无值无默认，保留原始占位符
    return match;
  });
}
