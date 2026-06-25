/**
 * [LSP Server 注册表]
 *
 * 职责:
 *   - 定义内置 LSP Server 的启动命令和参数
 *   - 发现系统中已安装的 LSP Server
 *   - 提供 Server 配置给 LspManager
 *
 * 模块功能:
 *   - 维护内置 LSP Server 定义表
 *   - 根据 Server ID 获取定义
 *   - 根据语言 ID 查找推荐的 LSP Server
 *   - 检测 LSP Server 是否已安装
 *   - 扫描所有已安装的内置 LSP Server
 *
 * 使用场景:
 *   - LSP Manager 启动 Server 时获取配置
 *   - 检测项目可用语言支持
 *   - 提示用户安装缺失的 LSP Server
 *
 * 边界:
 *   1. 仅包含内置 Server 定义，不包含用户自定义配置
 *   2. 通过 `which` 命令检测安装状态
 *   3. 不支持动态添加内置 Server
 *   4. 检测超时为 5 秒
 *
 * 流程:
 *   1. 定义 builtinServers 内置 Server 表
 *   2. 提供 getServerDefinition 获取定义
 *   3. 提供 findServerForLanguage 按语言查找
 *   4. 提供 isServerInstalled 检测安装
 *   5. 提供 scanInstalledServers 批量扫描
 */
import { createLogger } from "@/core/logging/logger";
import { exec } from "@/bus";

const log = createLogger("lsp:server-registry");

/** LSP Server 定义 */
export interface LspServerDefinition {
  /** Server ID(如 typescript-language-server) */
  id: string;
  /** 显示名称 */
  label: string;
  /** 支持的语言 ID 列表 */
  languages: string[];
  /** 启动命令 */
  command: string;
  /** 默认参数 */
  args: string[];
  /** 通信方式 */
  transport: "stdio" | "socket";
  /** 初始化选项 */
  initializationOptions?: Record<string, unknown>;
  /** 额外配置 */
  settings?: Record<string, unknown>;
  /** 安装提示 */
  installHint?: string;
}

/**
 * 内置 LSP Server 定义表。
 *
 * 每个定义包含启动命令、参数、初始化选项和安装提示。
 */
export const builtinServers: Record<string, LspServerDefinition> = {
  clangd: {
    args: ["--background-index"],
    command: "clangd",
    id: "clangd",
    installHint: "brew install llvm (macOS) 或 apt install clangd (Linux)",
    label: "clangd",
    languages: ["c", "cpp", "c-header", "cpp-header"],
    transport: "stdio",
  },

  gopls: {
    args: ["-mode=stdio"],
    command: "gopls",
    id: "gopls",
    installHint: "go install golang.org/x/tools/gopls@latest",
    label: "Go PLs",
    languages: ["go"],
    settings: {
      gopls: {
        analyses: { unusedparams: true },
        staticcheck: true,
      },
    },
    transport: "stdio",
  },

  intelephense: {
    args: ["--stdio"],
    command: "intelephense",
    id: "intelephense",
    installHint: "npm install -g intelephense",
    label: "Intelephense",
    languages: ["php"],
    transport: "stdio",
  },

  "kotlin-language-server": {
    args: [],
    command: "kotlin-language-server",
    id: "kotlin-language-server",
    installHint: "brew install kotlin-language-server",
    label: "Kotlin Language Server",
    languages: ["kotlin"],
    transport: "stdio",
  },

  "lua-language-server": {
    args: ["--stdio"],
    command: "lua-language-server",
    id: "lua-language-server",
    installHint: "npm install -g lua-language-server",
    label: "Lua Language Server",
    languages: ["lua"],
    transport: "stdio",
  },

  omnisharp: {
    args: ["--stdio"],
    command: "omnisharp",
    id: "omnisharp",
    installHint: "dotnet tool install -g OmniSharp",
    label: "OmniSharp",
    languages: ["csharp"],
    transport: "stdio",
  },

  pyright: {
    args: ["--stdio"],
    command: "pyright-langserver",
    id: "pyright",
    initializationOptions: {},
    installHint: "npm install -g pyright",
    label: "Pyright",
    languages: ["python"],
    transport: "stdio",
  },

  "rust-analyzer": {
    args: [],
    command: "rust-analyzer",
    id: "rust-analyzer",
    initializationOptions: {
      cargo: { loadOutDirsFromCheck: true },
      checkOnSave: { command: "clippy" },
    },
    installHint: "rustup component add rust-analyzer",
    label: "rust-analyzer",
    languages: ["rust"],
    transport: "stdio",
  },

  solargraph: {
    args: ["stdio"],
    command: "solargraph",
    id: "solargraph",
    installHint: "gem install solargraph",
    label: "Solargraph",
    languages: ["ruby"],
    transport: "stdio",
  },

  "sourcekit-lsp": {
    args: [],
    command: "sourcekit-lsp",
    id: "sourcekit-lsp",
    installHint: "Xcode 自带",
    label: "SourceKit-LSP",
    languages: ["swift"],
    transport: "stdio",
  },

  "typescript-language-server": {
    args: ["--stdio"],
    command: "typescript-language-server",
    id: "typescript-language-server",
    initializationOptions: {
      preferences: {
        disableSuggestions: true,
      },
      tsserver: {
        maxTsServerMemory: 4096,
      },
    },
    installHint: "npm install -g typescript-language-server typescript",
    label: "TypeScript Language Server",
    languages: ["typescript", "typescriptreact", "javascript", "javascriptreact"],
    transport: "stdio",
  },

  zls: {
    args: [],
    command: "zls",
    id: "zls",
    installHint: "brew install zls (macOS)",
    label: "Zig Language Server",
    languages: ["zig"],
    transport: "stdio",
  },
};

/**
 * 根据 LSP Server ID 获取定义。
 */
export function getServerDefinition(serverId: string): LspServerDefinition | null {
  return builtinServers[serverId] ?? null;
}

/**
 * 根据语言 ID 查找推荐的 LSP Server。
 */
export function findServerForLanguage(languageId: string): LspServerDefinition | null {
  for (const server of Object.values(builtinServers)) {
    if (server.languages.includes(languageId)) {
      return server;
    }
  }
  return null;
}

/**
 * 检测 LSP Server 是否已安装(可执行)。
 */
export async function isServerInstalled(serverId: string): Promise<boolean> {
  const definition = builtinServers[serverId];
  if (!definition) {
    return false;
  }

  try {
    const result = await exec(["which", definition.command], { timeout: 5000 });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * 扫描所有已安装的内置 LSP Server。
 *
 * @returns 已安装的 Server ID 列表
 */
export async function scanInstalledServers(): Promise<string[]> {
  const results = await Promise.all(
    Object.keys(builtinServers).map(async (id) => {
      const installed = await isServerInstalled(id);
      return installed ? id : null;
    }),
  );
  return results.filter((id): id is string => id !== null);
}

/**
 * 获取所有内置 Server 的定义列表。
 */
export function listBuiltinServers(): LspServerDefinition[] {
  return Object.values(builtinServers);
}
