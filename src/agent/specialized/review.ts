/**
 * 审查 Agent (Git Diff Review)
 *
 * 职责:
 *   - 审查 Git diff 代码变更
 *   - 发现潜在问题、代码异味、安全风险
 *   - 提供改进建议
 *   - 支持多种审查范围(staged/unstaged/commit/branch)
 *
 * 模块功能:
 *   - registerReviewAgent: 注册审查 Agent
 *   - reviewGitDiff: 审查 Git diff
 *   - ReviewConfig: 审查配置接口
 *   - ReviewResult: 审查结果接口
 *   - ReviewIssue: 审查问题接口
 *
 * 使用场景:
 *   - /review 命令调用
 *   - 代码提交前审查
 *   - PR 审查辅助
 *   - 代码质量检查
 *
 * 边界:
 *   1. 仅审查 Git diff，不执行实际的代码修改
 *   2. 依赖 LLM 进行代码分析，需要有效的 LLM 配置
 *   3. 通过 Git 命令获取 diff，需要有效的 Git 仓库
 *   4. 支持的最大 diff 大小受 LLM 上下文限制
 *
 * 流程:
 *   1. 根据配置获取 Git diff
 *   2. 构建审查提示词，包含 diff 内容
 *   3. 调用 LLM 进行代码审查
 *   4. 解析审查结果，提取问题列表
 *   5. 返回审查结果和改进建议
 */

import { createLogger } from "@/core/logging/logger";
import { iconError, iconLsp, iconSuccess, iconWarning } from "@/core/icons/icon";
import { completeLlm } from "@/api";
import type { ModelMessage } from "ai";
import type { AppConfigSchema } from "@/schema/config";
import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";
import { createUserError } from "@/core/errors/appError";
import { registerReviewAgent } from "./reviewAgent";

const log = createLogger("agent:review");

export { registerReviewAgent };

/** 审查配置 */
export interface ReviewConfig {
  /** 审查范围:staged、unstaged、commit、branch */
  scope: "staged" | "unstaged" | "commit" | "branch" | "all";
  /** 目标(commit hash 或 branch name) */
  target?: string;
  /** 是否包含详细建议，默认 true */
  detailed: boolean;
  /** 是否检查安全 issues，默认 true */
  checkSecurity: boolean;
  /** 是否检查性能 issues，默认 true */
  checkPerformance: boolean;
}

/** 默认配置 */
const DEFAULT_CONFIG: ReviewConfig = {
  checkPerformance: true,
  checkSecurity: true,
  detailed: true,
  scope: "staged",
};

/** 审查发现的问题 */
export interface ReviewIssue {
  /** 严重程度 */
  severity: "critical" | "major" | "minor" | "info";
  /** 问题类型 */
  type: "bug" | "security" | "performance" | "style" | "maintainability" | "other";
  /** 文件路径 */
  filePath: string;
  /** 行号 */
  line?: number;
  /** 问题描述 */
  description: string;
  /** 建议修复 */
  suggestion?: string;
  /** 相关代码 */
  codeSnippet?: string;
}

/** 审查结果 */
export interface ReviewResult {
  /** 是否成功 */
  success: boolean;
  /** 审查范围描述 */
  scope: string;
  /** 发现的问题列表 */
  issues: ReviewIssue[];
  /** 问题统计 */
  stats: {
    critical: number;
    major: number;
    minor: number;
    info: number;
    total: number;
  };
  /** 总体评价 */
  summary: string;
  /** 错误信息 */
  error?: string;
}

/**
 * 执行代码审查
 */
export async function reviewCode(config: AppConfigSchema, reviewConfig?: Partial<ReviewConfig>): Promise<ReviewResult> {
  const cfg = { ...DEFAULT_CONFIG, ...reviewConfig };

  log.debug(`开始代码审查`, { scope: cfg.scope, target: cfg.target });

  try {
    // 获取 diff
    const diff = getGitDiff(cfg.scope, cfg.target);
    if (!diff.trim()) {
      return {
        issues: [],
        scope: formatScope(cfg.scope, cfg.target),
        stats: { critical: 0, info: 0, major: 0, minor: 0, total: 0 },
        success: true,
        summary: "没有检测到代码变更",
      };
    }

    // 如果 diff 太大，可能需要分批处理
    const maxDiffLength = 10_000;
    const truncatedDiff = diff.length > maxDiffLength ? `${diff.slice(0, maxDiffLength)}\n... (diff 已截断)` : diff;

    // 构建审查提示词
    const messages: ModelMessage[] = [
      {
        content: buildReviewPrompt(cfg),
        role: "system",
      },
      {
        content: `请审查以下代码变更:

\`\`\`diff
${truncatedDiff}
\`\`\`

${diff.length > maxDiffLength ? `\n(注:diff 已截断，原始长度 ${diff.length} 字符)` : ""}

请返回 JSON 格式的审查结果:
{
  "summary": "总体评价",
  "issues": [
    {
      "severity": "critical|major|minor|info",
      "type": "bug|security|performance|style|maintainability|other",
      "filePath": "文件路径",
      "line": 行号,
      "description": "问题描述",
      "suggestion": "建议修复",
      "codeSnippet": "相关代码"
    }
  ]
}`,
        role: "user",
      },
    ];

    // 调用 AI 进行审查
    const { text: response } = await completeLlm(config, messages, {
      maxTokens: 4000,
      temperature: 0.2,
    });

    // 解析审查结果
    const reviewData = parseReviewResponse(response);

    // 计算统计
    const stats = calculateStats(reviewData.issues);

    log.info(`代码审查完成`, {
      issueCount: reviewData.issues.length,
      scope: cfg.scope,
      ...stats,
    });

    return {
      issues: reviewData.issues,
      scope: formatScope(cfg.scope, cfg.target),
      stats,
      success: true,
      summary: reviewData.summary,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error(`代码审查失败`, { error: errorMsg });

    return {
      error: errorMsg,
      issues: [],
      scope: formatScope(cfg.scope, cfg.target),
      stats: { critical: 0, info: 0, major: 0, minor: 0, total: 0 },
      success: false,
      summary: "审查失败",
    };
  }
}

/**
 * 获取 Git diff
 */
function getGitDiff(scope: ReviewConfig["scope"], target?: string): string {
  const cwd = process.cwd();
  const gitDir = resolve(cwd, ".git");

  if (!existsSync(gitDir)) {
    throw createUserError("INVALID_INPUT", "当前目录不是 Git 仓库", {
      context: { cwd },
    });
  }

  const execOpts = { cwd, encoding: "utf8" as const, maxBuffer: 10 * 1024 * 1024 };

  try {
    switch (scope) {
      case "staged":
        return execFileSync("git", ["diff", "--staged"], execOpts);
      case "unstaged":
        return execFileSync("git", ["diff"], execOpts);
      case "commit": {
        if (!target) {
          throw createUserError("MISSING_PARAMETER", "commit 范围需要提供 target (commit hash)");
        }
        if (!/^[a-f0-9]{7,40}$/i.test(target)) {
          throw createUserError("INVALID_INPUT", `非法的 commit hash: ${target}`);
        }
        return execFileSync("git", ["show", target, "--patch"], execOpts);
      }
      case "branch": {
        if (!target) {
          throw createUserError("MISSING_PARAMETER", "branch 范围需要提供 target (branch name)");
        }
        return execFileSync("git", ["diff", `${target}...HEAD`], execOpts);
      }
      case "all":
        return execFileSync("git", ["diff", "HEAD"], execOpts);
      default:
        return execFileSync("git", ["diff", "--staged"], execOpts);
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    if (errMsg.includes("No diff") || errMsg.includes("no diff") || errMsg.includes("unknown revision")) {
      return "";
    }
    log.error(`获取 git diff 失败`, { scope, target, error: errMsg });
    throw createUserError("INVALID_INPUT", `获取 git diff 失败: ${errMsg}`);
  }
}

/**
 * 构建审查提示词
 */
function buildReviewPrompt(config: ReviewConfig): string {
  const checks: string[] = [
    "代码正确性:是否存在逻辑错误、边界条件问题",
    "代码可读性:命名是否清晰、结构是否合理",
    "代码风格:是否符合项目约定",
  ];

  if (config.checkSecurity) {
    checks.push("安全性:是否存在注入、XSS、敏感信息泄露、不安全的正则表达式等安全问题");
  }

  if (config.checkPerformance) {
    checks.push("性能:是否存在 N+1 查询、内存泄漏、不必要的计算、低效算法等性能问题");
  }

  return `你是一个专业的代码审查专家。请审查 Git diff 中的代码变更。

## 审查维度
${checks.map((c, i) => `${i + 1}. ${c}`).join("\n")}

## 严重程度定义
- critical:必须立即修复的严重问题(安全漏洞、数据丢失风险)
- major:建议修复的重要问题(潜在 bug、性能问题)
- minor:可选优化(代码风格、小改进)
- info:信息性提示(建议、注意事项)

## 问题类型
- bug:逻辑错误、边界条件问题
- security:安全问题
- performance:性能问题
- style:代码风格问题
- maintainability:可维护性问题
- other:其他

## 输出要求
1. 只返回 JSON 格式，不要其他内容
2. 每个问题必须包含 filePath 和 description
3. 如果代码没有问题，返回空 issues 数组
4. summary 提供总体评价(1-2 句话)`;
}

/**
 * 格式化审查范围描述
 */
function formatScope(scope: ReviewConfig["scope"], target?: string): string {
  switch (scope) {
    case "staged": {
      return "暂存区变更";
    }
    case "unstaged": {
      return "未暂存变更";
    }
    case "commit": {
      return `提交 ${target || "HEAD"}`;
    }
    case "branch": {
      return `分支 ${target || "main"} 对比`;
    }
    case "all": {
      return "所有变更";
    }
    default: {
      return "未知范围";
    }
  }
}

/**
 * 解析审查响应
 */
/** LLM 原始 issue 形态(宽松,字段别名不固定) */
interface RawLLMReviewIssue {
  severity?: string;
  codeSnippet?: string;
  code?: string;
  description?: string;
  message?: string;
  filePath?: string;
  file?: string;
  line?: number;
  suggestion?: string;
  fix?: string;
  type?: string;
}

function parseReviewResponse(content: string): { summary: string; issues: ReviewIssue[] } {
  try {
    // 尝试提取 JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      return {
        issues: (data.issues || []).map((issue: RawLLMReviewIssue) => ({
          codeSnippet: issue.codeSnippet || issue.code,
          description: issue.description || issue.message || "",
          filePath: issue.filePath || issue.file || "unknown",
          line: issue.line,
          severity: issue.severity || "info",
          suggestion: issue.suggestion || issue.fix,
          type: issue.type || "other",
        })),
        summary: data.summary || "审查完成",
      };
    }
  } catch (error) {
    log.warn(`解析审查响应失败`, { content: content.slice(0, 200), error: String(error) });
  }

  // 解析失败时返回空结果
  return { issues: [], summary: "解析审查结果失败" };
}

/**
 * 计算问题统计
 */
function calculateStats(issues: ReviewIssue[]): ReviewResult["stats"] {
  const stats = { critical: 0, info: 0, major: 0, minor: 0, total: issues.length };

  for (const issue of issues) {
    switch (issue.severity) {
      case "critical": {
        stats.critical++;
        break;
      }
      case "major": {
        stats.major++;
        break;
      }
      case "minor": {
        stats.minor++;
        break;
      }
      case "info": {
        stats.info++;
        break;
      }
    }
  }

  return stats;
}

/**
 * 格式化审查结果为 Markdown
 */
export function formatReviewResult(result: ReviewResult): string {
  const lines: string[] = [];

  lines.push(`# 代码审查报告`);
  lines.push("");
  lines.push(`**审查范围**: ${result.scope}`);
  lines.push("");

  if (!result.success) {
    lines.push(`${iconError} **审查失败**: ${result.error}`);
    return lines.join("\n");
  }

  // 总体评价
  lines.push(`## 总体评价`);
  lines.push(result.summary);
  lines.push("");

  // 统计
  lines.push(`## 问题统计`);
  lines.push(`- ${iconError} Critical: ${result.stats.critical}`);
  lines.push(`- ${iconWarning} Major: ${result.stats.major}`);
  lines.push(`- ${iconWarning} Minor: ${result.stats.minor}`);
  lines.push(`- ${iconLsp} Info: ${result.stats.info}`);
  lines.push(`- **总计**: ${result.stats.total}`);
  lines.push("");

  // 问题列表
  if (result.issues.length > 0) {
    lines.push(`## 发现的问题`);
    lines.push("");

    const severityOrder = ["critical", "major", "minor", "info"] as const;
    for (const severity of severityOrder) {
      const issues = result.issues.filter((i) => i.severity === severity);
      if (issues.length === 0) {
        continue;
      }

      const severityEmoji = {
        critical: iconError,
        info: iconLsp,
        major: iconWarning,
        minor: iconWarning,
      }[severity];

      lines.push(`### ${severityEmoji} ${severity.toUpperCase()} (${issues.length})`);
      lines.push("");

      for (const issue of issues) {
        lines.push(`**${issue.filePath}${issue.line ? `:${issue.line}` : ""}**`);
        lines.push(`- 类型: ${issue.type}`);
        lines.push(`- 描述: ${issue.description}`);
        if (issue.suggestion) {
          lines.push(`- 建议: ${issue.suggestion}`);
        }
        if (issue.codeSnippet) {
          lines.push("- 代码:");
          lines.push("  ```");
          lines.push(
            issue.codeSnippet
              .split("\n")
              .map((l) => `  ${l}`)
              .join("\n"),
          );
          lines.push("  ```");
        }
        lines.push("");
      }
    }
  } else {
    lines.push(`${iconSuccess} **未发现明显问题**`);
  }

  return lines.join("\n");
}
