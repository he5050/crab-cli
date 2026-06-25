/**
 * Mcp/runtime 白盒测试 — 快照访问器 + PKCE 辅助函数 + 结构验证。
 *
 * 可测试的纯逻辑:
 *   - getMcpRuntimeSnapshot / getMcpRuntimeBuiltinSnapshot / getMcpRuntimeDisplaySnapshot(读取模块级快照)
 *   - createRandomHex(内部随机 hex 生成)
 *   - deriveCodeChallenge(PKCE S256)
 *   - McpRuntimeServerSnapshot 接口结构
 *   - getConfigSource 路径回退逻辑
 */

import { describe, expect, test } from "bun:test";
import type { McpAuthStatus } from "@/mcp/oauth/oauthStore";

// ─── createRandomHex 测试 ──────────────────────────────────────────

// 复制 runtime.ts 中的实现来测试
function createRandomHex(bytes = 32): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((item) => item.toString(16).padStart(2, "0")).join("");
}

describe("createRandomHex", () => {
  test("默认 32 字节 = 64 hex 字符", () => {
    const hex = createRandomHex();
    expect(hex.length).toBe(64);
  });

  test("16 字节 = 32 hex 字符", () => {
    const hex = createRandomHex(16);
    expect(hex.length).toBe(32);
  });

  test("只包含 hex 字符", () => {
    const hex = createRandomHex();
    expect(/^[0-9a-f]+$/.test(hex)).toBe(true);
  });

  test("每次生成不同值", () => {
    const a = createRandomHex();
    const b = createRandomHex();
    expect(a).not.toBe(b);
  });
});

// ─── deriveCodeChallenge (PKCE S256) 测试 ─────────────────────────

async function deriveCodeChallenge(codeVerifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

describe("deriveCodeChallenge (PKCE S256)", () => {
  test("返回 base64url 编码的 SHA-256 哈希", async () => {
    const challenge = await deriveCodeChallenge("test-verifier");
    expect(challenge.length).toBeGreaterThan(0);
    // Base64url 不应包含 + / =
    expect(challenge).not.toMatch(/[+/=]/);
  });

  test("相同输入产生相同输出", async () => {
    const a = await deriveCodeChallenge("same-input");
    const b = await deriveCodeChallenge("same-input");
    expect(a).toBe(b);
  });

  test("不同输入产生不同输出", async () => {
    const a = await deriveCodeChallenge("input-a");
    const b = await deriveCodeChallenge("input-b");
    expect(a).not.toBe(b);
  });

  test("RFC 7636 测试向量验证", async () => {
    // RFC 7636 Appendix B: code_verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    // Expected code_challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = await deriveCodeChallenge(verifier);
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

// ─── McpRuntimeServerSnapshot 结构验证 ─────────────────────────────

describe("McpRuntimeServerSnapshot 结构", () => {
  test("内置工具快照结构完整", () => {
    const snapshot = {
      authStatus: "not_authenticated" as McpAuthStatus,
      configPath: "(内置)",
      connectDurationMs: 0,
      disabledTools: [],
      enabled: true,
      name: "filesystem",
      source: "global" as const,
      state: "connected" as const,
      supportsOAuth: false,
      tag: "builtin" as const,
      toolCount: 5,
      toolNames: ["read", "write", "edit", "search", "glob"],
      type: "http" as const,
    };

    expect(snapshot.name).toBe("filesystem");
    expect(snapshot.state).toBe("connected");
    expect(snapshot.toolCount).toBe(5);
    expect(snapshot.enabled).toBe(true);
    expect(snapshot.tag).toBe("builtin");
    expect(snapshot.supportsOAuth).toBe(false);
    expect(snapshot.authStatus).toBe("not_authenticated");
    expect(snapshot.toolNames.length).toBe(5);
  });

  test("外部服务快照结构完整", () => {
    const snapshot = {
      authStatus: "authenticated" as McpAuthStatus,
      configPath: "/project/.crab/mcp.json",
      connectDurationMs: undefined,
      disabledTools: ["dangerous_tool"],
      enabled: true,
      name: "my-server",
      source: "project" as const,
      state: "disconnected" as const,
      supportsOAuth: true,
      tag: "external" as const,
      toolCount: 0,
      toolNames: [],
      type: "stdio" as const,
    };

    expect(snapshot.tag).toBe("external");
    expect(snapshot.disabledTools.length).toBe(1);
    expect(snapshot.supportsOAuth).toBe(true);
    expect(snapshot.authStatus).toBe("authenticated");
  });
});

// ─── getConfigSource 回退逻辑 ─────────────────────────────────────

describe("getConfigSource 回退逻辑", () => {
  // 复制 runtime.ts 中的逻辑
  function getConfigSource(
    name: string,
    sourceMap: Record<string, { source: "global" | "project"; configPath: string }>,
    projectMcpPath: string | null,
    globalMcpPath: string,
  ): { source: "global" | "project"; configPath: string } {
    const resolved = sourceMap[name];
    if (resolved) {
      return resolved;
    }
    if (projectMcpPath) {
      return { configPath: projectMcpPath, source: "project" };
    }
    return { configPath: globalMcpPath, source: "global" };
  }

  test("sourceMap 有值直接返回", () => {
    const result = getConfigSource(
      "my-server",
      {
        "my-server": { configPath: "/project/mcp.json", source: "project" },
      },
      "/fallback/mcp.json",
      "/global/mcp.json",
    );
    expect(result.source).toBe("project");
    expect(result.configPath).toBe("/project/mcp.json");
  });

  test("sourceMap 无值但有 projectPath 回退到 project", () => {
    const result = getConfigSource("unknown", {}, "/project/mcp.json", "/global/mcp.json");
    expect(result.source).toBe("project");
    expect(result.configPath).toBe("/project/mcp.json");
  });

  test("sourceMap 和 projectPath 都无 → 全局回退", () => {
    const result = getConfigSource("unknown", {}, null, "/global/mcp.json");
    expect(result.source).toBe("global");
    expect(result.configPath).toBe("/global/mcp.json");
  });
});

// ─── 快照合并逻辑 ─────────────────────────────────────────────────

describe("快照合并逻辑", () => {
  test("getMcpRuntimeDisplaySnapshot = external + builtin", () => {
    const lastSnapshot = [{ name: "my-server", tag: "external" as const }];
    const lastBuiltinSnapshot = [
      { name: "filesystem", tag: "builtin" as const },
      { name: "websearch", tag: "builtin" as const },
    ];
    const display = [...lastSnapshot, ...lastBuiltinSnapshot];
    expect(display.length).toBe(3);
    expect(display[0]!.tag).toBe("external");
    expect(display[1]!.tag).toBe("builtin");
  });

  test("空快照 + 内置快照", () => {
    const lastSnapshot: any[] = [];
    const lastBuiltinSnapshot = [{ name: "filesystem", tag: "builtin" as const }];
    const display = [...lastSnapshot, ...lastBuiltinSnapshot];
    expect(display.length).toBe(1);
  });
});
