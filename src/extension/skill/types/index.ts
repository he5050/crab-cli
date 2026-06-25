/**
 * Skills 类型定义
 *
 * 职责:
 *   - 定义 Skill 系统的核心接口和类型
 *   - 提供 Skill 结构的标准化定义
 *   - 定义 Zod 验证 Schema 用于运行时校验
 *   - 规范 Skill 配置和执行结果的格式
 *
 * 模块功能:
 *   - 定义 Skill 来源类型(builtin/project/global 等)
 *   - 定义 Skill 参数结构(名称、类型、必填、默认值、描述)
 *   - 定义 Skill 定义结构(元数据 + 内容)
 *   - 定义 Skill 配置文件格式
 *   - 提供 frontmatter Zod Schema 验证
 *   - 定义 Skill 执行结果结构
 *
 * 使用场景:
 *   - Skill 文件的解析和验证
 *   - Skill 管理器的数据结构定义
 *   - Skill 执行器的输入输出类型
 *   - 配置文件读取和写入的类型约束
 *   - 类型安全的数据传递
 *
 * 边界:
 *   1. 参数类型仅支持 string/number/boolean
 *   2. Skill 名称必须非空
 *   3. 分类默认为 "general"
 *   4. 配置文件路径固定为 .crab/skills.json
 *   5. 执行结果必须包含 ok 状态和 Skill 名称
 *
 * 流程:
 *   1. 定义 Skill 相关的所有接口类型
 *   2. 使用 Zod 创建验证 Schema
 *   3. 导出类型供其他模块使用
 *   4. 在解析和执行时进行类型校验
 */
import { z } from "zod";

/** Skill 来源类型 */
export type SkillSource = "builtin" | "project" | "global" | "claude-compat" | "codex-compat";

/** Skill 参数定义 */
export interface SkillParameter {
  name: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  default?: unknown;
  description: string;
}

/** Skill 定义(内部表示) */
export interface SkillDefinition {
  /** Skill ID(通常为文件名或 name frontmatter 字段) */
  name: string;
  /** Skill 描述(来自 frontmatter description 或首行标题) */
  description?: string;
  /** Skill 分类(来自 frontmatter category，默认 "general") */
  category: string;
  /** Skill 来源文件路径 */
  location: string;
  /** SKILL.md body 内容(即 Skill 的 prompt/指令) */
  content: string;
  /** Skill 来源 */
  source: SkillSource;
  /** 触发关键词 */
  trigger?: string;
  /** 适用场景说明 */
  whenToUse?: string;
  /** 不适用场景说明 */
  avoidWhen?: string;
  /** 执行阶段，用于多 Skill 编排 */
  phase?: "plan" | "analyze" | "implement" | "verify" | "document" | "operate" | "general";
  /** 排序权重，数值越小越靠前 */
  order?: number;
  /** 依赖的 Skill 名称 */
  dependsOn?: string[];
  /** 参数定义 */
  parameters?: SkillParameter[];
  /** 指定使用的工具列表 */
  tools?: string[];
  /** 指定模型 */
  model?: string;
  /** 是否隐藏 */
  hidden?: boolean;
}

/** Skill 配置文件格式(.crab/skills.json) */
export interface SkillConfig {
  /** 禁用的 Skill 名列表 */
  disabled?: string[];
  /** 额外的 Skill 搜索路径 */
  paths?: string[];
}

// ─── Zod 验证 Schema ────────────────────────────────────────

/** SKILL.md frontmatter schema */
export const skillFrontmatterSchema = z.object({
  avoidWhen: z.string().optional(),
  category: z.string().default("general"),
  dependsOn: z.array(z.string()).optional(),
  description: z.string().optional(),
  hidden: z.boolean().optional(),
  model: z.string().optional(),
  name: z.string().min(1),
  order: z.number().optional(),
  parameters: z
    .array(
      z.object({
        default: z.unknown().optional(),
        description: z.string(),
        name: z.string(),
        required: z.boolean().default(false),
        type: z.enum(["string", "number", "boolean"]),
      }),
    )
    .optional(),
  phase: z.enum(["plan", "analyze", "implement", "verify", "document", "operate", "general"]).optional(),
  tools: z.array(z.string()).optional(),
  trigger: z.string().optional(),
  whenToUse: z.string().optional(),
});

export type SkillFrontmatter = z.infer<typeof skillFrontmatterSchema>;

/** Skill 执行结果 */
export interface SkillExecutionResult {
  /** 执行是否成功 */
  ok: boolean;
  /** Skill 名称 */
  skillName: string;
  /** 组装后的 prompt */
  prompt: string;
  /** 错误信息 */
  error?: string;
  /**
   * 本次执行可用的工具名称集合(仅在 ok: true 时填充)。
   *
   * 行为:
   *   - skill.tools 未定义或为空数组 → 完整 toolRegistry
   *   - skill.tools 已定义 → 取与 toolRegistry 的交集(仅保留已注册的工具)
   *
   * 该字段由 SkillRunner 在成功路径下计算，用于让调用方知道此 Skill 解析了
   * 哪些工具作为其执行上下文的一部分。仅做信息暴露，不影响 prompt 文本。
   */
  availableToolNames?: string[];
}
