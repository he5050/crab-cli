/**
 * 子代理默认禁止工具清单。
 *
 * 保持为无依赖模块，供 permissions/yolo 共享，避免运行时循环依赖。
 */

/** 子代理禁止使用的工具(高风险操作) */
export const SUBAGENT_DENIED_TOOLS = [
  "bash-execute",
  "bash-run",
  "terminal-execute",
  "shell-exec",
  "cmd-run",
  "powershell-execute",
];

export const SUBAGENT_DENIED_TOOL_SET = new Set(SUBAGENT_DENIED_TOOLS);
