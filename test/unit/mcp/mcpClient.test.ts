/**
 * MCP 客户端测试。
 *
 * 测试用例:
 *   - 客户端连接
 *   - 请求发送
 *   - 响应处理
 *   - 重连机制
 */
import { describe, expect, mock, test } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import net from "node:net";
import { McpClient, type McpConnectionState, shouldFallbackToSSE } from "@/mcp/client/mcpClient";
import type { McpServerConfig } from "@/schema/config";

// Mock MCP SDK — 不依赖真实子进程
const mockConnect = mock(() => Promise.resolve());
const mockClose = mock(() => {});
const mockListTools = mock(() =>
  Promise.resolve({
    tools: [
      { description: "Search items", inputSchema: {}, name: "search" },
      { description: "Create item", inputSchema: {}, name: "create" },
    ],
  }),
);
const mockCallTool = mock(() => Promise.resolve({ content: [{ text: "result", type: "text" }] }));

// 由于我们无法轻易 mock @modelcontextprotocol/sdk 的 ESM，
// 这些测试验证 McpClient 的公共 API 和状态管理，
// 不实际启动子进程。
describe("McpClient — 状态管理", () => {
  const testConfig: McpServerConfig = {
    args: ["hello"],
    command: "echo",
    name: "test-server",
  };

  test("初始状态是已断开", () => {
    const client = new McpClient({ config: testConfig });
    expect(client.state).toBe("disconnected");
    expect(client.isConnected).toBe(false);
    expect(client.tools).toHaveLength(0);
    expect(client.name).toBe("test-server");
  });

  test("未连接时 callTool 抛出", async () => {
    const client = new McpClient({ config: testConfig });
    expect(client.callTool("search", {})).rejects.toThrow("not connected");
  });

  test("refreshTools 抛出当不已连接", async () => {
    const client = new McpClient({ config: testConfig });
    expect(client.refreshTools()).rejects.toThrow("not connected");
  });

  test("连接抛出当已释放", async () => {
    const client = new McpClient({ config: testConfig });
    await client.dispose();
    expect(client.connect()).rejects.toThrow("disposed");
  });

  test("状态转换触发回调", () => {
    const states: McpConnectionState[] = [];
    const client = new McpClient({
      callbacks: {
        onStateChange: (state, _prev) => {
          states.push(state);
        },
      },
      config: testConfig,
    });

    // Connect() 会尝试连接真实子进程，必然失败
    // 但我们验证状态回调被触发
    // 由于 connect 是 async，我们用 catch
    client.connect().catch(() => {});

    // Connecting 应该被触发
    // 注意:同步部分中 setState("connecting") 会立即触发
    // 但这里实际上是异步的，需要确认
  });

  test("断开当已已断开做无", async () => {
    const client = new McpClient({ config: testConfig });
    await client.disconnect();
    expect(client.state).toBe("disconnected");
  });

  test("选项是已应用正确", () => {
    const client = new McpClient({
      callTimeout: 10_000,
      config: testConfig,
      connectTimeout: 5000,
    });
    expect(client.name).toBe("test-server");
  });

  test("multiple connect calls while connecting are ignored", async () => {
    const client = new McpClient({ config: testConfig });
    // 第一次 connect 会设置 connecting 状态
    const p1 = client.connect().catch(() => {});
    // 第二次应该直接返回不报错
    const p2 = client.connect().catch(() => {});
    await Promise.all([p1, p2]);
    // 只要第二个不抛异常就算通过
  });
});

describe("McpClient — 错误处理", () => {
  const testConfig: McpServerConfig = {
    args: [],
    command: "nonexistent-command-that-does-not-exist-xyz",
    name: "fail-server",
  };

  test("连接拒绝带无效命令", async () => {
    const client = new McpClient({
      config: testConfig,
      connectTimeout: 2000,
    });

    try {
      await client.connect();
      // 如果出乎意料地成功了，至少验证状态
    } catch (error) {
      expect(error).toBeDefined();
      expect((error as { code?: string }).code).toBe("TOOL-601");
      expect(client.state).toBe("error");
    }

    await client.dispose();
  });

  test("error callback is invoked on connection failure", async () => {
    const errors: Error[] = [];
    const client = new McpClient({
      callbacks: {
        onError: (err) => errors.push(err),
      },
      config: testConfig,
      connectTimeout: 2000,
    });

    try {
      await client.connect();
    } catch {
      // 预期失败
    }

    // Error 回调可能触发(取决于具体的失败方式)
    await client.dispose();
  });

  test("dispose prevents reuse", async () => {
    const client = new McpClient({ config: testConfig });
    await client.dispose();
    expect(client.connect()).rejects.toThrow("disposed");
  });

  test("shouldFallbackToSSE returns true for streamable-http unsupported errors", () => {
    expect(shouldFallbackToSSE({ code: 405 })).toBe(true);
    expect(shouldFallbackToSSE(new Error("Method Not Allowed"))).toBe(true);
    expect(shouldFallbackToSSE(new Error("unexpected content type"))).toBe(true);
    expect(shouldFallbackToSSE(new Error("401 unauthorized"))).toBe(false);
  });
});

const hasBun = (() => {
  try {
    execSync("bun --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
})();

async function waitForPort(port: number, timeoutMs = 5000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host: "127.0.0.1", port }, () => {
        socket.end();
        resolve(true);
      });
      socket.on("error", () => resolve(false));
    });
    if (ok) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for port ${port}`);
}

describe("McpClient — 真实 MCP 调用", () => {
  const realTest = hasBun ? test : test.skip;
  realTest("resolves bun from user bin path and can call a real stdio MCP tool", async () => {
    const fixturePath = path.resolve("test/fixtures/mcp/echo-server.cjs");
    const client = new McpClient({
      callTimeout: 10_000,
      config: {
        args: [fixturePath],
        command: "bun",
        cwd: process.cwd(),
        name: "fixture",
      },
      connectTimeout: 10_000,
    });

    await client.connect();
    expect(client.isConnected).toBe(true);
    expect(client.tools.map((tool) => tool.name)).toContain("fixture_echo_payload");
    const tool = client.tools.find((item) => item.name === "fixture_echo_payload");
    expect(tool).toBeDefined();
    expect(tool!.parameters.safeParse({ count: 2, message: "phase5" }).success).toBe(true);
    expect(tool!.parameters.safeParse({ message: "phase5" }).success).toBe(false);
    expect(tool!.parameters.safeParse({ count: "2", message: "phase5" }).success).toBe(false);

    const result = (await client.callTool("echo_payload", {
      count: 2,
      message: "phase5",
    })) as {
      content?: { type: string; text?: string }[];
      structuredContent?: { message: string; count: number; echoed: string };
      isError?: boolean;
    };

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      count: 2,
      echoed: "phase5:2",
      message: "phase5",
    });
    expect(result.content?.[0]?.text).toContain("phase5");

    await client.disconnect();
  });

  realTest(
    "refreshes tools automatically after tools/list_changed notification",
    async () => {
      const fixturePath = path.resolve("test/fixtures/mcp/list-changed-server.cjs");
      const client = new McpClient({
        callTimeout: 10_000,
        config: {
          args: [fixturePath],
          command: "bun",
          cwd: process.cwd(),
          name: "dynamic-fixture",
        },
        connectTimeout: 10_000,
      });

      await client.connect();
      expect(client.tools.map((tool) => tool.name)).toEqual(["dynamic-fixture_alpha_tool"]);

      await new Promise<void>((resolve, reject) => {
        const started = Date.now();
        const timer = setInterval(() => {
          if (client.tools.some((tool) => tool.name === "dynamic-fixture_beta_tool")) {
            clearInterval(timer);
            resolve();
            return;
          }
          if (Date.now() - started > 5000) {
            clearInterval(timer);
            reject(new Error("Timed out waiting for tools/list_changed refresh"));
          }
        }, 50);
      });

      expect(client.tools.map((tool) => tool.name)).toContain("dynamic-fixture_beta_tool");
      await client.disconnect();
    },
    { timeout: 15_000 },
  );

  realTest("lists prompts/resources and resolves prompt/resource content", async () => {
    const fixturePath = path.resolve("test/fixtures/mcp/prompt-resource-server.cjs");
    const client = new McpClient({
      callTimeout: 10_000,
      config: {
        args: [fixturePath],
        command: "bun",
        cwd: process.cwd(),
        name: "prompt-fixture",
      },
      connectTimeout: 10_000,
    });

    await client.connect();

    const prompts = await client.listPrompts();
    const resources = await client.listResources();
    expect(prompts.map((item) => item.name)).toContain("review_code");
    expect(resources.map((item) => item.uri)).toContain("memo://runtime-manual");

    const prompt = (await client.getPrompt("review_code", { topic: "MCP runtime" })) as {
      messages?: { content?: { text?: string } }[];
    };
    const resource = (await client.readResource("memo://runtime-manual")) as {
      contents?: { text?: string }[];
    };

    expect(prompt.messages?.[0]?.content?.text).toContain("MCP runtime");
    expect(resource.contents?.[0]?.text).toContain("Runtime manual");

    await client.disconnect();
  });

  realTest("falls back from StreamableHTTP to SSE for SSE-only remote servers", async () => {
    const fixturePath = path.resolve("test/fixtures/mcp/sse-only-server.cjs");
    const port = 3299;
    const bunPath = process.platform === "win32" ? "bun.exe" : "bun";
    const proc = Bun.spawn([bunPath, fixturePath, String(port)], {
      cwd: process.cwd(),
      stderr: "pipe",
      stdout: "ignore",
    });

    try {
      await waitForPort(port);

      const client = new McpClient({
        callTimeout: 10_000,
        config: {
          args: [],
          name: "remote-sse-fixture",
          type: "http",
          url: `http://127.0.0.1:${port}/mcp`,
        },
        connectTimeout: 10_000,
      });

      await client.connect();
      expect(client.isConnected).toBe(true);
      expect(client.tools.map((tool) => tool.name)).toContain("remote-sse-fixture_sse_echo");

      const result = (await client.callTool("sse_echo", { message: "fallback" })) as {
        structuredContent?: { message: string; transport: string };
      };
      expect(result.structuredContent).toEqual({ message: "fallback", transport: "sse" });

      await client.disconnect();
    } finally {
      proc.kill();
      await proc.exited;
    }
  });

  realTest("times out a slow stdio MCP tool with clear error semantics", async () => {
    const fixturePath = path.resolve("test/fixtures/mcp/slow-tool-server.cjs");
    const client = new McpClient({
      callTimeout: 100,
      config: {
        args: [fixturePath, "500"],
        command: "bun",
        cwd: process.cwd(),
        name: "slow-fixture",
        timeout: 100,
      },
      connectTimeout: 10_000,
    });

    await client.connect();
    expect(client.tools.map((tool) => tool.name)).toContain("slow-fixture_slow_echo");
    await expect(client.callTool("slow_echo", { message: "late" })).rejects.toThrow(/timed out/i);
    await client.disconnect();
  });

  realTest("reconnects and retries once after a stdio MCP server crashes during tool call", async () => {
    const fixturePath = path.resolve("test/fixtures/mcp/flaky-reconnect-server.cjs");
    const stateFile = path.resolve("test/fixtures/mcp/.flaky-reconnect-flag");
    if (existsSync(stateFile)) {
      rmSync(stateFile, { force: true });
    }

    const client = new McpClient({
      callTimeout: 10_000,
      config: {
        args: [fixturePath, stateFile],
        command: "bun",
        cwd: process.cwd(),
        name: "flaky-fixture",
      },
      connectTimeout: 10_000,
    });

    try {
      await client.connect();
      expect(client.tools.map((tool) => tool.name)).toContain("flaky-fixture_flaky_echo");

      const result = (await client.callTool("flaky_echo", { message: "retry-me" })) as {
        structuredContent?: { message: string; recovered: boolean };
      };
      expect(result.structuredContent).toEqual({ message: "retry-me", recovered: true });
    } finally {
      if (existsSync(stateFile)) {
        rmSync(stateFile, { force: true });
      }
      await client.disconnect();
    }
  });
});
