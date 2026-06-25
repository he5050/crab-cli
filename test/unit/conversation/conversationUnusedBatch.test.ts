/**
 * [测试目标] conversation 未使用批量源。
 *
 * 测试目标:
 *   - 校验 conversation 子目录中若干历史无引用 import / 死局部变量已被清理
 *
 * 测试用例:
 *   - remove obvious unused imports and dead locals:读取 compaction / llmLoop / toolCallLoop / conversationHandler 源，断言不再含目标字符串
 */
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

function readRelative(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dir, `../../../src/${relativePath}`), "utf8");
}

describe("会话未使用批量源", () => {
  test("remove obvious unused imports and dead locals", () => {
    const compaction = readRelative("compress/conversation/compaction.ts");
    const llmLoop = readRelative("conversation/core/llmLoop.ts");
    const toolCallLoop = readRelative("conversation/core/toolCallLoop.ts");
    const handler = readRelative("conversation/core/conversationHandler.ts");

    expect(compaction).not.toContain("sanitizeAndTruncate");
    expect(llmLoop).not.toContain('ToolExecutor,\n  ToolExecutionResult,\n} from "./llmLoopTypes";');
    expect(toolCallLoop).not.toContain("tryAcquireExecutionPermit");
    expect(toolCallLoop).not.toContain("import type { ToolCallInfo, ToolCallRoundResult, ConversationUsage }");
    expect(handler).not.toContain("appendAssistantMessage");
    expect(handler).not.toContain("appendToolResults");
    expect(handler).not.toContain("private getEffectiveAllowedTools()");
    expect(handler).not.toContain("const extractedThinking =");
    expect(handler).not.toContain("const stopResult =");
  });
});
