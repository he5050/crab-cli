/**
 * [LSP 配置模块]
 *
 * 职责:
 *   - 从 .crab/config.json 加载用户自定义 LSP Server 配置
 *   - 合并内置 Server 定义和用户自定义配置
 *   - 支持禁用/覆盖内置 Server
 *
 * 模块功能:
 *   - 从配置文件加载 LSP 配置
 *   - 解析合并内置和用户自定义配置
 *   - 获取指定语言的可用 LSP Server
 *   - 支持自定义 Server 注册
 *
 * 使用场景:
 *   - 项目初始化时加载 LSP 配置
 *   - 用户自定义 LSP Server 支持
 *   - 禁用不需要的内置 Server
 *   - 覆盖内置 Server 的默认设置
 *
 * 边界:
 *   1. 配置文件路径固定为 .crab/config.json 或 .crab/lsp.json
 *   2. 用户自定义 Server 优先级高于内置 Server
 *   3. 禁用列表仅作用于内置 Server
 *   4. 配置错误时返回空配置而非抛出异常
 *
 * 流程:
 *   1. 尝试从 .crab/config.json 读取 "lsp" 节
 *   2. 回退到 .crab/lsp.json
 *   3. 合并内置 Server 和用户自定义配置
 *   4. 应用用户设置覆盖到内置 Server
 *   5. 添加用户自定义 Server 到配置表
 *   6. 返回解析后的完整配置
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "@/core/logging/logger";
import { type LspServerDefinition, builtinServers } from "../registry/serverRegistry";

const log = createLogger("lsp:config");

/** 单个用户自定义 LSP Server 配置 */
export interface UserLspServerConfig {
  /** 启动命令 */
  command: string;
  /** 命令参数 */
  args?: string[];
  /** 支持的语言 */
  languages: string[];
  /** 通信方式(默认 stdio) */
  transport?: "stdio" | "socket";
  /** 初始化选项 */
  initializationOptions?: Record<string, unknown>;
  /** 额外设置 */
  settings?: Record<string, unknown>;
}

/** LSP 配置节 */
export interface LspConfig {
  /** 自定义 LSP Server(key 为 Server ID) */
  servers?: Record<string, UserLspServerConfig>;
  /** 禁用的内置 Server ID 列表 */
  disabled?: string[];
  /** 覆盖内置 Server 的设置(key 为 Server ID) */
  settings?: Record<string, Record<string, unknown>>;
}

/** 加载后的完整 LSP Server 列表 */
export interface ResolvedLspConfig {
  /** 所有可用的 Server 定义(内置 + 自定义) */
  servers: Record<string, LspServerDefinition>;
  /** 被禁用的 Server ID */
  disabled: Set<string>;
}

/**
 * 从项目根目录加载 LSP 配置。
 *
 * 按优先级查找:
 *   1. .claude/config.json 中的 "lsp" 节
 *   2. .claude/lsp.json
 *   3. .crab/config.json 中的 "lsp" 节
 *   4. .crab/lsp.json
 */
export function loadLspConfig(projectRoot: string): LspConfig {
  // 方式 1:从 .claude/config.json 读取
  const configPath = join(projectRoot, ".claude", "config.json");
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, "utf8");
      const config = JSON.parse(content);
      if (config.lsp && typeof config.lsp === "object") {
        log.debug(`从 ${configPath} 加载 LSP 配置`);
        return config.lsp as LspConfig;
      }
    } catch (error) {
      log.warn(`读取 LSP 配置失败: ${configPath}`, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  // 方式 2:从 .claude/lsp.json 读取
  const lspPath = join(projectRoot, ".claude", "lsp.json");
  if (existsSync(lspPath)) {
    try {
      const content = readFileSync(lspPath, "utf8");
      log.debug(`从 ${lspPath} 加载 LSP 配置`);
      return JSON.parse(content) as LspConfig;
    } catch (error) {
      log.warn(`读取 LSP 配置失败: ${lspPath}`, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  // 方式 3:从 .crab/config.json 读取(向后兼容)
  const crabConfigPath = join(projectRoot, ".crab", "config.json");
  if (existsSync(crabConfigPath)) {
    try {
      const content = readFileSync(crabConfigPath, "utf8");
      const config = JSON.parse(content);
      if (config.lsp && typeof config.lsp === "object") {
        log.debug(`从 ${crabConfigPath} 加载 LSP 配置`);
        return config.lsp as LspConfig;
      }
    } catch (error) {
      log.warn(`读取 LSP 配置失败: ${crabConfigPath}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // 方式 4:从 .crab/lsp.json 读取(向后兼容)
  const crabLspPath = join(projectRoot, ".crab", "lsp.json");
  if (existsSync(crabLspPath)) {
    try {
      const content = readFileSync(crabLspPath, "utf8");
      log.debug(`从 ${crabLspPath} 加载 LSP 配置`);
      return JSON.parse(content) as LspConfig;
    } catch (error) {
      log.warn(`读取 LSP 配置失败: ${crabLspPath}`, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  return {};
}

/**
 * 解析完整的 LSP Server 配置(合并内置 + 用户自定义)。
 */
export function resolveLspConfig(projectRoot?: string): ResolvedLspConfig {
  const userConfig = projectRoot ? loadLspConfig(projectRoot) : {};
  const disabled = new Set(userConfig.disabled ?? []);

  // 从内置开始
  const servers: Record<string, LspServerDefinition> = { ...builtinServers };

  // 应用用户自定义设置到内置 Server
  if (userConfig.settings) {
    for (const [serverId, settings] of Object.entries(userConfig.settings)) {
      if (servers[serverId]) {
        servers[serverId] = {
          ...servers[serverId]!,
          settings: { ...servers[serverId]!.settings, ...settings },
        };
      }
    }
  }

  // 添加用户自定义 Server
  if (userConfig.servers) {
    for (const [id, userServer] of Object.entries(userConfig.servers)) {
      servers[id] = {
        args: userServer.args ?? [],
        command: userServer.command,
        id,
        initializationOptions: userServer.initializationOptions,
        label: id,
        languages: userServer.languages,
        settings: userServer.settings,
        transport: userServer.transport ?? "stdio",
      };
      log.debug(`注册自定义 LSP Server: ${id} (${userServer.command})`);
    }
  }

  log.info(`LSP 配置解析完成: ${Object.keys(servers).length} Server, ${disabled.size} 禁用`);
  return { disabled, servers };
}

/**
 * 获取指定语言的可用 LSP Server(考虑禁用列表)。
 */
export function getAvailableServerForLanguage(languageId: string, projectRoot?: string): LspServerDefinition | null {
  const { servers, disabled } = resolveLspConfig(projectRoot);

  for (const server of Object.values(servers)) {
    if (disabled.has(server.id)) {
      continue;
    }
    if (server.languages.includes(languageId)) {
      return server;
    }
  }

  return null;
}
