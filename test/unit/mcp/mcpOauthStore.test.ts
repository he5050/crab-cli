/**
 * MCP OAuth 存储测试。
 *
 * 测试用例:
 *   - Token 存储
 *   - Token 刷新
 *   - Token 过期
 */
import { afterEach, describe, expect, mock, test } from "bun:test";
import path from "node:path";

const originalEnv = {
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
};

afterEach(() => {
  mock.restore();
  if (originalEnv.XDG_CONFIG_HOME) {
    process.env.XDG_CONFIG_HOME = originalEnv.XDG_CONFIG_HOME;
  } else {
    delete process.env.XDG_CONFIG_HOME;
  }
  if (originalEnv.XDG_DATA_HOME) {
    process.env.XDG_DATA_HOME = originalEnv.XDG_DATA_HOME;
  } else {
    delete process.env.XDG_DATA_HOME;
  }
});

describe("MCP OAuth 骨架", () => {
  test("McpConfigFileSchema accepts oauth config", async () => {
    const { McpConfigFileSchema } = await import("@/schema/config");
    const parsed = McpConfigFileSchema.parse({
      mcpServers: {
        remote_demo: {
          oauth: {
            clientId: "demo-client",
            redirectUri: "http://127.0.0.1:19876/mcp/oauth/callback",
          },
          type: "http",
          url: "https://example.com/mcp",
        },
      },
    });

    const oauth = parsed.mcpServers.remote_demo?.oauth as { clientId?: string } | undefined;
    expect(oauth).toBeDefined();
    expect(oauth?.clientId).toBe("demo-client");
  });

  test("oauth store roundtrip and auth status derivation work", async () => {
    const dir = await Bun.$`mktemp -d`.text();
    const tempDir = dir.trim();
    const originalDataHome = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = tempDir;

    const mod = await import("@/mcp/oauth/oauthStore.ts");
    const ok = await mod.updateOAuthTokens(
      "remote-demo",
      {
        accessToken: "token-123",
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      },
      "https://example.com/mcp",
    );

    expect(ok).toBe(true);
    const storePath = path.join(tempDir, "crab", "mcp-auth.json");
    const text = await Bun.file(storePath).text();
    expect(text).toContain("token-123");

    const status = mod.deriveMcpAuthStatus(
      {
        oauth: {},
        url: "https://example.com/mcp",
      },
      await mod.getOAuthEntry("remote-demo"),
    );
    expect(status).toBe("authenticated");

    if (originalDataHome) {
      process.env.XDG_DATA_HOME = originalDataHome;
    } else {
      delete process.env.XDG_DATA_HOME;
    }
  });

  test("运行时认证骨架可启动会话与持久化令牌", async () => {
    const configDir = await Bun.$`mktemp -d`.text();
    const dataDir = await Bun.$`mktemp -d`.text();
    const tempConfig = configDir.trim();
    const tempData = dataDir.trim();
    const port = 19_000 + Math.floor(Math.random() * 1000);

    await Bun.$`mkdir -p ${path.join(tempConfig, "crab")}`;
    await Bun.write(
      path.join(tempConfig, "crab", "mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            remote_demo: {
              oauth: {
                authorizationUrl: "https://auth.example.com/authorize",
                redirectUri: `http://127.0.0.1:${port}/mcp/oauth/callback`,
              },
              type: "http",
              url: "https://example.com/mcp",
            },
          },
        },
        null,
        2,
      ),
    );

    const originalConfigHome = process.env.XDG_CONFIG_HOME;
    const originalDataHome = process.env.XDG_DATA_HOME;
    process.env.XDG_CONFIG_HOME = tempConfig;
    process.env.XDG_DATA_HOME = tempData;

    mock.module("@/mcp/manager/mcpConfig", () => ({
      getMcpServers: async () => [],
      getProjectMcpConfigPath: () => undefined,
      loadMcpConfig: async () => [],
      readMergedMcpConfigRecord: async () => ({
        remote_demo: {
          oauth: {
            authorizationUrl: "https://auth.example.com/authorize",
            redirectUri: `http://127.0.0.1:${port}/mcp/oauth/callback`,
          },
          type: "http",
          url: "https://example.com/mcp",
        },
      }),
      readMergedMcpConfigSources: async () => ({}),
      resetMcpConfigCache: () => {},
      setGlobalMcpServerEnabled: async () => {},
      setGlobalMcpToolDisabled: async () => {},
    }));

    const runtime = await import(`@/mcp/manager/runtime?case=${Date.now()}`);
    const session = await runtime.startMcpRuntimeAuth("remote_demo");
    expect(session.redirectUri).toContain(String(port));
    expect(session.state.length).toBeGreaterThan(10);
    expect(session.codeVerifier.length).toBeGreaterThan(10);

    const finished = await runtime.finishMcpRuntimeAuth("remote_demo", {
      accessToken: "oauth-token-1",
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });
    expect(finished).toBe(true);

    const storePath = path.join(tempData, "crab", "mcp-auth.json");
    const text = await Bun.file(storePath).text();
    expect(text).toContain("oauth-token-1");

    if (originalConfigHome) {
      process.env.XDG_CONFIG_HOME = originalConfigHome;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }
    if (originalDataHome) {
      process.env.XDG_DATA_HOME = originalDataHome;
    } else {
      delete process.env.XDG_DATA_HOME;
    }
  });

  test("oauth provider exposes redirect callback and finish path prerequisites", async () => {
    const dir = await Bun.$`mktemp -d`.text();
    const tempDir = dir.trim();
    const originalDataHome = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = tempDir;

    const redirects: string[] = [];
    const providerMod = await import("@/mcp/oauth/oauthProvider.ts");
    const storeMod = await import("@/mcp/oauth/oauthStore.ts");
    const provider = new providerMod.McpOAuthProvider({
      mcpName: "oauth-flow-demo",
      onRedirect(url: URL) {
        redirects.push(url.toString());
      },
      redirectUri: "http://127.0.0.1:19876/mcp/oauth/callback",
      scope: "profile",
      serverUrl: "https://example.com/mcp",
    });

    await provider.saveState("state-demo");
    await provider.saveCodeVerifier("verifier-demo");
    await provider.redirectToAuthorization(new URL("https://auth.example.com/authorize?client_id=demo"));

    expect(await provider.state()).toBe("state-demo");
    expect(await provider.codeVerifier()).toBe("verifier-demo");
    expect(redirects[0]).toContain("auth.example.com");
    expect((await storeMod.getOAuthEntry("oauth-flow-demo"))?.oauthState).toBe("state-demo");

    if (originalDataHome) {
      process.env.XDG_DATA_HOME = originalDataHome;
    } else {
      delete process.env.XDG_DATA_HOME;
    }
  });

  test("oauth provider stores tokens and code verifier through provider interface", async () => {
    const dir = await Bun.$`mktemp -d`.text();
    const tempDir = dir.trim();
    const originalDataHome = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = tempDir;

    const providerMod = await import("@/mcp/oauth/oauthProvider.ts");
    const storeMod = await import("@/mcp/oauth/oauthStore.ts");
    const provider = new providerMod.McpOAuthProvider({
      mcpName: "oauth-demo",
      redirectUri: "http://127.0.0.1:19876/mcp/oauth/callback",
      scope: "profile",
      serverUrl: "https://example.com/mcp",
    });

    await provider.saveCodeVerifier("verifier-123");
    await provider.saveState("state-abc");
    await provider.saveTokens({ access_token: "token-456", expires_in: 3600, token_type: "Bearer" });

    const entry = await storeMod.getOAuthEntry("oauth-demo");
    expect(entry?.codeVerifier).toBe("verifier-123");
    expect(entry?.oauthState).toBe("state-abc");
    expect(entry?.tokens?.accessToken).toBe("token-456");

    if (originalDataHome) {
      process.env.XDG_DATA_HOME = originalDataHome;
    } else {
      delete process.env.XDG_DATA_HOME;
    }
  });

  test("oauth store update and clear helpers preserve unrelated fields", async () => {
    const dir = await Bun.$`mktemp -d`.text();
    const tempDir = dir.trim();
    process.env.XDG_DATA_HOME = tempDir;

    const mod = await import("@/mcp/oauth/oauthStore.ts");
    await mod.updateOAuthClientInfo(
      "remote-demo",
      {
        clientId: "client-1",
        clientIdIssuedAt: 11,
        clientSecret: "secret-1",
        clientSecretExpiresAt: 22,
      },
      "https://example.com/mcp",
    );
    await mod.updateOAuthSession("remote-demo", {
      codeVerifier: "verifier-1",
      oauthState: "state-1",
    });
    await mod.updateOAuthTokens("remote-demo", {
      accessToken: "token-1",
      refreshToken: "refresh-1",
      scope: "profile",
    });

    let entry = await mod.getOAuthEntry("remote-demo");
    expect(entry?.serverUrl).toBe("https://example.com/mcp");
    expect(entry?.clientInfo?.clientId).toBe("client-1");
    expect(entry?.oauthState).toBe("state-1");
    expect(entry?.tokens?.accessToken).toBe("token-1");

    expect(await mod.clearOAuthSession("remote-demo")).toBe(true);
    entry = await mod.getOAuthEntry("remote-demo");
    expect(entry?.oauthState).toBeUndefined();
    expect(entry?.codeVerifier).toBeUndefined();
    expect(entry?.clientInfo?.clientSecret).toBe("secret-1");
    expect(entry?.tokens?.refreshToken).toBe("refresh-1");

    expect(await mod.clearOAuthTokens("remote-demo")).toBe(true);
    entry = await mod.getOAuthEntry("remote-demo");
    expect(entry?.tokens).toBeUndefined();
    expect(entry?.clientInfo?.clientId).toBe("client-1");

    expect(await mod.clearOAuthClientInfo("remote-demo")).toBe(true);
    entry = await mod.getOAuthEntry("remote-demo");
    expect(entry?.clientInfo).toBeUndefined();
    expect(entry?.serverUrl).toBe("https://example.com/mcp");

    expect(await mod.removeOAuthEntry("remote-demo")).toBe(true);
    expect(await mod.getOAuthEntry("remote-demo")).toBeUndefined();
    expect(await mod.readOAuthStore()).toEqual({});
  });

  test("oauth store set/remove helpers work from an empty store", async () => {
    const dir = await Bun.$`mktemp -d`.text();
    const tempDir = dir.trim();
    process.env.XDG_DATA_HOME = tempDir;

    const mod = await import("@/mcp/oauth/oauthStore.ts");
    expect(await mod.readOAuthStore()).toEqual({});
    expect(await mod.getOAuthEntry("missing")).toBeUndefined();

    expect(
      await mod.setOAuthEntry("remote-one", {
        oauthState: "state-one",
        serverUrl: "https://example.com/mcp",
      }),
    ).toBe(true);
    expect(await mod.readOAuthStore()).toEqual({
      "remote-one": {
        oauthState: "state-one",
        serverUrl: "https://example.com/mcp",
      },
    });

    expect(await mod.removeOAuthEntry("remote-one")).toBe(true);
    expect(await mod.readOAuthStore()).toEqual({});
  });

  test("清理缺失的 oauth 字段创建空条目且不抛出", async () => {
    const dir = await Bun.$`mktemp -d`.text();
    const tempDir = dir.trim();
    process.env.XDG_DATA_HOME = tempDir;

    const mod = await import("@/mcp/oauth/oauthStore.ts");
    expect(await mod.clearOAuthSession("missing-session")).toBe(true);
    expect(await mod.getOAuthEntry("missing-session")).toEqual({});

    expect(await mod.clearOAuthTokens("missing-token")).toBe(true);
    expect(await mod.getOAuthEntry("missing-token")).toEqual({});

    expect(await mod.clearOAuthClientInfo("missing-client")).toBe(true);
    expect(await mod.getOAuthEntry("missing-client")).toEqual({});
  });

  test("oauth provider metadata and configured client credentials take precedence", async () => {
    const providerMod = await import("@/mcp/oauth/oauthProvider.ts");
    const provider = new providerMod.McpOAuthProvider({
      clientId: "configured-id",
      clientSecret: "configured-secret",
      mcpName: "configured-client",
      redirectUri: "http://127.0.0.1:19876/mcp/oauth/callback",
      scope: "repo profile",
      serverUrl: "https://example.com/mcp",
    });

    expect(provider.redirectUrl).toBe("http://127.0.0.1:19876/mcp/oauth/callback");
    expect(provider.clientMetadata.redirect_uris).toEqual([provider.redirectUrl]);
    expect(provider.clientMetadata.grant_types).toEqual(["authorization_code", "refresh_token"]);
    expect(provider.clientMetadata.response_types).toEqual(["code"]);
    expect(provider.clientMetadata.token_endpoint_auth_method).toBe("client_secret_post");
    expect(provider.clientMetadata.scope).toBe("repo profile");
    expect(await provider.clientInformation()).toEqual({
      client_id: "configured-id",
      client_secret: "configured-secret",
    });
  });

  test("oauth provider ignores stored credentials for a different server URL", async () => {
    const dir = await Bun.$`mktemp -d`.text();
    const tempDir = dir.trim();
    process.env.XDG_DATA_HOME = tempDir;

    const storeMod = await import("@/mcp/oauth/oauthStore.ts");
    const providerMod = await import("@/mcp/oauth/oauthProvider.ts");
    await storeMod.setOAuthEntry("url-bound", {
      clientInfo: {
        clientId: "stored-client",
        clientSecret: "stored-secret",
      },
      serverUrl: "https://old.example.com/mcp",
      tokens: {
        accessToken: "stored-token",
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      },
    });

    const provider = new providerMod.McpOAuthProvider({
      mcpName: "url-bound",
      redirectUri: "http://127.0.0.1:19876/mcp/oauth/callback",
      serverUrl: "https://new.example.com/mcp",
    });

    expect(await provider.clientInformation()).toBeUndefined();
    expect(await provider.tokens()).toBeUndefined();
  });

  test("oauth provider generates state, reports token expiry, and invalidates selected credentials", async () => {
    const dir = await Bun.$`mktemp -d`.text();
    const tempDir = dir.trim();
    process.env.XDG_DATA_HOME = tempDir;

    const storeMod = await import("@/mcp/oauth/oauthStore.ts");
    const providerMod = await import("@/mcp/oauth/oauthProvider.ts");
    const provider = new providerMod.McpOAuthProvider({
      mcpName: "stateful",
      redirectUri: "http://127.0.0.1:19876/mcp/oauth/callback",
      serverUrl: "https://example.com/mcp",
    });

    await expect(provider.codeVerifier()).rejects.toThrow("No code verifier saved for stateful");
    const generatedState = await provider.state();
    expect(generatedState).toHaveLength(64);
    expect(await provider.state()).toBe(generatedState);

    await provider.saveClientInformation({
      client_id: "dynamic-client",
      client_id_issued_at: 10,
      client_secret: "dynamic-secret",
      client_secret_expires_at: 20,
      redirect_uris: ["https://localhost/callback"],
    });
    await provider.saveCodeVerifier("verifier-stateful");
    await provider.saveTokens({
      access_token: "access-stateful",
      expires_in: 120,
      refresh_token: "refresh-stateful",
      scope: "profile",
      token_type: "Bearer",
    });

    const tokens = await provider.tokens();
    expect(tokens?.access_token).toBe("access-stateful");
    expect(tokens?.refresh_token).toBe("refresh-stateful");
    expect(tokens?.expires_in).toBeGreaterThan(0);
    expect(tokens?.expires_in).toBeLessThanOrEqual(120);

    await provider.invalidateCredentials("tokens");
    let entry = await storeMod.getOAuthEntry("stateful");
    expect(entry?.tokens).toBeUndefined();
    expect(entry?.clientInfo?.clientId).toBe("dynamic-client");
    expect(entry?.codeVerifier).toBe("verifier-stateful");

    await provider.invalidateCredentials("verifier");
    entry = await storeMod.getOAuthEntry("stateful");
    expect(entry?.oauthState).toBeUndefined();
    expect(entry?.codeVerifier).toBeUndefined();
    expect(entry?.clientInfo?.clientSecret).toBe("dynamic-secret");

    await provider.invalidateCredentials("client");
    entry = await storeMod.getOAuthEntry("stateful");
    expect(entry?.clientInfo).toBeUndefined();

    await provider.saveCodeVerifier("verifier-after-client-clear");
    await provider.saveTokens({ access_token: "token-after-client-clear", token_type: "Bearer" });
    await provider.saveClientInformation({
      client_id: "client-after-clear",
      redirect_uris: ["https://localhost/callback"],
    });
    await provider.invalidateCredentials("discovery");
    entry = await storeMod.getOAuthEntry("stateful");
    expect(entry?.codeVerifier).toBe("verifier-after-client-clear");
    expect(entry?.tokens?.accessToken).toBe("token-after-client-clear");
    expect(entry?.clientInfo?.clientId).toBe("client-after-clear");

    await provider.invalidateCredentials("all");
    entry = await storeMod.getOAuthEntry("stateful");
    expect(entry?.codeVerifier).toBeUndefined();
    expect(entry?.tokens).toBeUndefined();
    expect(entry?.clientInfo).toBeUndefined();
  });
});
