/**
 * sseSecurity 单元测试 — isSseOriginAllowed / sseCorsHeadersFor / getSignalRSessionScope / isAuthorized / isSignalRAuthorized
 */
import { describe, it, expect, afterEach } from "bun:test";
import {
  isSseOriginAllowed,
  sseCorsHeadersFor,
  getSignalRSessionScope,
  isAuthorized,
  isSignalRAuthorized,
} from "@/server/sseSecurity";

describe("isSseOriginAllowed", () => {
  it("允许 http://127.0.0.1", () => {
    expect(isSseOriginAllowed("http://127.0.0.1")).toBe(true);
  });

  it("允许 http://localhost", () => {
    expect(isSseOriginAllowed("http://localhost")).toBe(true);
  });

  it("允许 http://127.0.0.1:3000", () => {
    expect(isSseOriginAllowed("http://127.0.0.1:3000")).toBe(true);
  });

  it("允许 http://localhost:5173", () => {
    expect(isSseOriginAllowed("http://localhost:5173")).toBe(true);
  });

  it("拒绝 http://evil.com", () => {
    expect(isSseOriginAllowed("http://evil.com")).toBe(false);
  });

  it("拒绝 null origin", () => {
    expect(isSseOriginAllowed(null)).toBe(false);
  });

  it("拒绝空字符串 origin", () => {
    expect(isSseOriginAllowed("")).toBe(false);
  });

  it("拒绝 https://127.0.0.1:9999（不在白名单）", () => {
    expect(isSseOriginAllowed("https://127.0.0.1:9999")).toBe(false);
  });

  it("拒绝无效 URL 字符串", () => {
    expect(isSseOriginAllowed("not-a-url")).toBe(false);
  });

  it("拒绝 ftp://127.0.0.1（非 http/https）", () => {
    expect(isSseOriginAllowed("ftp://127.0.0.1")).toBe(false);
  });
});

describe("sseCorsHeadersFor", () => {
  it("允许的 origin 返回 Access-Control-Allow-Origin 和 Vary", () => {
    const headers = sseCorsHeadersFor("http://127.0.0.1");
    expect(headers["Access-Control-Allow-Origin"]).toBe("http://127.0.0.1");
    expect(headers["Vary"]).toBe("Origin");
  });

  it("不允许的 origin 返回空对象", () => {
    const headers = sseCorsHeadersFor("http://evil.com");
    expect(Object.keys(headers)).toHaveLength(0);
  });

  it("null origin 返回空对象", () => {
    const headers = sseCorsHeadersFor(null);
    expect(Object.keys(headers)).toHaveLength(0);
  });
});

describe("getSignalRSessionScope", () => {
  it("从 sessionId 参数获取 scope", () => {
    const req = new Request("http://localhost/collaborationHub?sessionId=abc&sessionId=def");
    const scope = getSignalRSessionScope(req);
    expect(scope).toEqual(["abc", "def"]);
  });

  it("去重 scope", () => {
    const req = new Request("http://localhost/collaborationHub?sessionId=abc&sessionId=abc");
    const scope = getSignalRSessionScope(req);
    expect(scope).toEqual(["abc"]);
  });

  it("从 sessions 参数获取逗号分隔的 scope", () => {
    const req = new Request("http://localhost/collaborationHub?sessions=abc,def");
    const scope = getSignalRSessionScope(req);
    expect(scope).toEqual(["abc", "def"]);
  });

  it("合并 sessionId 和 sessions 参数", () => {
    const req = new Request("http://localhost/collaborationHub?sessionId=abc&sessions=def,ghi");
    const scope = getSignalRSessionScope(req);
    expect(scope).toEqual(["abc", "def", "ghi"]);
  });

  it("trim 空白并过滤空值", () => {
    const req = new Request("http://localhost/collaborationHub?sessions= abc ,, def ");
    const scope = getSignalRSessionScope(req);
    expect(scope).toEqual(["abc", "def"]);
  });

  it("无参数返回空数组", () => {
    const req = new Request("http://localhost/collaborationHub");
    const scope = getSignalRSessionScope(req);
    expect(scope).toEqual([]);
  });
});

describe("isAuthorized (SSE wrapper)", () => {
  const originalToken = process.env.CRAB_API_TOKEN;

  afterEach(() => {
    if (originalToken !== undefined) {
      process.env.CRAB_API_TOKEN = originalToken;
    } else {
      delete process.env.CRAB_API_TOKEN;
    }
  });

  it("无 token 且 allowLocalWithoutToken=false 返回 false", () => {
    delete process.env.CRAB_API_TOKEN;
    const req = new Request("http://localhost/api/message", { method: "POST" });
    expect(isAuthorized(req, false)).toBe(false);
  });

  it("无 token 且 allowLocalWithoutToken=true 返回 true", () => {
    delete process.env.CRAB_API_TOKEN;
    const req = new Request("http://localhost/api/message", { method: "POST" });
    expect(isAuthorized(req, true)).toBe(true);
  });

  it("有 token 且正确 Authorization 头返回 true", () => {
    process.env.CRAB_API_TOKEN = "secret";
    const req = new Request("http://localhost/api/message", {
      headers: { Authorization: "Bearer secret" },
      method: "POST",
    });
    expect(isAuthorized(req, false)).toBe(true);
  });

  it("有 token 但错误 Authorization 头返回 false", () => {
    process.env.CRAB_API_TOKEN = "secret";
    const req = new Request("http://localhost/api/message", {
      headers: { Authorization: "Bearer wrong" },
      method: "POST",
    });
    expect(isAuthorized(req, false)).toBe(false);
  });
});

describe("isSignalRAuthorized (SSE wrapper)", () => {
  const originalToken = process.env.CRAB_API_TOKEN;

  afterEach(() => {
    if (originalToken !== undefined) {
      process.env.CRAB_API_TOKEN = originalToken;
    } else {
      delete process.env.CRAB_API_TOKEN;
    }
  });

  it("从 access_token query 参数鉴权", () => {
    process.env.CRAB_API_TOKEN = "secret";
    const req = new Request("http://localhost/collaborationHub?access_token=secret", {
      method: "POST",
    });
    expect(isSignalRAuthorized(req, false)).toBe(true);
  });

  it("access_token 错误返回 false", () => {
    process.env.CRAB_API_TOKEN = "secret";
    const req = new Request("http://localhost/collaborationHub?access_token=wrong", {
      method: "POST",
    });
    expect(isSignalRAuthorized(req, false)).toBe(false);
  });

  it("Authorization header 优先于 query token", () => {
    process.env.CRAB_API_TOKEN = "secret";
    const req = new Request("http://localhost/collaborationHub?access_token=wrong", {
      headers: { Authorization: "Bearer secret" },
      method: "POST",
    });
    expect(isSignalRAuthorized(req, false)).toBe(true);
  });
});
