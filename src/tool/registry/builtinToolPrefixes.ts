/**
 * 内置工具前缀注册表 — 动态维护。
 *
 * 职责:
 *   - 维护所有内置工具名称前缀的集合
 *   - 提供 registerBuiltinPrefix() 供工具注册时自动提取前缀
 *   - 提供 getBuiltinPrefixes() 供 toolNameMatcher 查询
 *
 * 自声明机制:
 *   - 工具定义时设置 builtin: true
 *   - registerTool() 检测到 builtin 标志后调用 registerBuiltinPrefix()
 *   - 前缀从工具名第一个 '-' 或 '_' 前的部分提取
 *   - 无分隔符的工具名视为无前缀（不注册）
 *
 * 向后兼容:
 *   - 保留静态种子列表，确保即使有工具未标记 builtin 也不会遗漏
 */

// ── 初始种子：已知内置工具前缀（确保向后兼容）────────────────

const SEED_PREFIXES = [
  "todo-",
  "notebook-",
  "filesystem-",
  "terminal-",
  "ace-",
  "websearch-",
  "ide-",
  "codebase-",
  "askuser-",
  "skill-",
  "subagent-",
  "deepwiki-",
  "context7-",
  "team-",
  "scheduler-",
  "plan-",
  "goal-",
  "git-",
  "agent-comms-",
  "format-",
  "tool-search",
  "lsp-",
  "mcp-",
] as const;

/** 运行时前缀集合（种子 + 动态注册） */
const builtinPrefixes = new Set<string>(SEED_PREFIXES);

/**
 * 从工具名提取前缀并注册到内置工具前缀集合。
 *
 * 提取规则:
 *   - "filesystem-read" → "filesystem-"
 *   - "bash" (无分隔符) → 不注册
 *   - "tool-search" (单段) → 不注册（不是前缀模式）
 *   - 已存在的项幂等跳过
 *
 * @param toolName 工具唯一标识名
 */
/** registerBuiltinPrefix 的实现 */
export function registerBuiltinPrefix(toolName: string): void {
  const sep = toolName.indexOf("-");
  const sepUs = toolName.indexOf("_");
  if (sep === -1 && sepUs === -1) {
    // 无分隔符的工具名不是前缀模式，跳过
    return;
  }
  const idx = sep === -1 ? sepUs : sepUs === -1 ? sep : Math.min(sep, sepUs);
  const prefix = toolName.slice(0, idx + 1); // 包含分隔符
  builtinPrefixes.add(prefix);
}

/**
 * 获取当前所有内置工具前缀的只读集合。
 *
 * 用于 toolNameMatcher 判断工具是否为外部(MCP)工具。
 */
/** getBuiltinPrefixes 的实现 */
export function getBuiltinPrefixes(): ReadonlySet<string> {
  return builtinPrefixes;
}

/**
 * @deprecated 使用 registerBuiltinPrefix() + getBuiltinPrefixes() 替代。
 * 保留向后兼容的外部引用。
 */
/** BUILTIN_TOOL_PREFIXES */
export const BUILTIN_TOOL_PREFIXES = builtinPrefixes;
