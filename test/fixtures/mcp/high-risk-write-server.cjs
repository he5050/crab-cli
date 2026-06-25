#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const z = require("zod/v4");

const sandboxRoot = process.env.CRAB_MCP_SANDBOX_ROOT;

function resolveSandboxPath(filePath) {
  if (!sandboxRoot) {
    throw new Error("CRAB_MCP_SANDBOX_ROOT is required");
  }
  const resolved = path.resolve(filePath);
  const sandbox = path.resolve(sandboxRoot);
  if (resolved !== sandbox && !resolved.startsWith(sandbox + path.sep)) {
    throw new Error(`path outside sandbox: ${filePath}`);
  }
  return resolved;
}

const server = new McpServer({
  name: "fixture-high-risk-write-server",
  version: "1.0.0",
});

server.registerTool(
  "write_file",
  {
    description: "Write a file inside the sandbox for MCP permission E2E testing.",
    inputSchema: {
      content: z.string(),
      path: z.string(),
    },
  },
  async ({ path: filePath, content }) => {
    const resolved = resolveSandboxPath(filePath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content, "utf8");
    return {
      content: [
        { text: JSON.stringify({ bytes: Buffer.byteLength(content), ok: true, path: resolved }), type: "text" },
      ],
      structuredContent: { bytes: Buffer.byteLength(content), ok: true, path: resolved },
    };
  },
);

server.registerTool(
  "delete_file",
  {
    description: "Delete a file inside the sandbox for MCP hard-deny testing.",
    inputSchema: {
      path: z.string(),
    },
  },
  async ({ path: filePath }) => {
    const resolved = resolveSandboxPath(filePath);
    fs.unlinkSync(resolved);
    return {
      content: [{ text: JSON.stringify({ deleted: true, ok: true, path: resolved }), type: "text" }],
      structuredContent: { deleted: true, ok: true, path: resolved },
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("high-risk-write-server failed", error);
  process.exit(1);
});
