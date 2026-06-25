/**
 * 事件命名规范工具 — 校验事件类型字符串是否符合命名约定。
 *
 * 命名规则:
 *   1. 形如 "namespace.action" 的点分命名(如 "session.created")
 *   2. namespace: ^[a-z][a-z0-9-]*$(小写字母 + 连字符)
 *   3. action: ^[a-z][a-z0-9.]*$(小写字母开头 + 点分次级命名,禁连字符/下划线)
 *   4. action 部分的次级段落使用动词过去式(Spawned/Created/Updated/Changed)
 *
 * 例外表(NAMED_EXCEPTIONS):不再符合规范但保留相容性的历史常量名。
 * 例外表优先于正则校验 — 命中例外的事件类型直接通过,不再逐段检查。
 *
 * 此工具仅在 lint 与 dev 模式下调用,不会阻塞生产代码。
 */

const NAMED_EXCEPTIONS = new Set<string>([
  "McpStatusUpdated",
  "ToolsListChanged", // MCP 协议术语
  "ProviderStatus",
  "AgentStatusChanged",
  "AgentRecoveryDetected", // 'Detected' 视为过去式例外
  "DeepResearchProgress",
  "BtwStreamChunk",
  "ConversationStreamToken",
  "ConversationToolCall", // 工具调用瞬间名词,允许
  "ResourceUpdate",
  "ChatChunk",
  "ChatReasoning",
  "TodoSync", // 'sync' 视为可接受动作
]);

/**
 * 校验事件名称是否符合命名规范。
 *
 * @param type - 事件类型字符串(如 "session.created")
 * @param evtName - 事件常量名(可选,用于例外表查询)
 * @returns null 表示通过,否则返回问题描述
 */
export function validateEventName(type: string, evtName?: string): string | null {
  if (!type.includes(".")) {
    return `事件类型 "${type}" 必须使用点分命名空间(如 "session.created")`;
  }

  const [namespace, action] = type.split(".", 2);
  if (!namespace || !action) {
    return `事件类型 "${type}" 命名空间或动作为空`;
  }

  // 例外表优先:命中例外的事件类型直接通过,不再逐段正则检查
  if (evtName && NAMED_EXCEPTIONS.has(evtName)) {
    return null;
  }

  if (!/^[a-z][a-z0-9-]*$/.test(namespace)) {
    return `命名空间 "${namespace}" 必须为小写字母/数字/连字符`;
  }

  // action 必须为小写字母开头 + 点分次级命名
  if (!/^[a-z][a-z0-9.]*$/.test(action)) {
    return `动作 "${action}" 必须以小写字母开头,可含字母数字和点(如 "status.changed")`;
  }

  return null;
}

/** 检查事件常量名是否在已知例外集中。 */
export function isNamedException(evtName: string): boolean {
  return NAMED_EXCEPTIONS.has(evtName);
}
