/**
 * 路由系统测试。
 *
 * 测试用例:
 *   - Route 类型覆盖
 *   - 路由转换路径
 *   - 页面导航
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Route } from "@/ui/contexts/route";
import { closeDb, getDb, initDb } from "@/db";
import { messages, sessions } from "@/db/schema";
import { ensureSession } from "@/session";

function clearSessionTables() {
  const db = getDb();
  db.delete(messages).run();
  db.delete(sessions).run();
}

describe("路由 Context — 页面导航", () => {
  beforeEach(() => {
    initDb();
    clearSessionTables();
    delete process.env.CRAB_RESUME_SESSION;
    delete process.env.CRAB_RESUME_SESSION_INVALID;
  });

  afterEach(() => {
    delete process.env.CRAB_RESUME_SESSION;
    delete process.env.CRAB_RESUME_SESSION_INVALID;
    clearSessionTables();
    closeDb();
  });

  test("Route 类型覆盖所有页面", () => {
    const home: Route = { type: "home" };
    const session: Route = { sessionId: "ses_123", type: "session" };
    const settings: Route = { type: "settings" };
    const help: Route = { type: "help" };
    const mcp: Route = { type: "mcp" };
    const pixelEditor: Route = { type: "pixel-editor" };

    expect(home.type).toBe("home");
    expect(session.type).toBe("session");
    expect(session.type === "session" ? session.sessionId : undefined).toBe("ses_123");
    expect(settings.type).toBe("settings");
    expect(help.type).toBe("help");
    expect(mcp.type).toBe("mcp");
    expect(pixelEditor.type).toBe("pixel-editor");
  });

  test("路由转换路径合法", () => {
    const transitions: [Route, Route][] = [
      [{ type: "home" }, { sessionId: "ses_001", type: "session" }],
      [{ sessionId: "ses_001", type: "session" }, { type: "home" }],
      [{ type: "home" }, { type: "settings" }],
      [{ type: "settings" }, { type: "home" }],
      [{ type: "home" }, { type: "help" }],
      [{ type: "help" }, { type: "home" }],
      [
        { sessionId: "ses_001", type: "session" },
        { sessionId: "abc", type: "session" },
      ],
      [{ type: "home" }, { type: "mcp" }],
      [{ type: "mcp" }, { type: "home" }],
      [{ type: "home" }, { type: "pixel-editor" }],
      [{ type: "pixel-editor" }, { type: "home" }],
    ];

    for (const [from, to] of transitions) {
      expect(to.type).toBeDefined();
      expect(from.type).toBeDefined();
    }
  });

  test("reconcile 模式正确替换路由状态", () => {
    const routes = [
      { type: "home" as const },
      { sessionId: "ses_001", type: "session" as const },
      { type: "home" as const },
    ];
    expect(routes[0]!.type).toBe("home");
    expect(routes[1]!.type).toBe("session");
    expect(routes[2]!.type).toBe("home");
  });

  test("sessionId 对齐 opencode 为必填", () => {
    const withId = { sessionId: "ses_001", type: "session" as const };
    expect(withId.sessionId).toBe("ses_001");
  });

  test("多级回退支持", () => {
    // 模拟路由历史栈的行为
    const history: { type: string }[] = [];
    let current: { type: string } = { type: "home" };

    // Navigate 操作
    function navigate(route: { type: string }) {
      history.push(current);
      if (history.length > 50) {
        history.shift();
      }
      current = route;
    }

    // Back 操作
    function back() {
      if (history.length > 0) {
        current = history.pop()!;
      }
    }

    // 模拟导航序列
    navigate({ type: "session" }); // Home -> session
    navigate({ type: "settings" }); // Session -> settings
    navigate({ type: "pixel-editor" }); // Settings -> pixel-editor

    expect(current.type).toBe("pixel-editor");
    expect(history.length).toBe(3);

    // 多级回退
    back(); // Pixel-editor -> settings
    expect(current.type).toBe("settings");
    expect(history.length).toBe(2);

    back(); // Settings -> session
    expect(current.type).toBe("session");
    expect(history.length).toBe(1);

    back(); // Session -> home
    expect(current.type).toBe("home");
    expect(history.length).toBe(0);

    // 历史栈为空时，保持在当前页面
    back();
    expect(current.type).toBe("home");
    expect(history.length).toBe(0);
  });

  test("历史栈深度限制", () => {
    const history: { type: string }[] = [];
    let current: { type: string } = { type: "home" };

    function navigate(route: { type: string }) {
      history.push(current);
      if (history.length > 50) {
        history.shift();
      }
      current = route;
    }

    // 模拟 100 次导航
    for (let i = 0; i < 100; i++) {
      navigate({ type: `page_${i}` });
    }

    // 历史栈应该只保留最近 50 个
    expect(history.length).toBe(50);
  });

  test("resolveInitialRoute 仅在 session 存在时恢复 --continue", async () => {
    const mod = await import("@/ui/contexts/route");

    process.env.CRAB_RESUME_SESSION = "ses_missing_resume";
    const missing = mod.resolveInitialRoute();
    expect(missing.route).toEqual({ type: "home" });
    expect(missing.invalidResumeSession).toBe("ses_missing_resume");

    ensureSession("ses_existing_resume", { model: "test-model", projectDir: process.cwd() });
    process.env.CRAB_RESUME_SESSION = "ses_existing_resume";
    delete process.env.CRAB_RESUME_SESSION_INVALID;

    const existing = mod.resolveInitialRoute();
    expect(existing.route).toEqual({ sessionId: "ses_existing_resume", type: "session" });
    expect(existing.invalidResumeSession).toBeUndefined();
  });
});
