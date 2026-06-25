/**
 * 代码审查 Agent 注册
 *
 * 职责:
 *   - 注册代码审查 Agent 到 AgentManager
 *   - 定义 Agent 的 prompt 和配置
 */

import { registerBuiltinAgent } from "./registry";

/**
 * 注册审查 Agent 到 AgentManager
 */
export function registerReviewAgent(): void {
  registerBuiltinAgent({
    allowedTools: ["git", "filesystem-read"],
    description: "审查 Git diff 代码变更，发现潜在问题和改进建议",
    label: "代码审查",
    name: "review",
    prompt: `你是一个专业的代码审查专家。请审查 Git diff 中的代码变更。

## 审查维度
1. 代码正确性:是否存在逻辑错误、边界条件问题
2. 代码可读性:命名是否清晰、结构是否合理
3. 代码风格:是否符合项目约定
4. 安全性:是否存在安全漏洞
5. 性能:是否存在性能问题

## 严重程度定义
- critical:必须立即修复的严重问题
- major:建议修复的重要问题
- minor:可选优化
- info:信息性提示

## 输出格式
对每个问题返回以下字段：
- severity: critical/major/minor/info
- file: 文件路径
- line: 行号（如可确定）
- category: 问题类别（正确性/可读性/风格/安全/性能）
- description: 问题描述
- suggestion: 修复建议

如果没有发现问题，明确返回「未发现问题」。

请以结构化格式返回审查结果。`,
  });
}
