/**
 * Bash 输出摘要 Agent
 *
 * 职责:
 *   - 总结长命令输出的关键信息
 *   - 提取错误、警告和重要状态
 *   - 生成简洁的摘要供 AI 理解
 *   - 支持自定义长度阈值
 *
 * 模块功能:
 *   - registerBashSummaryAgent: 注册 Bash 摘要 Agent
 *   - summarizeBashOutput: 总结 Bash 命令输出
 *   - BashSummaryConfig: 摘要配置接口
 *   - BashSummaryResult: 摘要结果接口
 *
 * 使用场景:
 *   - 命令输出超过一定长度时自动触发
 *   - 帮助 AI 快速理解命令执行结果
 *   - 处理复杂的命令行输出
 *   - 提取关键错误和警告信息
 *
 * 边界:
 *   1. 仅对命令输出进行摘要，不执行实际的命令
 *   2. 依赖 LLM 进行内容分析，需要有效的 LLM 配置
 *   3. 默认长度阈值为 2000 字符
 *   4. 最大摘要长度默认为 500 字符
 *
 * 流程:
 *   1. 接收命令输出和配置
 *   2. 检查输出长度是否超过阈值
 *   3. 构建摘要提示词，包含命令输出
 *   4. 调用 LLM 生成摘要
 *   5. 返回摘要结果
 */

import { createLogger } from "@/core/logging/logger";
import { completeLlm } from "@/api";
import type { ModelMessage } from "ai";
import type { AppConfigSchema } from "@/schema/config";
import { registerBuiltinAgent } from "./registry";

const log = createLogger("agent:bash-summary");

/** 摘要配置 */
export interface BashSummaryConfig {
  /** 触发摘要的长度阈值(字符数)，默认 2000 */
  lengthThreshold: number;
  /** 最大摘要长度(字符数)，默认 500 */
  maxSummaryLength: number;
  /** 是否提取错误信息，默认 true */
  extractErrors: boolean;
}

/** 默认配置 */
const DEFAULT_CONFIG: BashSummaryConfig = {
  extractErrors: true,
  lengthThreshold: 2000,
  maxSummaryLength: 500,
};

/** 摘要结果 */
export interface BashSummaryResult {
  /** 是否成功生成摘要 */
  success: boolean;
  /** 摘要内容 */
  summary: string;
  /** 提取的错误信息 */
  errors?: string[];
  /** 原始输出长度 */
  originalLength: number;
  /** 摘要长度 */
  summaryLength: number;
  /** 是否被截断 */
  truncated: boolean;
  /** 错误信息 */
  error?: string;
}

/**
 * 判断是否需要摘要
 */
export function shouldSummarize(output: string, config?: Partial<BashSummaryConfig>): boolean {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  return output.length > cfg.lengthThreshold;
}

/**
 * 生成 Bash 输出摘要
 */
export async function summarizeBashOutput(
  config: AppConfigSchema,
  command: string,
  output: string,
  configOverrides?: Partial<BashSummaryConfig>,
): Promise<BashSummaryResult> {
  const cfg = { ...DEFAULT_CONFIG, ...configOverrides };
  const originalLength = output.length;

  log.debug(`开始生成 Bash 输出摘要`, { command: command.slice(0, 100), outputLength: originalLength });

  // 如果输出不够长，直接返回
  if (!shouldSummarize(output, cfg)) {
    return {
      originalLength,
      success: true,
      summary: output,
      summaryLength: originalLength,
      truncated: false,
    };
  }

  try {
    // 构建提示词
    const messages: ModelMessage[] = [
      {
        content: `你是一个命令输出摘要专家。你的任务是将长命令输出总结为简洁的摘要。

## 摘要原则
1. 提取关键信息:执行结果、重要状态、错误和警告
2. 保留具体细节:文件路径、错误消息、版本号等
3. 结构化呈现:使用 bullet points 组织信息
4. 控制长度:摘要不超过 ${cfg.maxSummaryLength} 字符

## 输出格式
- 执行结果:成功/失败/部分成功
- 关键发现:3-5 个要点
- 错误/警告:如有则列出
- 建议:如有必要给出后续操作建议`,
        role: "system",
      },
      {
        content: `请总结以下命令的输出:

**命令**: \`\`\`\n${command}\n\`\`\`

**输出**: \`\`\`\n${output.slice(0, 8000)}\n\`\`\`

${output.length > 8000 ? "\n(输出已截断，仅显示前 8000 字符)" : ""}`,
        role: "user",
      },
    ];

    // 调用 AI 生成摘要
    const { text: summary } = await completeLlm(config, messages, {
      maxTokens: cfg.maxSummaryLength * 2,
      temperature: 0.3,
    });

    let finalSummary = summary.trim();
    let truncated = false;

    // 截断过长的摘要
    if (finalSummary.length > cfg.maxSummaryLength) {
      finalSummary = `${finalSummary.slice(0, cfg.maxSummaryLength)}\n... (摘要已截断)`;
      truncated = true;
    }

    // 提取错误信息
    let errors: string[] | undefined;
    if (cfg.extractErrors) {
      errors = extractErrors(output);
    }

    log.info(`Bash 输出摘要生成完成`, {
      errorCount: errors?.length ?? 0,
      originalLength,
      summaryLength: finalSummary.length,
      truncated,
    });

    return {
      errors,
      originalLength,
      success: true,
      summary: finalSummary,
      summaryLength: finalSummary.length,
      truncated,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error(`生成 Bash 输出摘要失败`, { error: errorMsg });

    // 失败时返回原始输出的截断版本
    return {
      error: errorMsg,
      originalLength,
      success: false,
      summary: `${output.slice(0, cfg.maxSummaryLength)}\n... (摘要生成失败，显示原始输出)`,
      summaryLength: Math.min(originalLength, cfg.maxSummaryLength),
      truncated: originalLength > cfg.maxSummaryLength,
    };
  }
}

/**
 * 从输出中提取错误信息
 */
function extractErrors(output: string): string[] {
  const errors: string[] = [];
  const lines = output.split("\n");

  // 错误模式匹配
  const errorPatterns = [
    /error[:\s]/i,
    /exception[:\s]/i,
    /failed[:\s]/i,
    /failure[:\s]/i,
    /fatal[:\s]/i,
    /panic[:\s]/i,
    /traceback/i,
    /cannot\s/i,
    /could\snot\s/i,
    /unable\sto\s/i,
    /permission\sdenied/i,
    /no\ssuch\sfile/i,
    /command\snot\sfound/i,
    /exit\sstatus\s\d+/i,
    /npm\sERR!/i,
    /yarn\serror/i,
    /pnpm\sERR!/i,
  ];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    for (const pattern of errorPatterns) {
      if (pattern.test(trimmed)) {
        errors.push(trimmed);
        break;
      }
    }
  }

  // 去重并限制数量
  return [...new Set(errors)].slice(0, 10);
}

/**
 * 快速摘要(不使用 AI，仅提取关键行)
 */
export function quickSummarize(output: string, maxLines: number = 20): string {
  const lines = output.split("\n");

  // 提取关键行
  const keyLines: string[] = [];

  // 添加前 N 行
  keyLines.push(...lines.slice(0, Math.min(5, lines.length)));

  // 查找包含关键信息的行
  const keywords = ["error", "warning", "success", "complete", "done", "finished", "result", "summary"];
  for (const line of lines) {
    if (keyLines.length >= maxLines) {
      break;
    }
    const lower = line.toLowerCase();
    if (keywords.some((k) => lower.includes(k)) && !keyLines.includes(line)) {
      keyLines.push(line);
    }
  }

  // 添加后 N 行(通常是结果总结)
  if (lines.length > 10) {
    const endLines = lines.slice(-5);
    for (const line of endLines) {
      if (keyLines.length >= maxLines) {
        break;
      }
      if (!keyLines.includes(line)) {
        keyLines.push(line);
      }
    }
  }

  return keyLines.join("\n");
}

/**
 * 注册 Bash 摘要 Agent 到 AgentManager
 */
export function registerBashSummaryAgent(): void {
  registerBuiltinAgent({
    allowedTools: [],
    description: "总结长命令输出的关键信息，提取错误和状态",
    hidden: true,
    label: "Bash 输出摘要",
    name: "bash-summary",
    prompt: `你是一个 Bash 输出摘要专家。你的任务是将长命令输出总结为简洁的摘要。

## 摘要原则
1. 提取关键信息:执行结果、重要状态、错误和警告
2. 保留具体细节:文件路径、错误消息、版本号等
3. 结构化呈现:使用 bullet points 组织信息
4. 控制长度:摘要简洁明了

## 输出格式
- 执行结果:成功/失败/部分成功
- 关键发现:3-5 个要点
- 错误/警告:如有则列出
- 建议:如有必要给出后续操作建议

## 降级规则
- 输出为空或仅含空白字符：返回「命令无输出」
- 输出为纯错误堆栈：提取错误类型和关键信息，忽略重复堆栈帧
- 输出为二进制/乱码：说明「输出包含非文本内容，无法摘要」
- 单行输出且不足 50 字：直接返回原内容`,
  });
}
