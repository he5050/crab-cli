/**
 * 工具名匹配器。
 *
 * 职责:
 *   - 统一处理工具白名单匹配规则
 *   - 支持精确、前缀、后缀和全量通配
 *   - 兼容 `_` / `-` 两种命名风格
 */
import { getBuiltinPrefixes } from "./builtinToolPrefixes";

/**
 * 判断 toolName 是否匹配 allowedTool。
 *
 * 支持:
 *   - `*`:匹配全部
 *   - 精确匹配
 *   - 前缀匹配:`filesystem-` → `filesystem-read`
 *   - 外部/MCP 后缀匹配:`mytool` → `server-mytool`，`create_issue` → `github_create_issue`
 */
/** toolNameMatches 的实现 */
export function toolNameMatches(toolName: string, allowedTool: string): boolean {
  if (allowedTool === "*") {
    return true;
  }

  const normalizedTool = toolName.replace(/_/g, "-");
  const normalizedAllowed = allowedTool.replace(/_/g, "-");

  if (normalizedTool === normalizedAllowed) {
    return true;
  }

  if (normalizedAllowed.endsWith("-") && normalizedTool.startsWith(normalizedAllowed)) {
    return true;
  }

  if (normalizedTool.startsWith(`${normalizedAllowed}-`)) {
    return true;
  }

  const isExternalTool = ![...getBuiltinPrefixes()].some((prefix) => normalizedTool.startsWith(prefix));

  if (isExternalTool && normalizedTool.endsWith(`-${normalizedAllowed}`)) {
    return true;
  }

  return false;
}
