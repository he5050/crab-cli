/**
 * MCP OAuth 回调测试
 */
import { describe, expect, test } from "bun:test";
import {
  ensureOAuthCallbackServer,
  isOAuthCallbackServerRunning,
  parseOAuthRedirectUri,
  stopOAuthCallbackServer,
  waitForOAuthCallback,
  cancelPendingOAuthCallback,
} from "@/mcp/oauth/oauthCallback";

describe("MCP OAuth 回调", () => {
  describe("parseOAuthRedirectUri", () => {
    test("undefined 返回默认值", () => {
      const result = parseOAuthRedirectUri(undefined);
      expect(result.port).toBe(19876);
      expect(result.path).toBe("/mcp/oauth/callback");
      expect(result.redirectUri).toBe("http://127.0.0.1:19876/mcp/oauth/callback");
    });

    test("自定义 port 和 path", () => {
      const result = parseOAuthRedirectUri("http://127.0.0.1:3000/custom/path");
      expect(result.port).toBe(3000);
      expect(result.path).toBe("/custom/path");
    });

    test("无效 URL 回退到默认值", () => {
      const result = parseOAuthRedirectUri("not-a-url");
      expect(result.port).toBe(19876);
      expect(result.path).toBe("/mcp/oauth/callback");
    });

    test("只有 port 无 path 使用 URL 默认 path", () => {
      const result = parseOAuthRedirectUri("http://127.0.0.1:8080");
      expect(result.port).toBe(8080);
      expect(result.path).toBe("/");
    });
  });

  describe("callback server happy path", () => {
    test("捕获 code 并返回 200", async () => {
      const redirectUri = "http://127.0.0.1:19892/mcp/oauth/callback";
      await ensureOAuthCallbackServer(redirectUri);

      const promise = waitForOAuthCallback("state-123", "demo-oauth");
      const response = await fetch(`${redirectUri}?code=code-xyz&state=state-123`);
      const code = await promise;

      expect(response.status).toBe(200);
      expect(code).toBe("code-xyz");
      await stopOAuthCallbackServer();
    });

    test("支持默认 redirectUri", async () => {
      await ensureOAuthCallbackServer();
      const promise = waitForOAuthCallback("state-default");
      const response = await fetch(`http://127.0.0.1:19876/mcp/oauth/callback?code=abc&state=state-default`);
      expect(await promise).toBe("abc");
      expect(response.status).toBe(200);
      await stopOAuthCallbackServer();
    });
  });

  describe("callback server error handling", () => {
    test("missing state 返回 400", async () => {
      await ensureOAuthCallbackServer();
      const response = await fetch("http://127.0.0.1:19876/mcp/oauth/callback?code=abc");
      expect(response.status).toBe(400);
      expect(await response.text()).toBe("Missing state");
      await stopOAuthCallbackServer();
    });

    test("invalid state 返回 400", async () => {
      await ensureOAuthCallbackServer();
      const response = await fetch("http://127.0.0.1:19876/mcp/oauth/callback?code=abc&state=unknown");
      expect(response.status).toBe(400);
      expect(await response.text()).toBe("Invalid state");
      await stopOAuthCallbackServer();
    });

    test("非 callback path 返回 404", async () => {
      await ensureOAuthCallbackServer();
      const response = await fetch("http://127.0.0.1:19876/other/path");
      expect(response.status).toBe(404);
      await stopOAuthCallbackServer();
    });
  });

  describe("cancel and state management", () => {
    test("cancel 触发 reject", async () => {
      await ensureOAuthCallbackServer();
      const promise = waitForOAuthCallback("state-cancel", "test-mcp");
      cancelPendingOAuthCallback("test-mcp");
      await expect(promise).rejects.toThrow("Authorization cancelled");
      await stopOAuthCallbackServer();
    });

    test("cancel 无匹配 mcpName 不抛错", () => {
      cancelPendingOAuthCallback("non-existent");
    });

    test("stop 触发所有 pending reject", async () => {
      await ensureOAuthCallbackServer();
      const promise = waitForOAuthCallback("state-stop");
      await stopOAuthCallbackServer();
      await expect(promise).rejects.toThrow("OAuth callback server stopped");
    });

    test("isOAuthCallbackServerRunning 反映状态", async () => {
      expect(isOAuthCallbackServerRunning()).toBe(false);
      await ensureOAuthCallbackServer();
      expect(isOAuthCallbackServerRunning()).toBe(true);
      await stopOAuthCallbackServer();
      expect(isOAuthCallbackServerRunning()).toBe(false);
    });
  });
});
