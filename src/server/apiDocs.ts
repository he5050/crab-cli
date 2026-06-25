/**
 * API 文档生成模块 — 构建 OpenAPI 规范、HTML 文档页与浏览器端 JS 客户端。
 *
 * 职责:
 *   - 生成 OpenAPI 3.0.3 契约 JSON
 *   - 渲染交互式 HTML 文档页
 *   - 生成浏览器端 fetch 客户端脚本
 *   - 保持 apiRoutes.ts 专注于路由与请求处理
 *
 * 模块功能:
 *   - buildOpenApiSpec(): 构造 OpenAPI 契约
 *   - buildApiDocsHtml(): 渲染文档 HTML
 *   - buildApiClientJs(): 生成浏览器端 fetch 客户端
 *   - OpenApiSpec / OpenApiOperation: OpenAPI 类型
 *
 * 使用场景:
 *   - 浏览器访问 /api/docs 查看接口文档
 *   - 外部 SDK 通过 /api/openapi.json 读取契约
 *   - 浏览器脚本通过 /api/client.js 调用 API
 *
 * 边界:
 *   1. 仅生成静态文档/客户端，不处理运行时请求
 *   2. 错误码来自调用方传入的 ApiErrorCodeMap
 *   3. 文档页内置基础样式，无外部依赖
 *
 * 流程:
 *   1. 根据当前路由表与错误码构造 OpenAPI 结构
 *   2. 将 OpenAPI JSON 嵌入到 HTML 文档模板
 *   3. 生成最小可用的浏览器 fetch 客户端
 */
import { VERSION } from "@/config/version";
import { escapeHtml } from "@/tool/shared/html";

export interface OpenApiOperation {
  summary: string;
  description?: string;
  security?: Record<string, string[]>[];
  parameters?: Record<string, unknown>[];
  requestBody?: Record<string, unknown>;
  responses: Record<string, Record<string, unknown>>;
}

export interface OpenApiSpec {
  openapi: "3.0.3";
  info: { title: string; version: string };
  servers: { url: string }[];
  components: {
    securitySchemes: {
      bearerAuth: { type: "http"; scheme: "bearer" };
    };
    schemas: Record<string, unknown>;
  };
  paths: Record<string, Record<string, OpenApiOperation>>;
}

type ApiErrorCodeMap = Record<string, string>;

function jsonResponse(description = "OK"): Record<string, unknown> {
  return {
    content: {
      "application/json": {
        schema: { type: "object" },
      },
    },
    description,
  };
}

function errorResponse(description: string): Record<string, unknown> {
  return {
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/ApiError" },
      },
    },
    description,
  };
}

function pathParam(name: string, description: string): Record<string, unknown> {
  return {
    description,
    in: "path",
    name,
    required: true,
    schema: { type: "string" },
  };
}

function queryParam(name: string, schema: Record<string, unknown>, description: string): Record<string, unknown> {
  return {
    description,
    in: "query",
    name,
    required: false,
    schema,
  };
}

function bearerSecurity(): Record<string, string[]>[] {
  return [{ bearerAuth: [] }];
}

export function buildOpenApiSpec(apiErrorCodes: ApiErrorCodeMap): OpenApiSpec {
  return {
    components: {
      schemas: {
        ApiError: {
          properties: {
            code: { enum: Object.values(apiErrorCodes), type: "string" },
            error: { description: "兼容字段，等同 message", type: "string" },
            message: { type: "string" },
          },
          required: ["error", "code", "message"],
          type: "object",
        },
      },
      securitySchemes: {
        bearerAuth: { scheme: "bearer", type: "http" },
      },
    },
    info: { title: "Crab CLI API", version: VERSION },
    openapi: "3.0.3",
    paths: {
      "/api/client.js": {
        get: {
          responses: {
            "200": {
              content: { "application/javascript": { schema: { type: "string" } } },
              description: "Browser JavaScript API client",
            },
          },
          summary: "Web UI API 调用层",
        },
      },
      "/api/config": {
        get: {
          responses: { "200": jsonResponse() },
          summary: "读取脱敏配置",
        },
      },
      "/api/docs": {
        get: {
          responses: {
            "200": {
              content: { "text/html": { schema: { type: "string" } } },
              description: "HTML documentation",
            },
          },
          summary: "API 文档页",
        },
      },
      "/api/git/status": {
        get: {
          responses: { "200": jsonResponse(), "400": jsonResponse("Not a git repository") },
          summary: "Git 状态",
        },
      },
      "/api/health": {
        get: {
          responses: { "200": jsonResponse() },
          summary: "健康检查",
        },
      },
      "/api/ide/clients": {
        get: {
          responses: { "200": jsonResponse() },
          summary: "IDE 客户端列表",
        },
      },
      "/api/ide/context": {
        get: {
          responses: { "200": jsonResponse() },
          summary: "IDE 编辑器上下文",
        },
      },
      "/api/ide/status": {
        get: {
          responses: { "200": jsonResponse() },
          summary: "IDE 连接状态",
        },
      },
      "/api/ide/vsix/surface": {
        get: {
          responses: { "200": jsonResponse() },
          summary: "VSIX 能力面",
        },
      },
      "/api/mcp/servers": {
        get: {
          responses: { "200": jsonResponse() },
          summary: "MCP 服务列表",
        },
      },
      "/api/mcp/servers/{name}": {
        get: {
          parameters: [pathParam("name", "MCP 服务名")],
          responses: { "200": jsonResponse(), "404": errorResponse("Server not found") },
          summary: "MCP 服务详情",
        },
      },
      "/api/metrics": {
        get: {
          responses: {
            "200": {
              content: { "text/plain": { schema: { type: "string" } } },
              description: "Prometheus text exposition",
            },
          },
          summary: "Prometheus metrics",
        },
      },
      "/api/openapi.json": {
        get: {
          responses: { "200": jsonResponse() },
          summary: "OpenAPI 契约",
        },
      },
      "/api/rollback-points": {
        get: {
          parameters: [queryParam("sessionId", { type: "string" }, "会话 ID")],
          responses: { "200": jsonResponse() },
          summary: "分支点列表",
        },
      },
      "/api/rollback-points/{branchPointId}": {
        delete: {
          parameters: [pathParam("branchPointId", "分支点 ID")],
          responses: {
            "200": jsonResponse(),
            "401": errorResponse("Unauthorized"),
            "404": errorResponse("分支点不存在"),
          },
          security: bearerSecurity(),
          summary: "删除分支点",
        },
        get: {
          parameters: [pathParam("branchPointId", "分支点 ID")],
          responses: { "200": jsonResponse(), "404": errorResponse("分支点不存在") },
          summary: "分支点详情",
        },
      },
      "/api/rollback-points/{branchPointId}/rollback": {
        post: {
          parameters: [pathParam("branchPointId", "分支点 ID")],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  properties: {
                    strategy: { enum: ["fork", "replace"], type: "string" },
                  },
                  type: "object",
                },
              },
            },
            required: false,
          },
          responses: {
            "200": jsonResponse(),
            "400": errorResponse("Bad request"),
            "401": errorResponse("Unauthorized"),
          },
          security: bearerSecurity(),
          summary: "回滚到分支点",
        },
      },
      "/api/sessions": {
        get: {
          parameters: [
            queryParam("q", { type: "string" }, "按 id/title 搜索"),
            queryParam("search", { type: "string" }, "按 id/title 搜索"),
            queryParam("status", { type: "string" }, "会话状态过滤"),
            queryParam("limit", { minimum: 1, type: "integer" }, "分页大小"),
            queryParam("offset", { minimum: 0, type: "integer" }, "分页偏移"),
          ],
          responses: { "200": jsonResponse() },
          summary: "会话列表",
        },
        post: {
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  properties: {
                    model: { type: "string" },
                    projectDir: { type: "string" },
                    title: { type: "string" },
                  },
                  type: "object",
                },
              },
            },
            required: false,
          },
          responses: {
            "201": jsonResponse("Created"),
            "400": errorResponse("Bad request"),
            "401": errorResponse("Unauthorized"),
          },
          security: bearerSecurity(),
          summary: "创建会话",
        },
      },
      "/api/sessions/{sessionId}": {
        delete: {
          parameters: [pathParam("sessionId", "会话 ID")],
          responses: {
            "200": jsonResponse(),
            "401": errorResponse("Unauthorized"),
            "404": errorResponse("会话不存在"),
          },
          security: bearerSecurity(),
          summary: "删除会话",
        },
        get: {
          parameters: [pathParam("sessionId", "会话 ID")],
          responses: { "200": jsonResponse(), "404": errorResponse("会话不存在") },
          summary: "会话详情",
        },
      },
      "/api/sessions/{sessionId}/compress": {
        post: {
          parameters: [pathParam("sessionId", "会话 ID")],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  properties: {
                    mode: { enum: ["compact", "hybrid"], type: "string" },
                  },
                  type: "object",
                },
              },
            },
            required: false,
          },
          responses: {
            "200": jsonResponse(),
            "400": errorResponse("Bad request"),
            "401": errorResponse("Unauthorized"),
            "404": errorResponse("会话不存在"),
          },
          security: bearerSecurity(),
          summary: "压缩会话并生成 checkpoint",
        },
      },
      "/api/sessions/{sessionId}/fork": {
        post: {
          parameters: [pathParam("sessionId", "会话 ID")],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  properties: { title: { type: "string" } },
                  type: "object",
                },
              },
            },
            required: false,
          },
          responses: {
            "200": jsonResponse(),
            "400": errorResponse("Bad request"),
            "401": errorResponse("Unauthorized"),
            "404": errorResponse("源会话不存在"),
          },
          security: bearerSecurity(),
          summary: "分叉会话",
        },
      },
      "/api/sessions/{sessionId}/messages": {
        get: {
          parameters: [pathParam("sessionId", "会话 ID")],
          responses: { "200": jsonResponse(), "404": errorResponse("会话不存在") },
          summary: "会话消息列表",
        },
      },
      "/api/tools": {
        get: {
          responses: { "200": jsonResponse() },
          summary: "工具列表",
        },
      },
      "/api/version": {
        get: {
          responses: { "200": jsonResponse() },
          summary: "版本信息",
        },
      },
    },
    servers: [{ url: "http://localhost:3000" }],
  };
}

export function buildApiDocsHtml(spec: OpenApiSpec): string {
  const rows = Object.entries(spec.paths)
    .flatMap(([routePath, operations]) => Object.entries(operations).map(([method, op]) => ({ method, op, routePath })))
    .map(
      ({ routePath, method, op }) =>
        `<tr><td><code>${method.toUpperCase()}</code></td><td><code>${routePath}</code></td><td>${escapeHtml(op.summary)}</td></tr>`,
    )
    .join("");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>Crab CLI API</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:32px;line-height:1.5;color:#1f2937;background:#f9fafb}
    main{max-width:1080px;margin:0 auto}
    table{width:100%;border-collapse:collapse;background:white}
    th,td{border:1px solid #d1d5db;padding:8px 10px;text-align:left}
    th{background:#f3f4f6}
    code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
    a{color:#2563eb}
  </style>
</head>
<body>
  <main>
    <h1>Crab CLI API</h1>
    <p>OpenAPI: <a href="/api/openapi.json">/api/openapi.json</a> · Web client: <a href="/api/client.js">/api/client.js</a> · Prometheus: <a href="/api/metrics">/api/metrics</a></p>
    <h2>错误格式</h2>
    <pre>{"error":"会话不存在","code":"SESSION_NOT_FOUND","message":"会话不存在"}</pre>
    <h2>Routes</h2>
    <table><thead><tr><th>Method</th><th>Path</th><th>Summary</th></tr></thead><tbody>${rows}</tbody></table>
  </main>
</body>
</html>`;
}

export function buildApiClientJs(): string {
  return `export class CrabApiClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || "";
    this.token = options.token || null;
  }
  async request(path, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (this.token) headers.Authorization = "Bearer " + this.token;
    const response = await fetch(this.baseUrl + path, { ...options, headers });
    const contentType = response.headers.get("content-type") || "";
    const body = contentType.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) {
      const err = new Error((body && body.message) || (body && body.error) || response.statusText);
      err.status = response.status;
      err.code = body && body.code;
      err.body = body;
      throw err;
    }
    return body;
  }
  health() { return this.request("/api/health"); }
  sessions(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request("/api/sessions" + (query ? "?" + query : ""));
  }
  createSession(body = {}) { return this.request("/api/sessions", { method: "POST", body: JSON.stringify(body) }); }
  rollbackPoints(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request("/api/rollback-points" + (query ? "?" + query : ""));
  }
  rollback(branchPointId, strategy = "fork") {
    return this.request("/api/rollback-points/" + encodeURIComponent(branchPointId) + "/rollback", {
      method: "POST",
      body: JSON.stringify({ strategy }),
    });
  }
}
window.CrabApiClient = CrabApiClient;
`;
}
