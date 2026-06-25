/**
 * authGuard 单元测试 — safeTokenEquals / isLocalBindHost / requireAuthForHost / authResponse / createAuthGuard
 */
import { describe, it, expect, afterEach } from "bun:test";
import {
  safeTokenEquals,
  isLocalBindHost,
  requireAuthForHost,
  authResponse,
  createAuthGuard,
} from "@/server/authGuard";

describe("safeTokenEquals", () => {
  it("相同 token 返回 true", () => {
    expect(safeTokenEquals("abc123", "abc123")).toBe(true);
  });

  it("不同 token 返回 false", () => {
    expect(safeTokenEquals("abc123", "xyz789")).toBe(false);
  });

  it("candidate 为 null 返回 false", () => {
    expect(safeTokenEquals(null, "abc")).toBe(false);
  });

  it("candidate 为 undefined 返回 false", () => {
    expect(safeTokenEquals(undefined, "abc")).toBe(false);
  });

  it("expected 为空串返回 false", () => {
    expect(safeTokenEquals("abc", "")).toBe(false);
  });

  it("长度不等时仍执行恒定时间比较（不抛异常）", () => {
    expect(() => safeTokenEquals("short", "a-much-longer-string")).not.toThrow();
    expect(safeTokenEquals("short", "a-much-longer-string")).toBe(false);
  });

  it("BOM 前缀不影响比较", () => {
    const token = "secret-token-123";
    expect(safeTokenEquals(token, token)).toBe(true);
  });
});

describe("isLocalBindHost", () => {
  it("127.0.0.1 是本地地址", () => {
    expect(isLocalBindHost("127.0.0.1")).toBe(true);
  });

  it("localhost 是本地地址", () => {
    expect(isLocalBindHost("localhost")).toBe(true);
  });

  it("::1 是本地地址", () => {
    expect(isLocalBindHost("::1")).toBe(true);
  });

  it("[::1] 是本地地址", () => {
    expect(isLocalBindHost("[::1]")).toBe(true);
  });

  it("0.0.0.0 不是本地地址", () => {
    expect(isLocalBindHost("0.0.0.0")).toBe(false);
  });

  it("192.168.1.1 不是本地地址", () => {
    expect(isLocalBindHost("192.168.1.1")).toBe(false);
  });
});

describe("requireAuthForHost", () => {
  const originalToken = process.env.CRAB_API_TOKEN;

  afterEach(() => {
    if (originalToken !== undefined) {
      process.env.CRAB_API_TOKEN = originalToken;
    } else {
      delete process.env.CRAB_API_TOKEN;
    }
  });

  it("localhost 绑定不抛异常（无 token）", () => {
    delete process.env.CRAB_API_TOKEN;
    expect(() => requireAuthForHost("localhost", false)).not.toThrow();
  });

  it("非 localhost 绑定无 token 且不允许本地免鉴权时抛异常", () => {
    delete process.env.CRAB_API_TOKEN;
    expect(() => requireAuthForHost("0.0.0.0", false)).toThrow();
  });

  it("非 localhost 绑定有 token 时不抛异常", () => {
    process.env.CRAB_API_TOKEN = "test-token";
    expect(() => requireAuthForHost("0.0.0.0", false)).not.toThrow();
  });

  it("非 localhost 绑定 allowLocalWithoutToken=true 时不抛异常", () => {
    delete process.env.CRAB_API_TOKEN;
    expect(() => requireAuthForHost("0.0.0.0", true)).not.toThrow();
  });
});

describe("authResponse", () => {
  it("返回 401 + JSON 错误", async () => {
    const res = authResponse();
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("未授权");
  });
});

describe("createAuthGuard", () => {
  const originalToken = process.env.CRAB_API_TOKEN;

  afterEach(() => {
    if (originalToken !== undefined) {
      process.env.CRAB_API_TOKEN = originalToken;
    } else {
      delete process.env.CRAB_API_TOKEN;
    }
  });

  it("有 token 时 GET 请求通过（exempt）", () => {
    process.env.CRAB_API_TOKEN = "secret";
    const guard = createAuthGuard();
    const req = new Request("http://localhost/api/health");
    expect(guard.isAuthorized(req)).toBe(true);
  });

  it("有 token 时 POST 请求无 Authorization 头被拒绝", () => {
    process.env.CRAB_API_TOKEN = "secret";
    const guard = createAuthGuard();
    const req = new Request("http://localhost/api/message", { method: "POST" });
    expect(guard.isAuthorized(req)).toBe(false);
  });

  it("有 token 时 POST 请求带正确 Authorization 头通过", () => {
    process.env.CRAB_API_TOKEN = "secret";
    const guard = createAuthGuard();
    const req = new Request("http://localhost/api/message", {
      headers: { Authorization: "Bearer secret" },
      method: "POST",
    });
    expect(guard.isAuthorized(req)).toBe(true);
  });

  it("无 token 时 allowLocalWithoutToken=true 放行 POST", () => {
    delete process.env.CRAB_API_TOKEN;
    const guard = createAuthGuard({ allowLocalWithoutToken: true });
    const req = new Request("http://localhost/api/message", { method: "POST" });
    expect(guard.isAuthorized(req)).toBe(true);
  });

  it("无 token 时 allowLocalWithoutToken=false 拒绝 POST", () => {
    delete process.env.CRAB_API_TOKEN;
    const guard = createAuthGuard({ allowLocalWithoutToken: false });
    const req = new Request("http://localhost/api/message", { method: "POST" });
    expect(guard.isAuthorized(req)).toBe(false);
  });

  it("requireAuth 放行时返回 null", () => {
    process.env.CRAB_API_TOKEN = "secret";
    const guard = createAuthGuard();
    const req = new Request("http://localhost/api/health");
    expect(guard.requireAuth(req)).toBeNull();
  });

  it("requireAuth 拒绝时返回 401 Response", () => {
    process.env.CRAB_API_TOKEN = "secret";
    const guard = createAuthGuard();
    const req = new Request("http://localhost/api/message", { method: "POST" });
    const res = guard.requireAuth(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it("isAuthorizedWithQueryToken 支持从 URL query 获取 token", () => {
    process.env.CRAB_API_TOKEN = "my-token";
    const guard = createAuthGuard();
    const req = new Request("http://localhost/collaborationHub?access_token=my-token", {
      method: "POST",
    });
    expect(guard.isAuthorizedWithQueryToken(req)).toBe(true);
  });

  it("自定义 exemptMethods 生效", () => {
    process.env.CRAB_API_TOKEN = "secret";
    const guard = createAuthGuard({ exemptMethods: new Set(["GET"]) });
    const req = new Request("http://localhost/api/message", { method: "POST" });
    expect(guard.isAuthorized(req)).toBe(false);
  });
});
