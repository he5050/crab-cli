/**
 * 内置工具分组定义和查找表。
 *
 * 提供 BuiltinToolGroup 接口、分组列表、O(1) 查找表。
 */

/** 内置工具分组定义 */
export interface BuiltinToolGroup {
  name: string;
  tools: string[];
}

const BUILTIN_GROUPS: BuiltinToolGroup[] = [
  {
    name: "filesystem",
    tools: ["filesystem-read", "filesystem-write", "filesystem-edit", "filesystem-batch", "filesystem-multi-edit"],
  },
  {
    name: "terminal",
    tools: ["terminal-execute"],
  },
  {
    name: "search",
    tools: ["glob", "grep", "apply-patch"],
  },
  {
    name: "deepwiki",
    tools: [
      "deepwiki-read-structure",
      "deepwiki-read-contents",
      "deepwiki-ask-question",
      "deepwiki-fetch",
      "deepwiki-search",
    ],
  },
  {
    name: "context7",
    tools: ["context7-resolve-library-id", "context7-query-docs"],
  },
  {
    name: "websearch",
    tools: ["websearch", "webfetch"],
  },
  {
    name: "todo",
    tools: ["todo-ultra"],
  },
  {
    name: "askuser",
    tools: ["askuser-ask-question"],
  },
  {
    name: "subagent",
    tools: ["subagent"],
  },
  {
    name: "team",
    tools: [
      "team-spawn",
      "team-message",
      "team-broadcast",
      "team-shutdown",
      "team-wait",
      "team-list",
      "team-status",
      "team-create-task",
      "team-update-task",
      "team-list-tasks",
      "team-merge-work",
      "team-merge-all",
      "team-resolve-conflicts",
      "team-abort-merge",
      "team-approve-plan",
      "team-cleanup",
    ],
  },
  {
    name: "scheduler",
    tools: ["scheduler"],
  },
  {
    name: "notebook",
    tools: ["notebook"],
  },
  {
    name: "skills",
    tools: ["skills"],
  },
  {
    name: "ide-diagnostics",
    tools: ["ide-diagnostics"],
  },
  {
    name: "codebase-search",
    tools: ["codebase-search"],
  },
  {
    name: "ace-enhanced-search",
    tools: ["ace-enhanced-search"],
  },
  {
    name: "notebook-jupyter",
    tools: ["notebook-read", "notebook-edit"],
  },
  {
    name: "lsp",
    tools: ["lsp"],
  },
  {
    name: "plan-mode",
    tools: ["plan-mode"],
  },
  {
    name: "tool-search",
    tools: ["tool-search"],
  },
  {
    name: "agent-comms",
    tools: ["agent-comms-send-message", "agent-comms-query-status"],
  },
  {
    name: "goal",
    tools: ["goal"],
  },
  {
    name: "git",
    tools: ["git", "git_merge", "git_rebase", "git_push", "git_tag"],
  },
  {
    name: "format",
    tools: ["format"],
  },
  {
    name: "research",
    tools: ["deep-research"],
  },
  {
    name: "mcp",
    tools: ["mcp_list_resources", "mcp_read_resource"],
  },
];

/** 获取内置工具分组信息 */
export function getBuiltinToolGroups(): BuiltinToolGroup[] {
  return BUILTIN_GROUPS.map((g) => ({ name: g.name, tools: [...g.tools] }));
}

// ─── 内置工具查找表（O(1) 替代 O(n×m) 线性扫描） ─────────────

/** 工具名 → 分组名的查找表，在首次使用时构建 */
let _builtinToolGroupMap: Map<string, string> | null = null;

function ensureBuiltinToolGroupMap(): Map<string, string> {
  if (_builtinToolGroupMap) {
    return _builtinToolGroupMap;
  }
  const map = new Map<string, string>();
  for (const g of BUILTIN_GROUPS) {
    for (const toolName of g.tools) {
      map.set(toolName, g.name);
    }
  }
  _builtinToolGroupMap = map;
  return map;
}

/** 判断工具名是否属于内置工具 */
export function isBuiltinTool(toolName: string): boolean {
  return ensureBuiltinToolGroupMap().has(toolName);
}

/** 判断工具名属于哪个内置分组(返回分组名，不属于则返回 null) */
export function getBuiltinGroupName(toolName: string): string | null {
  return ensureBuiltinToolGroupMap().get(toolName) ?? null;
}
