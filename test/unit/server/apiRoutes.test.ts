/**
 * API 路由测试。
 *
 * 覆盖导出:
 *   - matchApiRoute
 *   - handleApiRequest
 *   - listApiRoutes
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { handleApiRequest, listApiRoutes, matchApiRoute, redactSensitive } from "@/server/apiRoutes";

const ROOT = join(import.meta.dir, "../../..");

describe("API 路由", () => {
  describe("matchApiRoute", () => {
    test("匹配 GET /api/health", () => {
      const result = matchApiRoute("GET", "/api/health");
      expect(result).not.toBeNull();
      expect(result!.handler).toBeTypeOf("function");
    });

    test("匹配 GET /api/version", () => {
      const result = matchApiRoute("GET", "/api/version");
      expect(result).not.toBeNull();
    });

    test("匹配 GET /api/config", () => {
      const result = matchApiRoute("GET", "/api/config");
      expect(result).not.toBeNull();
    });

    test("匹配 GET /api/tools", () => {
      const result = matchApiRoute("GET", "/api/tools");
      expect(result).not.toBeNull();
    });

    test("匹配 GET /api/mcp/servers", () => {
      const result = matchApiRoute("GET", "/api/mcp/servers");
      expect(result).not.toBeNull();
    });

    test("匹配 GET /api/mcp/servers/:name 提取参数", () => {
      const result = matchApiRoute("GET", "/api/mcp/servers/my-server");
      expect(result).not.toBeNull();
      expect(result!.params["0"]).toBe("my-server");
    });

    test("不存在的路径返回 null", () => {
      expect(matchApiRoute("GET", "/api/nonexistent")).toBeNull();
    });

    test("方法不匹配返回 null", () => {
      expect(matchApiRoute("POST", "/api/health")).toBeNull();
      expect(matchApiRoute("DELETE", "/api/health")).toBeNull();
    });

    test("空路径返回 null", () => {
      expect(matchApiRoute("GET", "")).toBeNull();
      expect(matchApiRoute("GET", "/")).toBeNull();
    });
  });

  describe("handleApiRequest", () => {
    test("OPTIONS 请求返回 CORS 预检响应", async () => {
      const req = new Request("http://localhost/api/health", {
        headers: { Origin: "http://localhost" },
        method: "OPTIONS",
      });
      const res = await handleApiRequest(req);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(204);
      expect(res!.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost");
    });

    test("GET /api/health 返回 ok 状态", async () => {
      const req = new Request("http://localhost/api/health");
      const res = await handleApiRequest(req);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(200);

      const body = (await res!.json()) as { status: string; version?: string; uptime?: number };
      expect(body.status).toBe("ok");
      expect(body.version).toBeDefined();
      expect(body.uptime).toBeDefined();
    });

    test("GET /api/version 返回版本信息", async () => {
      const req = new Request("http://localhost/api/version");
      const res = await handleApiRequest(req);
      expect(res).not.toBeNull();

      const body = (await res!.json()) as { version?: string; name: string };
      expect(body.version).toBeDefined();
      expect(body.name).toBe("crab-cli");
    });

    test("GET /api/tools 返回工具列表", async () => {
      const req = new Request("http://localhost/api/tools");
      const res = await handleApiRequest(req);
      expect(res).not.toBeNull();

      const body = (await res!.json()) as { tools: unknown[] };
      expect(Array.isArray(body.tools)).toBe(true);
      expect(body.tools.length).toBeGreaterThan(0);
    });

    test("不匹配的路径返回 null", async () => {
      const req = new Request("http://localhost/api/nonexistent");
      const res = await handleApiRequest(req);
      expect(res).toBeNull();
    });

    test("响应包含 CORS 头", async () => {
      const req = new Request("http://localhost/api/health", {
        headers: { Origin: "http://localhost" },
      });
      const res = await handleApiRequest(req);
      expect(res!.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost");
      expect(res!.headers.get("Content-Type")).toContain("application/json");
    });

    test("redactSensitive 递归隐藏 providerConfig 和 header 中的敏感信息", () => {
      const body = redactSensitive({
        providerConfig: {
          test: {
            apiKey: "real-key",
            customHeaders: {
              Authorization: "Bearer secret",
              "x-api-key": "header-key",
            },
          },
        },
      }) as {
        providerConfig: { test: { apiKey: string; customHeaders: Record<string, string> } };
      };

      expect(body.providerConfig.test.apiKey).toBe("***");
      expect(body.providerConfig.test.customHeaders.Authorization).toBe("***");
      expect(body.providerConfig.test.customHeaders["x-api-key"]).toBe("***");
    });

    test("非 GET token 认证使用恒时比较 helper", () => {
      const source = readFileSync(join(ROOT, "src/server/apiRoutes.ts"), "utf8");
      expect(source).toContain("safeTokenEquals(extractBearerToken(req), authToken)");
      expect(source).not.toContain("provided !== authToken");
    });
  });

  describe("listApiRoutes", () => {
    test("返回非空数组", () => {
      const routes = listApiRoutes();
      expect(Array.isArray(routes)).toBe(true);
      expect(routes.length).toBeGreaterThan(0);
    });

    test("每条路由包含 method 和 pattern", () => {
      const routes = listApiRoutes();
      for (const route of routes) {
        expect(route.method).toBeTruthy();
        expect(route.pattern).toBeTruthy();
      }
    });

    test("包含已知路由", () => {
      const routes = listApiRoutes();
      const patterns = routes.map((r) => r.pattern);
      // Regex 源中 / 被转义为 \/
      expect(patterns.some((p) => p.includes("api"))).toBe(true);
      expect(patterns.some((p) => p.includes("health"))).toBe(true);
      expect(patterns.some((p) => p.includes("version"))).toBe(true);
      expect(patterns.some((p) => p.includes("tools"))).toBe(true);
    });
  });
});
