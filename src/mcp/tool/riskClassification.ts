/**
 * MCP 工具风险分类 — 单一事实源。
 *
 * 职责:
 *   - 按工具名模式判定 MCP 工具的风险等级
 *   - 将风险等级映射为内部 permission 命名空间
 *
 * 模块功能:
 *   - McpToolRisk: 风险等级类型
 *   - classifyMcpToolRisk: 工具名 → 风险等级
 *   - getMcpToolPermissionNamespace: 风险等级 → permission 命名空间
 *   - HIGH_RISK_PATTERNS / MEDIUM_RISK_PATTERNS: 风险匹配正则
 *
 * 使用场景:
 *   - toolConverter: 为转换后的工具生成 permission 命名空间
 *   - mcpManager: trust boundary 审计日志(high/medium 提示)
 *
 * 边界:
 *   1. 仅按工具名(不含 server 前缀)做风险判定
 *   2. 风险等级三分:high / medium / low
 *   3. permission 命名空间映射:high → mcp.sensitive.*，其余 → mcp.*
 *   4. 与 permissionsConfig 中 `mcp.sensitive.* → deny` 规则协同
 *
 * 流程:
 *   1. 调用方传入 tool.name(不带 server 前缀)
 *   2. classifyMcpToolRisk 匹配 high/medium 模式，否则 low
 *   3. 调用方可基于 risk 选择是否打日志或走 sensitive 命名空间
 */

export type McpToolRisk = "high" | "medium" | "low";

/** 高风险工具名模式(命令执行、文件删除、磁盘格式化等) */
export const HIGH_RISK_PATTERNS =
  /^(exec|execute|shell|command|run|eval|system|ssh|delete_file|remove|drop|truncate|format_disk)/i;

/** 中风险工具名模式(写入、修改、上传/下载等) */
export const MEDIUM_RISK_PATTERNS = /^(write|create|update|modify|send|upload|download|fetch|http|scp)/i;

/**
 * 按工具名(不含 server 前缀)判定 MCP 工具风险等级。
 */
export function classifyMcpToolRisk(toolName: string): McpToolRisk {
  if (HIGH_RISK_PATTERNS.test(toolName)) {
    return "high";
  }
  if (MEDIUM_RISK_PATTERNS.test(toolName)) {
    return "medium";
  }
  return "low";
}

/**
 * 将风险等级映射为内部 permission 命名空间。
 *
 * - high → `mcp.sensitive.${serverName}.${toolName}`(命中默认 deny 规则)
 * - medium / low → `mcp.${serverName}.${toolName}`(默认 ask 规则)
 */
export function getMcpToolPermissionNamespace(risk: McpToolRisk, serverName: string, toolName: string): string {
  return risk === "high" ? `mcp.sensitive.${serverName}.${toolName}` : `mcp.${serverName}.${toolName}`;
}
