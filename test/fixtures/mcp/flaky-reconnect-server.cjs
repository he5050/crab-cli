#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const z = require("zod/v4");

const stateFile = process.argv[2] || path.join(process.cwd(), ".tmp-flaky-reconnect-flag");

const server = new McpServer({
  name: "fixture-flaky-reconnect-server",
  version: "1.0.0",
});

server.registerTool(
  "flaky_echo",
  {
    description: "Fails once by crashing the process, then succeeds after reconnect.",
    inputSchema: { message: z.string() },
  },
  async ({ message }) => {
    if (!fs.existsSync(stateFile)) {
      fs.writeFileSync(stateFile, "crashed-once", "utf8");
      setTimeout(() => process.exit(1), 0);
      await new Promise(() => {});
    }

    return {
      content: [{ text: `recovered:${message}`, type: "text" }],
      structuredContent: { message, recovered: true },
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("flaky-reconnect-server failed", error);
  process.exit(1);
});
