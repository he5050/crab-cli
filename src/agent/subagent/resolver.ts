/**
 * 子代理解析器
 *
 * 职责:
 *   - 解析用户请求，确定是否需要子代理
 *   - 选择合适的子代理类型
 *   - 构建子代理初始上下文
 *   - 处理子代理结果
 *   - 支持关键词快速匹配和 AI 深度解析
 *
 * 模块功能:
 *   - resolveSubAgent: 解析用户请求
 *   - buildSubAgentContext: 构建子代理初始上下文
 *   - registerSubAgentResolver: 注册子代理解析器
 *   - SubAgentType: 子代理类型定义
 *   - SubAgentPriority: 子代理优先级类型
 *   - ResolveResult: 解析结果接口
 *   - ResolverConfig: 解析配置接口
 *
 * 使用场景:
 *   - 复杂任务分解
 *   - 专业化任务路由
 *   - 并行任务执行
 *   - 动态子代理选择
 *
 * 边界:
 *   1. 仅负责解析和推荐，不实际执行子代理
 *   2. 支持关键词匹配和 AI 解析两种模式
 *   3. 默认置信度阈值为 0.6
 *   4. AI 解析需要有效的 LLM 配置
 *
 * 流程:
 *   1. 接收用户请求和上下文
 *   2. 先进行关键词快速匹配
 *   3. 如果匹配置信度足够高，直接返回结果
 *   4. 否则如果启用 AI 解析，调用 LLM 进行深度分析
 *   5. 解析 AI 返回的 JSON 结果
 *   6. 返回 ResolveResult 包含推荐的子代理类型和配置
 */

import { createLogger } from "@/core/logging/logger";
import { completeLlm } from "@/api";
import type { ModelMessage } from "ai";
import type { AppConfigSchema } from "@/schema/config";
import {
  BUILTIN_AGENT_NAMES,
  type BuiltinAgentName,
  getBuiltinAgentDefinition,
  listBuiltinAgentDefinitions,
} from "@/agent/core/definition";
import { listSubagents } from "@/agent/core/manager";

const log = createLogger("agent:sub-agent-resolver");

const subAgentResolverDeps = {
  completeLlm,
  loadConfig: () => import("@config").then((m) => m.loadConfig()),
};

export function __setSubAgentResolverDepsForTesting(overrides: Partial<typeof subAgentResolverDeps>): void {
  Object.assign(subAgentResolverDeps, overrides);
}

export function __resetSubAgentResolverDepsForTesting(): void {
  subAgentResolverDeps.completeLlm = completeLlm;
  subAgentResolverDeps.loadConfig = () => import("@config").then((m) => m.loadConfig());
  // Clear agent descriptions cache so newly registered agents are picked up
  _agentDescriptionsCache = null;
}

/** 子代理类型 */
export type SubAgentType = string;

/** 子代理优先级 */
export type SubAgentPriority = "low" | "medium" | "high" | "critical";

/** 解析结果 */
export interface ResolveResult {
  /** 是否需要子代理 */
  needsSubAgent: boolean;
  /** 推荐的子代理类型 */
  agentType: SubAgentType;
  /** 置信度(0-1) */
  confidence: number;
  /** 任务描述 */
  taskDescription: string;
  /** 所需工具列表 */
  requiredTools: string[];
  /** 预估复杂度(1-10) */
  complexity: number;
  /** 优先级 */
  priority: SubAgentPriority;
  /** 理由 */
  reason: string;
  /** 初始上下文 */
  initialContext?: string;
}

/** 解析配置 */
export interface ResolverConfig {
  /** 可用的子代理类型列表 */
  availableAgents: SubAgentType[];
  /** 置信度阈值，默认 0.6 */
  confidenceThreshold: number;
  /** 是否使用 AI 解析，默认 true */
  useAI: boolean;
  /** 最大 token 数，默认 4000 */
  maxTokens: number;
}

/** 默认配置 */
const DEFAULT_CONFIG: ResolverConfig = {
  availableAgents: [...BUILTIN_AGENT_NAMES],
  confidenceThreshold: 0.6,
  maxTokens: 4000,
  useAI: true,
};

interface AgentDesc {
  name: string;
  description: string;
  keywords: string[];
  defaultTools?: string[];
}

let _agentDescriptionsCache: Record<string, AgentDesc> | null = null;

function buildAgentDescriptions(): Record<string, AgentDesc> {
  if (_agentDescriptionsCache) {
    return _agentDescriptionsCache;
  }

  const definitions = listBuiltinAgentDefinitions();
  const result: Record<string, AgentDesc> = {
    none: { description: "不需要子代理", keywords: [], name: "None" },
  };
  for (const def of definitions) {
    result[def.name] = {
      defaultTools: def.defaultTools,
      description: def.description,
      keywords: def.keywords ?? [],
      name: def.displayName,
    };
  }

  for (const agent of listSubagents()) {
    result[agent.name] = {
      defaultTools: agent.allowedTools,
      description: agent.description,
      keywords: agent.keywords ?? agent.tags ?? [],
      name: agent.label,
    };
  }

  _agentDescriptionsCache = result;
  return result;
}

function getAgentDesc(name: string): AgentDesc {
  return buildAgentDescriptions()[name] ?? buildAgentDescriptions()["none"]!;
}

/**
 * 基于关键词的快速匹配
 */
function quickMatch(
  request: string,
  availableAgents: SubAgentType[],
): {
  agentType: SubAgentType;
  score: number;
} {
  const lowerRequest = request.toLowerCase();
  let bestMatch: SubAgentType = "none";
  let bestScore = 0;

  for (const rawAgentType of availableAgents) {
    const agentType = normalizeAgentType(rawAgentType);
    if (agentType === "none") {
      continue;
    }

    const agent = getAgentDesc(agentType);
    let matchCount = 0;
    let score = 0;

    for (const keyword of new Set(agent.keywords)) {
      if (lowerRequest.includes(keyword.toLowerCase())) {
        matchCount++;
      }
    }

    if (matchCount > 0) {
      score = Math.min(0.95, 0.45 + matchCount * 0.2);
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = agentType;
    }
  }

  return { agentType: bestMatch, score: bestScore };
}

/**
 * 使用 AI 进行深度解析
 */
async function aiResolve(
  request: string,
  context: string,
  llmConfig: AppConfigSchema,
  resolverConfig: ResolverConfig,
): Promise<ResolveResult> {
  const availableAgentsList = resolverConfig.availableAgents
    .map((type) => normalizeAgentType(type))
    .filter((type) => type !== "none")
    .map((type) => {
      const agent = getAgentDesc(type);
      return `- ${type}: ${agent.description}\n  关键词: ${agent.keywords.slice(0, 5).join(", ")}...`;
    })
    .join("\n");

  const prompt = `你是一个智能任务解析器。请分析以下用户请求，确定是否需要子代理以及需要哪种类型的子代理。

## 可用的子代理类型
${availableAgentsList}

## 当前上下文
${context || "无额外上下文"}

## 用户请求
${request}

## 分析要求
1. 判断是否需要专门的子代理来处理这个请求
2. 如果需要，选择最合适的子代理类型
3. 评估任务复杂度(1-10分)
4. 确定优先级(low/medium/high/critical)
5. 列出所需的工具
6. 提供简短的理由

## 输出格式
请以 JSON 格式返回分析结果:
{
  "needsSubAgent": true/false,
  "agentType": "agent-type or none",
  "confidence": 0.0-1.0,
  "taskDescription": "任务描述",
  "requiredTools": ["tool1", "tool2"],
  "complexity": 1-10,
  "priority": "low/medium/high/critical",
  "reason": "选择理由"
}`;

  try {
    const messages: ModelMessage[] = [
      {
        content: prompt,
        role: "user",
      },
    ];

    const { text: result } = await subAgentResolverDeps.completeLlm(llmConfig, messages, {
      maxTokens: 500,
      modelId: llmConfig.defaultProvider?.model,
      temperature: 0.1,
    });

    if (!result) {
      return createDefaultResult(request, false);
    }

    // 尝试解析 JSON
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          agentType: validateAgentType(parsed.agentType) ? normalizeAgentType(parsed.agentType) : "none",
          complexity: typeof parsed.complexity === "number" ? Math.max(1, Math.min(10, parsed.complexity)) : 5,
          confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
          needsSubAgent: parsed.needsSubAgent ?? false,
          priority: validatePriority(parsed.priority) ? parsed.priority : "medium",
          reason: parsed.reason || "基于请求内容分析",
          requiredTools: Array.isArray(parsed.requiredTools) ? parsed.requiredTools : [],
          taskDescription: parsed.taskDescription || request.slice(0, 100),
        };
      } catch (error) {
        log.warn("解析 AI 响应失败", { content: result.slice(0, 200), error: String(error) });
      }
    }

    return createDefaultResult(request, false);
  } catch (error) {
    log.error("AI 解析失败", { error: String(error) });
    return createDefaultResult(request, false);
  }
}

/**
 * 验证子代理类型
 */
function validateAgentType(type: string): boolean {
  return type === "none" || Boolean(buildAgentDescriptions()[type]);
}

function normalizeAgentType(type: SubAgentType | string): SubAgentType {
  if (type === "none") {
    return "none";
  }
  if (buildAgentDescriptions()[type]) {
    return type;
  }
  return "none";
}

/**
 * 验证优先级
 */
function validatePriority(priority: string): boolean {
  return ["low", "medium", "high", "critical"].includes(priority);
}

/**
 * 创建默认解析结果
 */
function createDefaultResult(request: string, needsAgent: boolean): ResolveResult {
  return {
    agentType: "none",
    complexity: 5,
    confidence: 0.5,
    needsSubAgent: needsAgent,
    priority: "medium",
    reason: "无法确定合适的子代理",
    requiredTools: [],
    taskDescription: request.slice(0, 200),
  };
}

function createKeywordResult(request: string, agentType: SubAgentType, score: number): ResolveResult {
  const agent = getAgentDesc(agentType);
  return {
    agentType,
    complexity: estimateComplexity(request),
    confidence: Math.min(score * 1.2, 0.95),
    needsSubAgent: agentType !== "none",
    priority: estimatePriority(request),
    reason: agent ? `基于关键词匹配: ${agent.name}` : "基于关键词匹配",
    requiredTools: inferRequiredTools(agentType),
    taskDescription: request.slice(0, 200),
  };
}

/**
 * 解析用户请求
 */
export async function resolveSubAgent(
  request: string,
  context: string = "",
  partialConfig?: Partial<ResolverConfig>,
  llmConfig?: AppConfigSchema,
): Promise<ResolveResult> {
  const config: ResolverConfig = {
    ...DEFAULT_CONFIG,
    ...partialConfig,
  };
  config.availableAgents = [...new Set([...config.availableAgents, ...listSubagents().map((agent) => agent.name)])];

  try {
    // 快速关键词匹配
    const quickResult = quickMatch(request, config.availableAgents);

    // 如果快速匹配置信度足够高，直接返回
    if (quickResult.score >= config.confidenceThreshold && quickResult.agentType !== "none") {
      return createKeywordResult(request, quickResult.agentType, quickResult.score);
    }

    // 如果使用 AI 解析
    if (config.useAI) {
      const effectiveLlmConfig = llmConfig ?? (await subAgentResolverDeps.loadConfig().catch(() => undefined));
      if (effectiveLlmConfig) {
        const resolved = await aiResolve(request, context, effectiveLlmConfig, config);
        if (resolved.needsSubAgent || quickResult.agentType === "none") {
          return resolved;
        }
      }
    }

    if (quickResult.agentType !== "none") {
      return createKeywordResult(request, quickResult.agentType, quickResult.score);
    }

    // 否则返回默认结果
    return createDefaultResult(request, false);
  } catch (error) {
    log.error("解析请求失败", { error: String(error) });
    return createDefaultResult(request, false);
  }
}

/**
 * 推断所需工具
 */
function inferRequiredTools(agentType: SubAgentType): string[] {
  const normalized = normalizeAgentType(agentType);
  if (normalized === "none") {
    return [];
  }
  const def = getBuiltinAgentDefinition(normalized);
  return def?.defaultTools ?? getAgentDesc(normalized).defaultTools ?? [];
}

/**
 * 估算任务复杂度
 */
function estimateComplexity(request: string): number {
  const { length } = request;
  if (length < 50) {
    return 2;
  }
  if (length < 200) {
    return 4;
  }
  if (length < 500) {
    return 6;
  }
  if (length < 1000) {
    return 8;
  }
  return 10;
}

/**
 * 估算优先级
 */
function estimatePriority(request: string): SubAgentPriority {
  const lower = request.toLowerCase();

  // 紧急关键词
  if (
    lower.includes("紧急") ||
    lower.includes("urgent") ||
    lower.includes("critical") ||
    lower.includes("崩溃") ||
    lower.includes("crash")
  ) {
    return "critical";
  }

  // 高优先级关键词
  if (lower.includes("重要") || lower.includes("important") || lower.includes("优先") || lower.includes("priority")) {
    return "high";
  }

  // 低优先级关键词
  if (lower.includes("可选") || lower.includes("optional") || lower.includes("有空") || lower.includes("later")) {
    return "low";
  }

  return "medium";
}

/**
 * 构建子代理初始上下文
 */
export function buildSubAgentContext(
  resolveResult: ResolveResult,
  conversationHistory?: { role: string; content: string }[],
): string {
  const context: string[] = [
    `## 任务信息`,
    `- 任务类型: ${getAgentDesc(normalizeAgentType(resolveResult.agentType)).name || resolveResult.agentType}`,
    `- 复杂度: ${resolveResult.complexity}/10`,
    `- 优先级: ${resolveResult.priority}`,
    `- 置信度: ${(resolveResult.confidence * 100).toFixed(0)}%`,
    ``,
    `## 任务描述`,
    resolveResult.taskDescription,
    ``,
    `## 选择理由`,
    resolveResult.reason,
  ];

  if (resolveResult.requiredTools.length > 0) {
    context.push(``, `## 可用工具`, ...resolveResult.requiredTools.map((t) => `- ${t}`));
  }

  if (conversationHistory && conversationHistory.length > 0) {
    context.push(``, `## 对话历史摘要`);
    const recentMessages = conversationHistory.slice(-5);
    for (const msg of recentMessages) {
      const roleLabel = msg.role === "user" ? "用户" : "助手";
      context.push(`[${roleLabel}] ${msg.content.slice(0, 200)}`);
    }
  }

  return context.join("\n");
}

/**
 * 注册子代理解析器到 Agent 系统
 */
export function registerSubAgentResolver(): void {
  buildAgentDescriptions(); // 预热缓存
  log.info("子代理解析器已就绪");
}
