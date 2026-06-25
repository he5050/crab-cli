/**
 * MCP 配置测试。
 *
 * 测试目标:
 *   - 验证 MCP 工具的发现、配置加载、CRAB_MCP_TEST_* env 变量解析
 *
 * 测试用例:
 *   - 合法配置加载成功
 *   - 缺字段/格式错误时返回明确错误
 *   - 临时目录与原始 env 状态在测试结束后恢复
 */
import { afterEach, describe, expect, mock, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDirs: string[] = [];
const repoCwd = "/Users/hejianfei/Desktop/01-开发项目/06-应用工具/crab-cli";
const originalEnv: Record<string, string | undefined> = {
  CRAB_MCP_TEST_ARG: process.env.CRAB_MCP_TEST_ARG,
  CRAB_MCP_TEST_CMD: process.env.CRAB_MCP_TEST_CMD,
  CRAB_MCP_TEST_CWD: process.env.CRAB_MCP_TEST_CWD,
  CRAB_MCP_TEST_TOKEN: process.env.CRAB_MCP_TEST_TOKEN,
  CRAB_MCP_TEST_URL: process.env.CRAB_MCP_TEST_URL,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
};

function restoreEnv(name: string) {
  const value = originalEnv[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function makeTempProject() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "crab-mcp-config-test-"));
  tempDirs.push(tempDir);
  const configHome = path.join(tempDir, "xdg-config");
  const globalCrabDir = path.join(configHome, "crab");
  const workspace = path.join(tempDir, "workspace");
  const child = path.join(workspace, "packages", "app");
  const projectCrabDir = path.join(workspace, ".crab");
  fs.mkdirSync(globalCrabDir, { recursive: true });
  fs.mkdirSync(child, { recursive: true });
  fs.mkdirSync(projectCrabDir, { recursive: true });
  process.env.XDG_CONFIG_HOME = configHome;
  process.chdir(child);
  return {
    child,
    configHome,
    globalPath: path.join(globalCrabDir, "mcp.json"),
    projectPath: path.join(projectCrabDir, "mcp.json"),
    tempDir,
    workspace,
  };
}

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function loadMcpConfigModule(caseName: string) {
  return await import("@/mcp/manager/mcpConfig.ts");
}

afterEach(() => {
  mock.restore();
  process.chdir(repoCwd);
  for (const name of Object.keys(originalEnv)) {
    restoreEnv(name);
  }
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

describe("mcp-config", () => {
  test("loadMcpConfig 合并全局与项目配置，项目级覆盖并插值环境变量", async () => {
    const files = makeTempProject();
    process.env.CRAB_MCP_TEST_CMD = "node";
    process.env.CRAB_MCP_TEST_ARG = "server.js";
    process.env.CRAB_MCP_TEST_TOKEN = "secret-token";
    process.env.CRAB_MCP_TEST_URL = "https://mcp.example.com/mcp";
    process.env.CRAB_MCP_TEST_CWD = files.workspace;

    writeJson(files.globalPath, {
      globalOnly: {
        args: ["${CRAB_MCP_TEST_ARG}"],
        command: "$CRAB_MCP_TEST_CMD",
        cwd: "$CRAB_MCP_TEST_CWD",
        env: { TOKEN: "$CRAB_MCP_TEST_TOKEN" },
      },
      missingEntrypoint: {
        args: ["no-command-or-url"],
      },
      shared: {
        args: ["global"],
        command: "global-command",
      },
    });
    writeJson(files.projectPath, {
      mcpServers: {
        projectOnly: {
          command: "bun",
          enabled: false,
        },
        shared: {
          disabledTools: ["write_file"],
          headers: { Authorization: "Bearer ${CRAB_MCP_TEST_TOKEN}" },
          oauth: false,
          url: "https://mcp.example.com/mcp",
        },
      },
    });

    const mod = await loadMcpConfigModule("merge");
    const servers = await mod.loadMcpConfig();

    expect(servers.map((server: any) => server.name).toSorted()).toEqual(["globalOnly", "projectOnly", "shared"]);
    expect(servers.find((server: any) => server.name === "missingEntrypoint")).toBeUndefined();

    const globalOnly = servers.find((server: any) => server.name === "globalOnly")!;
    expect(globalOnly.command).toBe("node");
    expect(globalOnly.args).toEqual(["server.js"]);
    expect(globalOnly.env).toEqual({ TOKEN: "secret-token" });
    expect(globalOnly.cwd).toBe(files.workspace);
    expect(globalOnly.type).toBe("stdio");

    const shared = servers.find((server: any) => server.name === "shared")!;
    expect(shared.command).toBeUndefined();
    expect(shared.url).toBe("https://mcp.example.com/mcp");
    expect(shared.type).toBe("http");
    expect(shared.headers).toEqual({ Authorization: "Bearer secret-token" });
    expect(shared.disabledTools).toEqual(["write_file"]);
    expect(shared.oauth).toBe(false);

    const sources = await mod.readMergedMcpConfigSources(files.child);
    expect(sources.globalOnly).toEqual({ configPath: files.globalPath, source: "global" });
    expect(sources.shared).toEqual({ configPath: files.projectPath, source: "project" });
    expect(sources.projectOnly).toEqual({ configPath: files.projectPath, source: "project" });
  });

  test("getMcpServers 使用缓存，resetMcpConfigCache 后重新读取", async () => {
    const files = makeTempProject();
    writeJson(files.globalPath, {
      first: { command: "node" },
    });

    const mod = await loadMcpConfigModule("cache");
    expect((await mod.getMcpServers()).map((server: any) => server.name)).toEqual(["first"]);

    writeJson(files.globalPath, {
      first: { command: "node" },
      second: { command: "bun" },
    });

    expect((await mod.getMcpServers()).map((server: any) => server.name)).toEqual(["first"]);
    mod.resetMcpConfigCache();
    expect((await mod.getMcpServers()).map((server: any) => server.name).toSorted()).toEqual(["first", "second"]);
  });

  test("setGlobalMcpServerEnabled 可基于项目级 server 写回全局启用状态", async () => {
    const files = makeTempProject();
    writeJson(files.globalPath, {});
    writeJson(files.projectPath, {
      projectOnly: {
        args: ["server.ts"],
        command: "bun",
        enabled: true,
      },
    });

    const mod = await loadMcpConfigModule("set-enabled");
    const ok = await mod.setGlobalMcpServerEnabled("projectOnly", false);

    expect(ok).toBe(true);
    const written = JSON.parse(fs.readFileSync(files.globalPath, "utf8"));
    expect(written.mcpServers.projectOnly).toEqual({
      args: ["server.ts"],
      command: "bun",
      enabled: false,
    });
  });

  test("setGlobalMcpToolDisabled 添加、排序、移除 disabledTools", async () => {
    const files = makeTempProject();
    writeJson(files.globalPath, {
      demo: {
        command: "node",
        disabledTools: ["zeta_tool"],
      },
    });

    const mod = await loadMcpConfigModule("set-tool-disabled");
    expect(await mod.setGlobalMcpToolDisabled("demo", "alpha_tool", true)).toBe(true);
    let written = JSON.parse(fs.readFileSync(files.globalPath, "utf8"));
    expect(written.mcpServers.demo.disabledTools).toEqual(["alpha_tool", "zeta_tool"]);

    expect(await mod.setGlobalMcpToolDisabled("demo", "zeta_tool", false)).toBe(true);
    written = JSON.parse(fs.readFileSync(files.globalPath, "utf8"));
    expect(written.mcpServers.demo.disabledTools).toEqual(["alpha_tool"]);

    expect(await mod.setGlobalMcpToolDisabled("missing", "alpha_tool", true)).toBe(false);
  });

  test("无项目级配置时 source 回退到全局且空配置返回空记录", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "crab-mcp-config-empty-"));
    tempDirs.push(tempDir);
    const configHome = path.join(tempDir, "xdg-config");
    const workspace = path.join(tempDir, "workspace");
    fs.mkdirSync(path.join(configHome, "crab"), { recursive: true });
    fs.mkdirSync(workspace, { recursive: true });
    process.env.XDG_CONFIG_HOME = configHome;
    process.chdir(workspace);

    const mod = await loadMcpConfigModule("empty-no-project");

    expect(mod.getProjectMcpConfigPath(workspace)).toBeNull();
    expect(await mod.loadMcpConfig()).toEqual([]);
    expect(await mod.readMergedMcpConfigRecord(workspace)).toEqual({});
    expect(await mod.readMergedMcpConfigSources(workspace)).toEqual({});
  });

  test("非法 mcp.json 不阻断加载，后续有效配置仍可恢复", async () => {
    const files = makeTempProject();
    fs.writeFileSync(files.globalPath, "{not valid json", "utf8");

    const mod = await loadMcpConfigModule("invalid-json");
    expect(await mod.loadMcpConfig()).toEqual([]);

    writeJson(files.globalPath, {
      fixed: {
        args: ["server.js"],
        command: "node",
      },
    });

    mod.resetMcpConfigCache();
    const servers = await mod.loadMcpConfig();
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({
      args: ["server.js"],
      command: "node",
      name: "fixed",
      type: "stdio",
    });
  });

  test("readMergedMcpConfigRecord 支持扁平与嵌套格式并由项目级覆盖", async () => {
    const files = makeTempProject();
    writeJson(files.globalPath, {
      globalOnly: { command: "global-only" },
      shared: { command: "global-node" },
    });
    writeJson(files.projectPath, {
      mcpServers: {
        projectOnly: { command: "project-command" },
        shared: { oauth: {}, url: "https://project.example.com/mcp" },
      },
    });

    const mod = await loadMcpConfigModule("merged-record");
    expect(await mod.readMergedMcpConfigRecord(files.child)).toEqual({
      globalOnly: { args: [], command: "global-only" },
      projectOnly: { args: [], command: "project-command" },
      shared: { args: [], oauth: {}, url: "https://project.example.com/mcp" },
    });
  });

  test("setGlobalMcpToolDisabled 基于项目 server 写回全局并保留已有禁用项排序", async () => {
    const files = makeTempProject();
    writeJson(files.globalPath, {});
    writeJson(files.projectPath, {
      mcpServers: {
        projectTools: {
          command: "bun",
          disabledTools: ["zeta"],
        },
      },
    });

    const mod = await loadMcpConfigModule("project-tool-disabled");
    expect(await mod.setGlobalMcpToolDisabled("projectTools", "alpha", true)).toBe(true);

    const written = JSON.parse(fs.readFileSync(files.globalPath, "utf8"));
    expect(written.mcpServers.projectTools).toEqual({
      args: [],
      command: "bun",
      disabledTools: ["alpha", "zeta"],
    });
  });

  test("loadMcpConfig 不向 console.error 输出调试噪音", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "crab-mcp-config-test-"));
    tempDirs.push(tempDir);
    process.chdir(tempDir);

    const globalConfigPath = path.join(tempDir, "global-mcp.json");
    fs.writeFileSync(
      globalConfigPath,
      JSON.stringify({
        filesystem: {
          args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
          command: "npx",
          type: "stdio",
        },
      }),
      "utf8",
    );

    const actualPaths = await import("@/config/paths/paths");
    mock.module("@/config/paths/paths", () => ({
      ...actualPaths,
      getGlobalMcpConfigPath: () => globalConfigPath,
    }));
    const originalConsoleError = console.error;
    const consoleErrorCalls: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      consoleErrorCalls.push(args);
    };

    try {
      const mod = await import("@/mcp/manager/mcpConfig.ts");
      const servers = await mod.loadMcpConfig();

      expect(servers).toHaveLength(1);
      expect(servers[0]?.name).toBe("filesystem");
      expect(consoleErrorCalls).toHaveLength(0);
    } finally {
      console.error = originalConsoleError;
    }
  });
});
