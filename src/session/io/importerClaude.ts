/**
 * Claude 导入器 — 解析 Claude 导出的会话 JSON。
 *
 * 职责:
 *   - 把 Claude 导出的会话结构转换为内部 ChatMessage 格式
 *   - 提供给 importer 复用的纯解析逻辑
 *
 * 模块功能:
 *   - ClaudeImportMessage: Claude 导出消息结构
 *   - parseClaudeImport: 解析 Claude 导出会话为 ChatMessage 列表
 */
export interface ClaudeImportMessage {
  role: "user" | "assistant";
  content: string;
}

export function parseClaudeMessages(content: string): ClaudeImportMessage[] {
  const messages: ClaudeImportMessage[] = [];
  const lines = content.split("\n");

  let currentRole: ClaudeImportMessage["role"] | null = null;
  let currentContent: string[] = [];

  for (const line of lines) {
    if (line.startsWith("**Human:**")) {
      if (currentRole && currentContent.length > 0) {
        messages.push({
          content: currentContent.join("\n").trim(),
          role: currentRole,
        });
      }
      currentRole = "user";
      currentContent = [];
    } else if (line.startsWith("**Assistant:**")) {
      if (currentRole && currentContent.length > 0) {
        messages.push({
          content: currentContent.join("\n").trim(),
          role: currentRole,
        });
      }
      currentRole = "assistant";
      currentContent = [];
    } else if (currentRole) {
      currentContent.push(line);
    }
  }

  if (currentRole && currentContent.length > 0) {
    messages.push({
      content: currentContent.join("\n").trim(),
      role: currentRole,
    });
  }

  return messages;
}
