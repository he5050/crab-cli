#!/usr/bin/env node
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const z = require("zod/v4");

const delayMs = Number(process.argv[2] || 500);

const server = new McpServer({
  name: "fixture-slow-tool-server",
  version: "1.0.0",
});

server.registerTool(
  "slow_echo",
  {
    description: "Sleeps before returning, used to validate timeout behavior.",
    inputSchema: { message: z.string() },
  },
  async ({ message }) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return {
      content: [{ text: `slow:${message}`, type: "text" }],
      structuredContent: { delayMs, message },
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("slow-tool-server failed", error);
  process.exit(1);
});
