/**
 * MCP 配置加载 — 从 ~/.crab/mcp.json 和项目级 .crab/mcp.json 加载。
 *
 * 职责:
 *   - 加载和合并全局与项目级 MCP 配置
 *   - 支持环境变量插值
 *   - 提供配置的增删改查接口
 *   - 管理配置缓存
 *
 * 模块功能:
 *   - loadMcpConfig:加载 MCP 配置，合并全局 + 项目级
 *   - getMcpServers:获取缓存的 MCP 配置
 *   - resetMcpConfigCache:重置配置缓存
 *   - getProjectMcpConfigPath:获取项目级 mcp.json 路径
 *   - readMergedMcpConfigRecord:读取合并后的配置记录
 *   - readMergedMcpConfigSources:读取配置来源信息
 *   - setGlobalMcpServerEnabled:设置全局 Server 启用状态
 *   - setGlobalMcpToolDisabled:设置全局工具禁用状态
 *
 * 使用场景:
 *   - 应用启动时加载 MCP 配置
 *   - 用户通过 UI 管理 MCP Server 状态
 *   - 需要动态刷新 MCP 配置时
 *
 * 边界:
 *   1. 配置格式为 Record<serverName, serverConfig>
 *   2. 合并策略:项目级覆盖全局级(同名 server 以项目级为准)
 *   3. 支持两种格式:嵌套格式 { mcpServers: {...} } 和扁平格式 { serverName: {...} }
 *   4. 环境变量支持 ${VAR} 和 $VAR 语法
 *   5. 禁用的 Server 仍保留在配置中，由 manager 决定是否连接
 *
 * 流程:
 *   1. 读取全局配置 ~/.crab/mcp.json
 *   2. 向上查找项目级 .crab/mcp.json
 *   3. 合并配置(项目级覆盖全局级)
 *   4. 环境变量插值
 *   5. 转换为 McpServerConfig 数组
 *
 * 配置格式示例:
 * {
 *   "filesystem": {
 *     "command": "npx",
 *     "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
 *     "env": { "DEBUG": "1" },
 *     "type": "stdio"
 *   },
 *   "remote-api": {
 *     "command": "npx",
 *     "args": ["-y", "some-mcp-server"],
 *     "type": "stdio"
 *   }
 * }
 */
import { createLogger } from "@/core/logging/logger";
import { readJsonFile } from "@/core/utilities/fileUtils";
import { getGlobalMcpConfigPath } from "@/config";
import { McpConfigFileSchema, McpServerConfig, type McpServerConfig as McpServerConfigType } from "@/schema/config";
import { interpolateEnvVars, interpolateEnvVarsInArray, interpolateEnvVarsInRecord } from "../cmd/commandResolution";
import path from "node:path";
import fs from "node:fs";

const log = createLogger("mcp:config");

/** 项目级 mcp.json 路径 — 向上查找 .crab/mcp.json */
export function getProjectMcpConfigPath(cwd: string): string | null {
  let dir = path.resolve(cwd);
  while (dir !== "/") {
    const candidate = path.join(dir, ".crab", "mcp.json");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    dir = path.dirname(dir);
  }
  return null;
}

/** MCP 配置缓存 */
let cachedServers: McpServerConfigType[] | null = null;

/**
 * 加载 MCP 配置，合并全局 + 项目级。
 * 结果为 McpServerConfig[](含 name 字段)，兼容 McpManager 接口。
 */
export async function loadMcpConfig(): Promise<McpServerConfigType[]> {
  log.debug(`开始加载 MCP 配置`);

  // 全局级
  const globalPath = getGlobalMcpConfigPath();
  const fileExists = fs.existsSync(globalPath);
  log.info(`[MCP配置] 全局配置路径: ${globalPath}`);
  log.info(`[MCP配置] 文件是否存在: ${fileExists}`);
  log.debug(`加载全局 MCP 配置: ${globalPath}`);
  const globalServers = await loadSingleMcpConfig(globalPath);
  const globalCount = Object.keys(globalServers).length;
  log.debug(`全局配置加载完成: ${globalCount} 个 server(s)`);

  // 项目级
  const projectPath = getProjectMcpConfigPath(process.cwd());
  let projectServers: Record<string, McpConfigEntry> = {};
  if (projectPath) {
    log.debug(`加载项目级 MCP 配置: ${projectPath}`);
    projectServers = await loadSingleMcpConfig(projectPath);
    const projectCount = Object.keys(projectServers).length;
    log.debug(`项目级配置加载完成: ${projectCount} 个 server(s)`);
  } else {
    log.debug(`未找到项目级 MCP 配置`);
  }

  // 合并:项目级覆盖全局级
  const merged = { ...globalServers, ...projectServers };
  const totalBeforeFilter = Object.keys(merged).length;
  log.debug(`合并后共 ${totalBeforeFilter} 个 server(s)(去重前)`);

  // 转换为 McpServerConfig[]
  const servers: McpServerConfigType[] = [];
  let skippedNoCommand = 0;

  for (const [name, entry] of Object.entries(merged)) {
    // 跳过既无 command 也无 url 的条目
    if (!entry.command && !entry.url) {
      log.warn(`MCP server "${name}" has no command or url, skipping`);
      skippedNoCommand++;
      continue;
    }

    // 禁用的 server 仍加入列表(由 manager 决定是否连接)
    // 这样 UI 可以显示所有已配置的 server(含禁用状态)

    // 环境变量插值
    const interpolatedCommand = entry.command ? interpolateEnvVars(entry.command) : undefined;
    const interpolatedArgs = entry.args ? interpolateEnvVarsInArray(entry.args) : [];
    const interpolatedEnv = entry.env ? interpolateEnvVarsInRecord(entry.env) : undefined;
    const interpolatedUrl = entry.url ? interpolateEnvVars(entry.url) : undefined;
    const interpolatedCwd = entry.cwd ? interpolateEnvVars(entry.cwd) : undefined;
    const interpolatedHeaders = entry.headers ? interpolateEnvVarsInRecord(entry.headers) : undefined;

    servers.push(
      McpServerConfig.parse({
        args: interpolatedArgs,
        command: interpolatedCommand,
        cwd: interpolatedCwd,
        disabledTools: entry.disabledTools,
        enabled: entry.enabled,
        env: interpolatedEnv,
        headers: interpolatedHeaders,
        name,
        oauth: entry.oauth,
        timeout: entry.timeout,
        type: entry.type ?? (interpolatedUrl ? "http" : "stdio"),
        url: interpolatedUrl,
      }),
    );
  }

  cachedServers = servers;
  log.info(`MCP 配置加载完成: ${servers.length} 个可用 server(s)(跳过: 无命令=${skippedNoCommand})`);
  return servers;
}

/** 获取缓存的 MCP 配置(如无缓存则加载) */
export async function getMcpServers(): Promise<McpServerConfigType[]> {
  if (!cachedServers) {
    return loadMcpConfig();
  }
  return cachedServers;
}

/** 重置缓存(配置变更时调用) */
export function resetMcpConfigCache(): void {
  cachedServers = null;
}

/** 从单个 mcp.json 文件加载 */
async function loadSingleMcpConfig(filePath: string): Promise<
  Record<
    string,
    {
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      cwd?: string;
      type?: string;
      url?: string;
      headers?: Record<string, string>;
      timeout?: number;
      enabled?: boolean;
      disabledTools?: string[];
      oauth?: false | { clientId?: string; clientSecret?: string; scope?: string; redirectUri?: string };
    }
  >
> {
  try {
    // 先检查文件是否存在
    if (!fs.existsSync(filePath)) {
      log.debug(`mcp.json 不存在: ${filePath}`);
      return {};
    }

    const raw = await readJsonFile(filePath);
    if (!raw || typeof raw !== "object") {
      log.warn(`mcp.json 解析结果为空或非对象: ${filePath}, raw=${JSON.stringify(raw)?.slice(0, 100)}`);
      return {};
    }

    log.info(`mcp.json 加载成功: ${filePath}, keys=${Object.keys(raw as Record<string, unknown>).join(",")}`);

    // 兼容两种格式:
    // 1. { "mcpServers": { ... } }(嵌套格式，兼容旧版)
    // 2. { "serverName": { ... } }(扁平格式，推荐)
    let serverEntries = raw;
    if ("mcpServers" in (raw as Record<string, unknown>)) {
      log.debug(`检测到嵌套格式 mcpServers`);
      serverEntries = (raw as Record<string, unknown>).mcpServers as Record<string, unknown>;
    }

    if (!serverEntries || typeof serverEntries !== "object") {
      log.warn(`mcpServers 内容为空或非对象: ${filePath}`);
      return {};
    }

    // 验证
    const parsed = McpConfigFileSchema.parse({ mcpServers: serverEntries });
    const serverNames = Object.keys(parsed.mcpServers);
    log.info(`mcp.json 解析完成: ${filePath}, servers=[${serverNames.join(", ")}]`);
    return parsed.mcpServers as Record<
      string,
      {
        command?: string;
        args?: string[];
        env?: Record<string, string>;
        cwd?: string;
        type?: string;
        url?: string;
        headers?: Record<string, string>;
        timeout?: number;
        enabled?: boolean;
        disabledTools?: string[];
      }
    >;
  } catch (error) {
    log.warn(`mcp.json 加载失败: ${filePath}, error=${(error as Error).message}`);
    return {};
  }
}

interface McpConfigEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  type?: string;
  url?: string;
  headers?: Record<string, string>;
  timeout?: number;
  enabled?: boolean;
  disabledTools?: string[];
  oauth?: false | { clientId?: string; clientSecret?: string; scope?: string; redirectUri?: string };
}

function toFlatConfigRecord(raw: unknown): Record<string, McpConfigEntry> {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const record = raw as Record<string, unknown>;
  const entries = "mcpServers" in record ? (record.mcpServers as Record<string, unknown>) : record;
  const parsed = McpConfigFileSchema.parse({ mcpServers: entries });
  return parsed.mcpServers as Record<string, McpConfigEntry>;
}

export async function readMergedMcpConfigRecord(cwd = process.cwd()): Promise<Record<string, McpConfigEntry>> {
  const globalRaw = await readJsonFile(getGlobalMcpConfigPath());
  const projectPath = getProjectMcpConfigPath(cwd);
  const projectRaw = projectPath ? await readJsonFile(projectPath) : null;
  return {
    ...toFlatConfigRecord(globalRaw),
    ...toFlatConfigRecord(projectRaw),
  };
}

export async function readMergedMcpConfigSources(
  cwd = process.cwd(),
): Promise<Record<string, { source: "global" | "project"; configPath: string }>> {
  const globalPath = getGlobalMcpConfigPath();
  const projectPath = getProjectMcpConfigPath(cwd);
  const globalRaw = await readJsonFile(globalPath);
  const projectRaw = projectPath ? await readJsonFile(projectPath) : null;
  const globalRecord = toFlatConfigRecord(globalRaw);
  const projectRecord = toFlatConfigRecord(projectRaw);

  const sources: Record<string, { source: "global" | "project"; configPath: string }> = {};

  for (const name of Object.keys(globalRecord)) {
    sources[name] = { configPath: globalPath, source: "global" };
  }
  if (projectPath) {
    for (const name of Object.keys(projectRecord)) {
      sources[name] = { configPath: projectPath, source: "project" };
    }
  }

  return sources;
}

async function writeFlatMcpConfig(filePath: string, record: Record<string, McpConfigEntry>): Promise<boolean> {
  const parsed = McpConfigFileSchema.parse({ mcpServers: record });
  return await import("@/core/utilities/fileUtils").then(({ writeJsonFile }) => writeJsonFile(filePath, parsed));
}

export async function setGlobalMcpServerEnabled(name: string, enabled: boolean): Promise<boolean> {
  log.info(`设置 MCP server "${name}" 启用状态: ${enabled}`);
  const globalPath = getGlobalMcpConfigPath();
  const globalRaw = await readJsonFile(globalPath);
  const globalRecord = toFlatConfigRecord(globalRaw);
  const mergedRecord = await readMergedMcpConfigRecord();
  const base = mergedRecord[name];
  if (!base) {
    log.warn(`MCP server "${name}" 不存在，无法设置启用状态`);
    return false;
  }
  globalRecord[name] = {
    ...base,
    enabled,
  };
  resetMcpConfigCache();
  const result = await writeFlatMcpConfig(globalPath, globalRecord);
  if (result) {
    log.info(`MCP server "${name}" 启用状态已更新: ${enabled}`);
  } else {
    log.error(`MCP server "${name}" 启用状态更新失败`);
  }
  return result;
}

export async function setGlobalMcpToolDisabled(name: string, toolName: string, disabled: boolean): Promise<boolean> {
  log.info(`设置 MCP tool "${name}/${toolName}" 禁用状态: ${disabled}`);
  const globalPath = getGlobalMcpConfigPath();
  const globalRaw = await readJsonFile(globalPath);
  const globalRecord = toFlatConfigRecord(globalRaw);
  const mergedRecord = await readMergedMcpConfigRecord();
  const base = mergedRecord[name];
  if (!base) {
    log.warn(`MCP server "${name}" 不存在，无法设置工具禁用状态`);
    return false;
  }

  const nextDisabledTools = new Set(base.disabledTools ?? []);
  if (disabled) {
    nextDisabledTools.add(toolName);
  } else {
    nextDisabledTools.delete(toolName);
  }

  globalRecord[name] = {
    ...base,
    disabledTools: [...nextDisabledTools].toSorted(),
  };
  resetMcpConfigCache();
  const result = await writeFlatMcpConfig(globalPath, globalRecord);
  if (result) {
    log.info(`MCP tool "${name}/${toolName}" 禁用状态已更新: ${disabled}`);
  } else {
    log.error(`MCP tool "${name}/${toolName}" 禁用状态更新失败`);
  }
  return result;
}
