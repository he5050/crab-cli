/**
 * [测试目标] SessionSwitcher v2。
 *
 * 测试目标:
 *   - 验证 sessionSwitcherDialog / sessionSwitcherPreview / sessionSwitcherState 在分组、汇总、缓存与置顶上的行为
 *
 * 测试用例:
 *   - groupByTime 按更新时间分组:today / yesterday 时间戳分别落入对应 label
 *   - 其余用例覆盖 summarizeDiff、loadSessionPreview / prefetchSessionPreviews 缓存、normalizePinnedSessionIds / togglePinnedSessionId 等
 */
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { groupByTime, summarizeDiff } from "@/ui/components/sessionListDialog";
import {
  clearSessionPreviewCacheForTests,
  getSessionPreviewCacheKey,
  getSessionPreviewCacheSizeForTests,
  loadSessionPreview,
  prefetchSessionPreviews,
} from "@/ui/components/sessionSwitcherPreview";
import {
  getQuickSwitchSessionId,
  normalizePinnedSessionIds,
  togglePinnedSessionId,
} from "@/ui/components/sessionSwitcherState";
import type { MessagePart, SessionListItem } from "@/session/type";

const SRC = path.join(import.meta.dir, "../../../src");

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(SRC, relPath), "utf8");
}

function session(overrides: Partial<SessionListItem>): SessionListItem {
  const now = Date.now();
  return {
    createdAt: now,
    id: "ses_test",
    messageCount: 0,
    model: "gpt-test",
    status: "active",
    title: "Test session",
    updatedAt: now,
    ...overrides,
  };
}

describe("SessionSwitcher v2", () => {
  test("groupByTime 按更新时间分组", () => {
    const today = new Date().setHours(12, 0, 0, 0);
    const yesterday = new Date().setHours(12, 0, 0, 0) - 86_400_000;
    const groups = groupByTime([
      session({ id: "ses_today", updatedAt: today }),
      session({ id: "ses_yesterday", updatedAt: yesterday }),
    ]);
    expect(groups.map((group) => group.label)).toEqual(["today", "yesterday"]);
  });

  test("summarizeDiff 优先支持 metadata diff", () => {
    const parts: MessagePart[] = [
      {
        content: "",
        metadata: {
          diff: ["--- a/demo.ts", "+++ b/demo.ts", "@@ -1 +1 @@", "-old", "+new"].join("\n"),
        },
        result: "",
        tool_use_id: "call_1",
        type: "tool_result",
      },
    ];
    expect(summarizeDiff(parts)).toBe("1 file · +1 -1");
  });

  test("pinned quick slots 只使用有效 pinned sessions", () => {
    const sessionIds = ["ses_1", "ses_2", "ses_3"];
    expect(normalizePinnedSessionIds(["ses_2", "missing", "ses_2", "ses_1"], sessionIds)).toEqual(["ses_2", "ses_1"]);
    expect(getQuickSwitchSessionId(1, ["ses_2", "ses_1"], sessionIds)).toBe("ses_2");
    expect(getQuickSwitchSessionId(2, ["ses_2", "ses_1"], sessionIds)).toBe("ses_1");
    expect(getQuickSwitchSessionId(3, ["ses_2", "ses_1"], sessionIds)).toBeUndefined();
    expect(togglePinnedSessionId(["ses_2"], "ses_1", sessionIds)).toEqual(["ses_2", "ses_1"]);
    expect(togglePinnedSessionId(["ses_2"], "ses_2", sessionIds)).toEqual([]);
  });

  test("SessionListDialog 源包含 v2 预览契约", () => {
    const source = readSource("ui/components/sessionListDialog.tsx");
    expect(source).toContain("会话切换器");
    expect(source).toContain("SessionPreviewPane");
    expect(source).toContain("getSessionStatus");
    expect(source).toContain("Spinner");
    expect(source).toContain("预览");
    expect(source).toContain("SESSION_SWITCHER_PINNED_KEY");
    expect(source).toContain("DialogPrompt");
    expect(source).toContain("Ctrl+R");
    expect(source).toContain("Ctrl+F");
    expect(source).toContain("Ctrl+D");
    expect(source).toContain("再次按 Ctrl+D 确认删除");
  });

  test("SessionPreviewPane contract exposes cache key and top-5 prefetch", async () => {
    clearSessionPreviewCacheForTests();
    const previewItem = session({ id: "ses_preview", title: "Preview session", updatedAt: 1234 });
    expect(getSessionPreviewCacheKey(previewItem)).toBe("ses_preview:1234");
    const first = loadSessionPreview(previewItem);
    const second = loadSessionPreview(previewItem);
    expect(second).toBe(first);
    await expect(first).resolves.toMatchObject({ id: "ses_preview", updatedAt: 1234 });

    clearSessionPreviewCacheForTests();
    prefetchSessionPreviews([
      session({ id: "ses_1", updatedAt: 1 }),
      session({ id: "ses_2", updatedAt: 2 }),
      session({ id: "ses_3", updatedAt: 3 }),
      session({ id: "ses_4", updatedAt: 4 }),
      session({ id: "ses_5", updatedAt: 5 }),
      session({ id: "ses_6", updatedAt: 6 }),
    ]);
    expect(getSessionPreviewCacheSizeForTests()).toBe(5);
  });

  test("SessionPreviewPane 源包含加载中, 空与状态反馈", () => {
    const source = readSource("ui/components/sessionSwitcherPreview.tsx");
    expect(source).toContain("正在加载预览...");
    expect(source).toContain("未选择会话");
    expect(source).toContain("暂无消息");
    expect(source).toContain("prefetchSessionPreviews");
    expect(source).toContain("工作中");
    expect(source).toContain("重试中");
    expect(source).toContain("错误");
    expect(source).toContain("getSessionPreviewCacheKey");
  });

  test("Session 重试状态是已连接至真实 LLM 回退重试", () => {
    const statusSource = readSource("session/state/sessionStatus.ts");
    const llmSource = readSource("api/core/llm.ts");
    const listSource = readSource("ui/components/sessionListDialog.tsx");
    expect(statusSource).toContain('"retry"');
    expect(statusSource).toContain('status === "busy" || status === "waiting" || status === "retry"');
    expect(llmSource).toContain('eventType: "llm.request.retry"');
    expect(listSource).toContain('status === "busy" || status === "waiting" || status === "retry"');
  });
});
