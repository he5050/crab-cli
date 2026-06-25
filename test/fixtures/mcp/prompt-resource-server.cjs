#!/usr/bin/env node
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const z = require("zod/v4");

const server = new McpServer({
  name: "fixture-prompt-resource-server",
  version: "1.0.0",
});

server.registerPrompt(
  "review_code",
  {
    argsSchema: {
      topic: z.string(),
    },
    description: "Review code with a focus on correctness.",
  },
  async ({ topic }) => ({
    messages: [
      {
        content: {
          text: `Please review ${topic} with a correctness-first lens.`,
          type: "text",
        },
        role: "user",
      },
    ],
  }),
);

server.registerResource(
  "runtime_manual",
  "memo://runtime-manual",
  {
    description: "Runtime MCP manual fixture.",
    mimeType: "text/plain",
  },
  async () => ({
    contents: [
      {
        mimeType: "text/plain",
        text: "Runtime manual for MCP prompt/resource integration tests.",
        uri: "memo://runtime-manual",
      },
    ],
  }),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("prompt-resource-server failed", error);
  process.exit(1);
});
