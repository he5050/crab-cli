/**
 * Oauth-store 白盒测试 — 纯函数:deriveMcpAuthStatus, supportsMcpOAuth。
 */
import { describe, expect, test } from "bun:test";
import { deriveMcpAuthStatus, supportsMcpOAuth } from "@/mcp/oauth/oauthStore";
import type { McpOAuthEntry } from "@/mcp/oauth/oauthStore";

describe("deriveMcpAuthStatus", () => {
  test("无配置 → unsupported", () => {
    expect(deriveMcpAuthStatus(undefined)).toBe("unsupported");
  });

  test("oauth=false → unsupported", () => {
    expect(deriveMcpAuthStatus({ oauth: false, url: "http://test" })).toBe("unsupported");
  });

  test("无 token → not_authenticated", () => {
    expect(deriveMcpAuthStatus({ url: "http://test" }, undefined)).toBe("not_authenticated");
  });

  test("空 entry → not_authenticated", () => {
    expect(deriveMcpAuthStatus({ url: "http://test" }, {} as McpOAuthEntry)).toBe("not_authenticated");
  });

  test("有效 token → authenticated", () => {
    expect(deriveMcpAuthStatus({ url: "http://test" }, { tokens: { accessToken: "abc" } })).toBe("authenticated");
  });

  test("过期 token → expired", () => {
    expect(deriveMcpAuthStatus({ url: "http://test" }, { tokens: { accessToken: "abc", expiresAt: 1 } })).toBe(
      "expired",
    );
  });

  test("未来过期时间 → authenticated", () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    expect(deriveMcpAuthStatus({ url: "http://test" }, { tokens: { accessToken: "abc", expiresAt: future } })).toBe(
      "authenticated",
    );
  });
});

describe("supportsMcpOAuth", () => {
  test("无配置 → false", () => {
    expect(supportsMcpOAuth(undefined)).toBe(false);
  });

  test("空 URL → false", () => {
    expect(supportsMcpOAuth({ url: "" })).toBe(false);
  });

  test("有 URL → true", () => {
    expect(supportsMcpOAuth({ url: "http://test" })).toBe(true);
  });

  test("有 URL 但 oauth=false → false", () => {
    expect(supportsMcpOAuth({ oauth: false, url: "http://test" })).toBe(false);
  });

  test("有 URL 且 oauth=true → true", () => {
    expect(supportsMcpOAuth({ oauth: undefined, url: "http://test" })).toBe(true);
  });
});
