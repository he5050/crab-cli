#!/usr/bin/env node
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const z = require("zod/v4");

const server = new McpServer({
  name: "fixture-echo-server",
  version: "1.0.0",
});

server.registerTool(
  "echo_payload",
  {
    description: "Echoes the input payload for integration testing.",
    inputSchema: {
      count: z.number().int().nonnegative(),
      message: z.string(),
    },
  },
  async ({ message, count }) => ({
    content: [
      {
        text: JSON.stringify({ count, message }),
        type: "text",
      },
    ],
    structuredContent: {
      count,
      echoed: `${message}:${count}`,
      message,
    },
  }),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("echo-server failed", error);
  process.exit(1);
});
