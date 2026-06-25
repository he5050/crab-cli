/**
 * 最大轮次测试。
 *
 * 测试用例:
 *   - 最大工具调用轮次限制
 *   - 轮次计数
 *   - 超限处理
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import type { AppConfigSchema } from "@/schema/config";
import { registerTestTool, resetTestTools } from "../../helpers/testTools";
import { loadRealTestConfig } from "../../helpers/realConfig";
import { installDbIsolation } from "../../helpers/dbIsolation";

let ConversationHandler: any;
let REAL_CONFIG: AppConfigSchema;
installDbIsolation("max-rounds-");
beforeAll(async () => {
  mock.restore();
  REAL_CONFIG = await loadRealTestConfig();
  const mod = await import(`@/conversation/core/conversationHandler?case=${Date.now()}`);
  ({ ConversationHandler } = mod);
});

describe("ConversationHandler 极限边界测试", () => {
  test("达到最大工具调用轮次应停止并返回结果", async () => {
    registerTestTool("fs_read", {
      execute: () => Promise.resolve({ content: "data" }),
      permission: "fs.read",
    });

    // 每次调用都返回工具调用，永远不结束 → 应被 maxToolRounds 截断
    let callRound = 0;
    const streamFn = async function* streamFn() {
      callRound++;
      yield { args: { path: "loop" }, toolCallId: `c_${callRound}`, toolName: "fs_read", type: "tool-call" as const };
      yield { fullText: "", type: "done" as const };
    };

    const handler = new ConversationHandler(REAL_CONFIG, { maxToolRounds: 3, streamFn });
    handler.getPermissionManager().approve("*", "**");
    expect(handler.enableExternalToolForSession("fs_read").status).toBe("unique");

    const result = await handler.sendMessage("trigger tool loop");

    expect(result.toolRounds).toBe(3);
    expect(callRound).toBe(3);
  });
});

afterAll(() => {
  resetTestTools();
  mock.restore();
});
