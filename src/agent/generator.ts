/**
 * LLM Agent 生成器 — 通过自然语言描述自动生成 Agent 配置。
 *
 * 职责:
 *   - 接受自然语言描述，调用 LLM 生成结构化 Agent 配置
 *   - 使用 AI SDK 的 generateObject + Zod schema 确保输出格式正确
 *   - 将生成的配置写入 ~/.crab/agents/<identifier>.json
 *
 * 模块功能:
 *   - generateAgent(description, config?): 核心 LLM 生成函数
 *   - generateAgentCommand(description): CLI 命令入口
 *
 * 使用场景:
 *   - `crab agent generate "一个擅长写 Python 测试的 Agent"`
 *
 * 边界:
 *   1. 依赖已配置的 Provider 和模型
 *   2. 生成的配置写入 ~/.crab/agents/ 目录
 *   3. 生成的 Agent 可通过 roles.json 或 agents 目录加载
 */

import { generateObject } from "ai";
import { z } from "zod";
import path from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { loadConfig, getGlobalCrabDir } from "@/config";
import { createProvider } from "@/api/core/provider";
import { writeJsonFile } from "@/core/utilities/fileUtils";
import { createLogger } from "@/core/logging/logger";
import type { AppConfigSchema } from "@/schema/config";

const log = createLogger("agent:generator");

/** 生成的 Agent 配置 Schema */
const generatedAgentSchema = z.object({
  /** Agent 唯一标识符(英文 kebab-case) */
  identifier: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z][a-z0-9-]*$/, "identifier 必须为小写字母开头，仅含小写字母、数字和连字符"),
  /** 何时使用此 Agent(中文描述) */
  whenToUse: z.string().min(10).max(500),
  /** 系统提示词 */
  systemPrompt: z.string().min(20).max(8000),
  /** 执行模式 */
  mode: z.enum(["primary", "subagent", "all"]),
  /** 权限级别 */
  permission: z.enum(["read-only", "read-write", "full-access"]),
});

export type GeneratedAgentConfig = z.infer<typeof generatedAgentSchema>;

/** 权限级别到 PermissionRule 的映射 */
const PERMISSION_RULE_MAP: Record<
  GeneratedAgentConfig["permission"],
  Array<{ action: "allow" | "deny" | "ask"; pattern: string; permission: string }>
> = {
  "read-only": [
    { action: "allow", pattern: "read", permission: "file" },
    { action: "allow", pattern: "read", permission: "bash" },
    { action: "deny", pattern: "write", permission: "file" },
    { action: "deny", pattern: "*", permission: "bash" },
  ],
  "read-write": [
    { action: "allow", pattern: "*", permission: "file" },
    { action: "allow", pattern: "read", permission: "bash" },
    { action: "ask", pattern: "*", permission: "bash" },
  ],
  "full-access": [
    { action: "allow", pattern: "*", permission: "file" },
    { action: "allow", pattern: "*", permission: "bash" },
    { action: "allow", pattern: "*", permission: "web" },
  ],
};

/**
 * 解析 LLM 模型实例。
 * 从应用配置的 defaultProvider 创建模型。
 */
async function resolveModel(config: AppConfigSchema) {
  const { provider: providerId, model: modelId } = config.defaultProvider;
  if (!providerId || !modelId) {
    throw new Error("未配置默认 Provider 和模型，请先运行 crab setup");
  }
  const getModel = createProvider(config, providerId, modelId);
  return getModel(modelId);
}

/**
 * 通过自然语言描述生成 Agent 配置。
 *
 * @param description - Agent 的自然语言描述
 * @param config - 可选的应用配置(不传则自动加载)
 * @returns 生成的 Agent 配置
 */
export async function generateAgent(description: string, config?: AppConfigSchema): Promise<GeneratedAgentConfig> {
  const appConfig = config ?? (await loadConfig());
  const model = await resolveModel(appConfig);

  log.info(`开始生成 Agent，描述: ${description.slice(0, 100)}...`);

  const systemPrompt = `你是一个 Agent 配置生成器。根据用户的自然语言描述，生成一个结构化的 Agent 配置。

要求:
1. identifier: 英文 kebab-case 格式，简洁且唯一(如 "python-tester"、"code-reviewer")
2. whenToUse: 中文描述何时应该使用此 Agent(10-500 字)
3. systemPrompt: 完整的系统提示词，定义 Agent 的角色、能力、行为规范(至少 20 字)
4. mode: 
   - "primary" = 主 Agent，可独立运行
   - "subagent" = 子 Agent，由主 Agent 调度
   - "all" = 两种模式均可
5. permission: 权限级别
   - "read-only" = 仅可读取文件和执行只读命令
   - "read-write" = 可读写文件，执行命令需确认
   - "full-access" = 完全访问权限

系统提示词应包含:
- Agent 的角色定位
- 核心能力描述
- 行为规范和约束
- 输出格式要求(如有)

请用中文编写 whenToUse 和 systemPrompt。`;

  const result = await generateObject({
    model,
    system: systemPrompt,
    prompt: description,
    schema: generatedAgentSchema,
    temperature: 0.7,
  });

  log.info(`Agent 生成完成: ${result.object.identifier}`);
  return result.object;
}

/**
 * 将生成的 Agent 配置写入文件。
 *
 * @param agentConfig - 生成的 Agent 配置
 * @returns 写入的文件路径
 */
export async function saveGeneratedAgent(agentConfig: GeneratedAgentConfig): Promise<string> {
  const agentsDir = path.join(getGlobalCrabDir(), "agents");

  // 确保目录存在
  if (!existsSync(agentsDir)) {
    mkdirSync(agentsDir, { recursive: true });
  }

  const filePath = path.join(agentsDir, `${agentConfig.identifier}.json`);

  // 构建完整的 Agent 配置文件(兼容 roles.json 格式)
  const configFile = {
    id: agentConfig.identifier,
    name: agentConfig.identifier,
    description: agentConfig.whenToUse,
    systemPrompt: agentConfig.systemPrompt,
    mode: agentConfig.mode,
    permission: PERMISSION_RULE_MAP[agentConfig.permission],
    icon: "agent",
    tags: ["generated"],
  };

  const ok = await writeJsonFile(filePath, configFile);
  if (!ok) {
    throw new Error(`写入 Agent 配置文件失败: ${filePath}`);
  }

  log.info(`Agent 配置已保存: ${filePath}`);
  return filePath;
}

/**
 * CLI 命令入口 — `crab agent generate "描述"`。
 *
 * @param description - Agent 的自然语言描述
 */
export async function generateAgentCommand(description: string): Promise<void> {
  console.log(`\n正在生成 Agent...`);
  console.log(`描述: ${description}\n`);

  try {
    const agentConfig = await generateAgent(description);

    console.log(`生成结果:`);
    console.log(`  标识符: ${agentConfig.identifier}`);
    console.log(`  模式: ${agentConfig.mode}`);
    console.log(`  权限: ${agentConfig.permission}`);
    console.log(`  使用场景: ${agentConfig.whenToUse}`);
    console.log(
      `  系统提示词: ${agentConfig.systemPrompt.slice(0, 200)}${agentConfig.systemPrompt.length > 200 ? "..." : ""}`,
    );

    const filePath = await saveGeneratedAgent(agentConfig);

    console.log(`\n✓ Agent 已生成并保存`);
    console.log(`  文件: ${filePath}`);
    console.log(`\n重启 crab 后，Agent 将自动加载并可用`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n✗ 生成 Agent 失败: ${message}`);
    process.exit(1);
  }
}
