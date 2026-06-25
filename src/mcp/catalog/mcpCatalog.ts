/**
 * MCP Catalog — MCP 服务器目录与安装管理。
 *
 * 职责:
 *   - 预置 20+ 常见 MCP 服务器目录
 *   - 提供搜索、获取单个条目、安装到配置文件的功能
 *   - 安装时写入 ~/.crab/mcp.json
 *
 * 模块功能:
 *   - MCP_CATALOG: 预置目录条目数组
 *   - searchCatalog(keyword): 按关键词搜索目录
 *   - getCatalogEntry(name): 获取单个目录条目
 *   - installCatalogEntry(name, config?): 将 MCP 服务器添加到全局配置
 *
 * 使用场景:
 *   - `crab mcp search <keyword>` 搜索可用 MCP 服务器
 *   - `crab mcp install <name>` 安装 MCP 服务器到配置
 *
 * 边界:
 *   1. 仅管理目录数据和安装逻辑，不负责启动 MCP Server
 *   2. 安装时合并到已有的 mcp.json，不覆盖现有配置
 *   3. 支持通过 config 参数覆盖默认安装参数
 */

import { getGlobalMcpConfigPath } from "@/config";
import { readJsonFile, writeJsonFile } from "@/core/utilities/fileUtils";
import { McpConfigFileSchema } from "@/schema/config";
import { resetMcpConfigCache } from "../manager/mcpConfig";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("mcp:catalog");

/** MCP 目录条目接口 */
export interface McpCatalogEntry {
  /** 服务器名称(作为 mcp.json 中的 key) */
  name: string;
  /** 简短描述 */
  description: string;
  /** 安装命令(如 npx -y @modelcontextprotocol/server-filesystem) */
  installCommand: string;
  /** 分类 */
  category:
    | "filesystem"
    | "database"
    | "web"
    | "search"
    | "communication"
    | "automation"
    | "productivity"
    | "security"
    | "development";
  /** 官方 URL */
  officialUrl: string;
  /** 默认参数(可选，覆盖 installCommand 的 args) */
  defaultArgs?: string[];
  /** 默认环境变量(可选) */
  defaultEnv?: Record<string, string>;
}

/** 预置 MCP 服务器目录 */
export const MCP_CATALOG: McpCatalogEntry[] = [
  {
    name: "filesystem",
    description: "文件系统访问 — 读写文件、列目录、搜索文件",
    installCommand: "npx",
    category: "filesystem",
    officialUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
    defaultArgs: ["-y", "@modelcontextprotocol/server-filesystem", "/"],
  },
  {
    name: "github",
    description: "GitHub API — 仓库管理、Issue、PR、搜索",
    installCommand: "npx",
    category: "development",
    officialUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/github",
    defaultArgs: ["-y", "@modelcontextprotocol/server-github"],
    defaultEnv: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_PERSONAL_ACCESS_TOKEN}" },
  },
  {
    name: "postgres",
    description: "PostgreSQL 数据库 — 只读 SQL 查询和 Schema 探索",
    installCommand: "npx",
    category: "database",
    officialUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/postgres",
    defaultArgs: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost:5432/mydb"],
  },
  {
    name: "puppeteer",
    description: "浏览器自动化 — 网页截图、PDF 生成、DOM 操作",
    installCommand: "npx",
    category: "automation",
    officialUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer",
    defaultArgs: ["-y", "@modelcontextprotocol/server-puppeteer"],
  },
  {
    name: "brave-search",
    description: "Brave 搜索引擎 — 网页和本地搜索",
    installCommand: "npx",
    category: "search",
    officialUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search",
    defaultArgs: ["-y", "@modelcontextprotocol/server-brave-search"],
    defaultEnv: { BRAVE_API_KEY: "${BRAVE_API_KEY}" },
  },
  {
    name: "slack",
    description: "Slack API — 频道消息、搜索、用户信息",
    installCommand: "npx",
    category: "communication",
    officialUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/slack",
    defaultArgs: ["-y", "@modelcontextprotocol/server-slack"],
    defaultEnv: { SLACK_BOT_TOKEN: "${SLACK_BOT_TOKEN}" },
  },
  {
    name: "memory",
    description: "知识图谱记忆 — 基于实体的持久化记忆存储",
    installCommand: "npx",
    category: "productivity",
    officialUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
    defaultArgs: ["-y", "@modelcontextprotocol/server-memory"],
  },
  {
    name: "sequential-thinking",
    description: "顺序思考 — 动态思维链推理问题分解",
    installCommand: "npx",
    category: "productivity",
    officialUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking",
    defaultArgs: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
  },
  {
    name: "fetch",
    description: "网页抓取 — 获取 URL 内容并转为 Markdown",
    installCommand: "npx",
    category: "web",
    officialUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",
    defaultArgs: ["-y", "@modelcontextprotocol/server-fetch"],
  },
  {
    name: "excel",
    description: "Excel 文件操作 — 读写 xlsx 文件、数据分析",
    installCommand: "npx",
    category: "productivity",
    officialUrl: "https://github.com/haijiaLiu/mcp-server-excel",
    defaultArgs: ["-y", "mcp-server-excel"],
  },
  {
    name: "context7",
    description: "Context7 — 获取最新库文档和代码示例",
    installCommand: "npx",
    category: "development",
    officialUrl: "https://github.com/upstash/context7",
    defaultArgs: ["-y", "@upstash/context7-mcp"],
  },
  {
    name: "playwright",
    description: "Playwright 浏览器自动化 — 端到端测试和网页交互",
    installCommand: "npx",
    category: "automation",
    officialUrl: "https://github.com/executeautomation/mcp-playwright",
    defaultArgs: ["-y", "@playwright/mcp@latest"],
  },
  {
    name: "obsidian",
    description: "Obsidian 笔记库 — 读取和管理 Markdown 笔记",
    installCommand: "npx",
    category: "productivity",
    officialUrl: "https://github.com/Smithery-AI/obsidian-mcp",
    defaultArgs: ["-y", "obsidian-mcp"],
    defaultEnv: { OBSIDIAN_VAULT_PATH: "${OBSIDIAN_VAULT_PATH}" },
  },
  {
    name: "drawio",
    description: "Draw.io 图表 — 创建和编辑流程图、架构图",
    installCommand: "npx",
    category: "productivity",
    officialUrl: "https://github.com/lgesuell/drawio-mcp-server",
    defaultArgs: ["-y", "drawio-mcp-server"],
  },
  {
    name: "pandoc",
    description: "Pandoc 文档转换 — Markdown、HTML、PDF、Word 等格式互转",
    installCommand: "npx",
    category: "productivity",
    officialUrl: "https://github.com/vivekVells/mcp-pandoc",
    defaultArgs: ["-y", "mcp-pandoc"],
  },
  {
    name: "figma",
    description: "Figma 设计文件 — 获取设计稿数据和组件信息",
    installCommand: "npx",
    category: "development",
    officialUrl: "https://github.com/GLips/Figma-Context-MCP",
    defaultArgs: ["-y", "figma-developer-mcp", "--stdio"],
    defaultEnv: { FIGMA_API_KEY: "${FIGMA_API_KEY}" },
  },
  {
    name: "zread",
    description: "Zread — AI 驱动的文档阅读和摘要",
    installCommand: "npx",
    category: "productivity",
    officialUrl: "https://github.com/zread-zh/zread",
    defaultArgs: ["-y", "zread-mcp"],
  },
  {
    name: "apifox",
    description: "Apifox API 管理 — 接口文档、Mock、自动化测试",
    installCommand: "npx",
    category: "development",
    officialUrl: "https://github.com/apifox/apifox-mcp-server",
    defaultArgs: ["-y", "apifox-mcp-server", "--client=IDE"],
  },
  {
    name: "wechat",
    description: "微信公众号/小程序 — 消息管理、素材管理",
    installCommand: "npx",
    category: "communication",
    officialUrl: "https://github.com/wechat-development/mcp-wechat",
    defaultArgs: ["-y", "mcp-wechat"],
    defaultEnv: { WECHAT_APP_ID: "${WECHAT_APP_ID}", WECHAT_APP_SECRET: "${WECHAT_APP_SECRET}" },
  },
  {
    name: "code-security",
    description: "代码安全扫描 — 检测漏洞、依赖风险、敏感信息泄露",
    installCommand: "npx",
    category: "security",
    officialUrl: "https://github.com/processorai/code-security-mcp",
    defaultArgs: ["-y", "code-security-mcp"],
  },
  {
    name: "sqlite",
    description: "SQLite 数据库 — 本地数据库查询和管理",
    installCommand: "npx",
    category: "database",
    officialUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite",
    defaultArgs: ["-y", "@modelcontextprotocol/server-sqlite", "--db-path", "/tmp/data.db"],
  },
  {
    name: "google-maps",
    description: "Google Maps API — 地理搜索、路线规划、地点详情",
    installCommand: "npx",
    category: "web",
    officialUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/google-maps",
    defaultArgs: ["-y", "@modelcontextprotocol/server-google-maps"],
    defaultEnv: { GOOGLE_MAPS_API_KEY: "${GOOGLE_MAPS_API_KEY}" },
  },
];

/** 目录条目 Map，用于快速查找 */
const CATALOG_MAP = new Map<string, McpCatalogEntry>(MCP_CATALOG.map((entry) => [entry.name, entry]));

/**
 * 搜索 MCP 目录。
 *
 * @param keyword - 搜索关键词(匹配 name、description、category)
 * @returns 匹配的目录条目数组
 */
export function searchCatalog(keyword: string): McpCatalogEntry[] {
  const lowerKeyword = keyword.toLowerCase().trim();
  if (!lowerKeyword) {
    return [...MCP_CATALOG];
  }
  return MCP_CATALOG.filter(
    (entry) =>
      entry.name.toLowerCase().includes(lowerKeyword) ||
      entry.description.toLowerCase().includes(lowerKeyword) ||
      entry.category.toLowerCase().includes(lowerKeyword),
  );
}

/**
 * 获取单个目录条目。
 *
 * @param name - 服务器名称
 * @returns 目录条目，不存在则返回 undefined
 */
export function getCatalogEntry(name: string): McpCatalogEntry | undefined {
  return CATALOG_MAP.get(name);
}

/**
 * 列出所有目录条目。
 */
export function listCatalog(): McpCatalogEntry[] {
  return [...MCP_CATALOG];
}

/** 安装配置选项 */
export interface InstallCatalogOptions {
  /** 覆盖默认参数 */
  args?: string[];
  /** 覆盖默认环境变量 */
  env?: Record<string, string>;
  /** 覆盖传输类型 */
  type?: "stdio" | "sse" | "http";
  /** 覆盖远程 URL(sse/http 模式) */
  url?: string;
}

/**
 * 将 MCP 服务器添加到全局配置文件 (~/.crab/mcp.json)。
 *
 * @param name - 目录中的服务器名称
 * @param options - 可选安装参数覆盖
 * @returns 安装结果
 */
export async function installCatalogEntry(
  name: string,
  options?: InstallCatalogOptions,
): Promise<{ success: boolean; message: string; configPath: string }> {
  const entry = getCatalogEntry(name);
  if (!entry) {
    return {
      success: false,
      message: `目录中未找到 MCP 服务器: ${name}`,
      configPath: "",
    };
  }

  const configPath = getGlobalMcpConfigPath();
  const existingRaw = await readJsonFile(configPath);

  // 解析现有配置
  let existingServers: Record<string, unknown> = {};
  if (existingRaw && typeof existingRaw === "object") {
    const raw = existingRaw as Record<string, unknown>;
    if ("mcpServers" in raw && raw.mcpServers && typeof raw.mcpServers === "object") {
      existingServers = raw.mcpServers as Record<string, unknown>;
    } else {
      // 扁平格式
      existingServers = raw;
    }
  }

  // 检查是否已存在
  if (name in existingServers) {
    log.info(`MCP server "${name}" 已存在于配置中，将覆盖`);
  }

  // 构建服务器配置
  const serverConfig: Record<string, unknown> = {
    command: entry.installCommand,
    args: options?.args ?? entry.defaultArgs ?? [],
    type: options?.type ?? "stdio",
  };

  if (options?.env ?? entry.defaultEnv) {
    serverConfig.env = options?.env ?? entry.defaultEnv;
  }

  if (options?.url) {
    serverConfig.url = options.url;
    serverConfig.type = options.type ?? "http";
    delete serverConfig.command;
    delete serverConfig.args;
  }

  // 合并配置
  existingServers[name] = serverConfig;

  // 验证并写入
  const configToWrite = { mcpServers: existingServers };
  const parsed = McpConfigFileSchema.parse(configToWrite);

  const ok = await writeJsonFile(configPath, parsed);
  if (ok) {
    // 重置配置缓存，使新配置在下次加载时生效
    resetMcpConfigCache();
    log.info(`MCP server "${name}" 已安装到 ${configPath}`);
    return {
      success: true,
      message: `已安装 ${name} 到 ${configPath}`,
      configPath,
    };
  }

  return {
    success: false,
    message: `写入配置文件失败: ${configPath}`,
    configPath,
  };
}
