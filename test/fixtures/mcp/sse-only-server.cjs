#!/usr/bin/env node
const http = require("node:http");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { SSEServerTransport } = require("@modelcontextprotocol/sdk/server/sse.js");
const z = require("zod/v4");

const port = Number(process.argv[2] || 3199);
const transports = {};

function getServer() {
  const server = new McpServer({
    name: "fixture-sse-only-server",
    version: "1.0.0",
  });

  server.registerTool(
    "sse_echo",
    {
      description: "Echo tool exposed through SSE-only server.",
      inputSchema: { message: z.string() },
    },
    async ({ message }) => ({
      content: [{ text: `sse:${message}`, type: "text" }],
      structuredContent: { message, transport: "sse" },
    }),
  );

  return server;
}

const app = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/mcp") {
    const transport = new SSEServerTransport("/messages", res);
    const { sessionId } = transport;
    transports[sessionId] = transport;
    transport.onclose = () => {
      delete transports[sessionId];
    };

    const server = getServer();
    await server.connect(transport);
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/messages")) {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const sessionId = url.searchParams.get("sessionId");
    if (!sessionId || !transports[sessionId]) {
      res.statusCode = 404;
      res.end("Session not found");
      return;
    }

    const body = await new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (chunk) => {
        data += chunk;
      });
      req.on("end", () => resolve(data));
      req.on("error", reject);
    });

    await transports[sessionId].handlePostMessage(req, res, body);
    return;
  }

  res.statusCode = 405;
  res.end("Method Not Allowed");
});

app.listen(port, "127.0.0.1", () => {
  console.log(`SSE only MCP server listening on ${port}`);
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
