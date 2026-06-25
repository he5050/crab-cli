#!/usr/bin/env node
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const z = require("zod/v4");

const server = new McpServer({
  name: "fixture-list-changed-server",
  version: "1.0.0",
});

server.registerTool(
  "alpha_tool",
  {
    description: "Initial tool before list changed.",
    inputSchema: { message: z.string() },
  },
  async ({ message }) => ({
    content: [{ text: `alpha:${message}`, type: "text" }],
    structuredContent: { message, tool: "alpha" },
  }),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  setTimeout(() => {
    server.registerTool(
      "beta_tool",
      {
        description: "Tool added after tools/list_changed.",
        inputSchema: { count: z.number().int().nonnegative() },
      },
      async ({ count }) => ({
        content: [{ text: `beta:${count}`, type: "text" }],
        structuredContent: { count, tool: "beta" },
      }),
    );
  }, 250);
}

main().catch((error) => {
  console.error("list-changed-server failed", error);
  process.exit(1);
});
