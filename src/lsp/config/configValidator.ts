/**
 * [LSP 配置验证模块]
 *
 * 职责:
 *   - 验证 LSP 配置结构
 *   - 验证命令路径有效性
 *   - 验证语言支持
 *   - 验证参数有效性
 *
 * 模块功能:
 *   - validateLspConfig: 验证完整 LSP 配置
 *   - validateServerConfig: 验证单个 Server 配置
 *   - ValidationResult: 验证结果接口
 *   - 验证规则和错误消息
 *
 * 使用场景:
 *   - 配置加载后自动验证
 *   - 用户修改配置前验证
 *   - 配置热更新时验证
 *   - 提供友好的错误提示
 *
 * 边界:
 *   1. 验证不抛出异常，返回错误列表
 *   2. 区分错误和警告级别
 *   3. 支持部分验证(仅验证特定字段)
 *   4. 不检查命令是否实际可执行(仅检查格式)
 *
 * 流程:
 *   1. 接收配置对象
 *   2. 检查必需字段存在性
 *   3. 验证字段类型和格式
 *   4. 检查值的有效性
 *   5. 收集所有错误和警告
 *   6. 返回验证结果
 */
import { builtinServers } from "../registry/serverRegistry";
import type { LspConfig, UserLspServerConfig } from "./lspConfig";

/** 验证结果 */
export interface ValidationResult {
  /** 是否通过验证 */
  valid: boolean;
  /** 错误和警告列表 */
  errors: {
    /** 错误路径(JSON Path 格式) */
    path: string;
    /** 错误消息 */
    message: string;
    /** 严重程度 */
    severity: "error" | "warning";
  }[];
}

/** 验证选项 */
export interface ValidationOptions {
  /** 是否严格模式(默认 true) */
  strict?: boolean;
  /** 是否检查命令存在性(默认 false) */
  checkCommandExists?: boolean;
  /** 允许的 LSP Server ID */
  allowedServerIds?: Set<string>;
}

/**
 * 验证完整的 LSP 配置
 */
export function validateLspConfig(config: LspConfig, options?: ValidationOptions): ValidationResult {
  const errors: ValidationResult["errors"] = [];
  const opts = {
    allowedServerIds: new Set(Object.keys(builtinServers)),
    checkCommandExists: false,
    strict: true,
    ...options,
  };

  // 验证根节点类型
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    return {
      errors: [
        {
          message: "配置必须是对象",
          path: "$",
          severity: "error",
        },
      ],
      valid: false,
    };
  }

  // 验证 servers 字段
  if (config.servers) {
    if (typeof config.servers !== "object" || Array.isArray(config.servers)) {
      errors.push({
        message: "servers 必须是对象",
        path: "$.servers",
        severity: "error",
      });
    } else {
      // 验证每个 Server 配置
      for (const [serverId, serverConfig] of Object.entries(config.servers)) {
        const serverErrors = validateServerConfig(serverId, serverConfig, opts);
        errors.push(...serverErrors.errors);
      }
    }
  }

  // 验证 disabled 字段
  if (config.disabled !== undefined) {
    if (!Array.isArray(config.disabled)) {
      errors.push({
        message: "disabled 必须是数组",
        path: "$.disabled",
        severity: "error",
      });
    } else {
      // 检查 disabled 中的 Server ID 是否有效
      for (const serverId of config.disabled) {
        if (typeof serverId !== "string") {
          errors.push({
            message: `disabled 中的 Server ID 必须是字符串，收到: ${typeof serverId}`,
            path: "$.disabled",
            severity: "error",
          });
          continue;
        }

        if (!opts.allowedServerIds.has(serverId) && opts.strict) {
          errors.push({
            message: `未知的 Server ID: ${serverId}`,
            path: `$.disabled["${serverId}"]`,
            severity: "warning",
          });
        }
      }
    }
  }

  // 验证 settings 字段
  if (config.settings !== undefined) {
    if (typeof config.settings !== "object" || Array.isArray(config.settings)) {
      errors.push({
        message: "settings 必须是对象",
        path: "$.settings",
        severity: "error",
      });
    }
  }

  // 验证额外的未知字段(严格模式)
  if (opts.strict) {
    const knownFields = new Set(["servers", "disabled", "settings"]);
    for (const field of Object.keys(config)) {
      if (!knownFields.has(field)) {
        errors.push({
          message: `未知的配置字段: ${field}`,
          path: `$.${field}`,
          severity: "warning",
        });
      }
    }
  }

  return {
    errors,
    valid: errors.filter((e) => e.severity === "error").length === 0,
  };
}

/**
 * 验证单个 Server 配置
 */
export function validateServerConfig(
  serverId: string,
  config: UserLspServerConfig,
  options?: ValidationOptions,
): ValidationResult {
  const errors: ValidationResult["errors"] = [];
  const opts = { ...options };

  // 验证必需字段
  if (!config.command || typeof config.command !== "string") {
    errors.push({
      message: "command 是必需的字符串字段",
      path: `$.servers["${serverId}"].command`,
      severity: "error",
    });
  }

  // 验证 args 字段
  if (config.args !== undefined) {
    if (!Array.isArray(config.args)) {
      errors.push({
        message: "args 必须是数组",
        path: `$.servers["${serverId}"].args`,
        severity: "error",
      });
    } else {
      // 检查每个参数类型
      for (let i = 0; i < config.args.length; i++) {
        if (typeof config.args[i] !== "string") {
          errors.push({
            message: `args[${i}] 必须是字符串`,
            path: `$.servers["${serverId}"].args[${i}]`,
            severity: "error",
          });
        }
      }
    }
  }

  // 验证 languages 字段
  if (!config.languages) {
    errors.push({
      message: "languages 是必需的数组字段",
      path: `$.servers["${serverId}"].languages`,
      severity: "error",
    });
  } else if (!Array.isArray(config.languages)) {
    errors.push({
      message: "languages 必须是数组",
      path: `$.servers["${serverId}"].languages`,
      severity: "error",
    });
  } else if (config.languages.length === 0) {
    errors.push({
      message: "languages 不能为空数组",
      path: `$.servers["${serverId}"].languages`,
      severity: "error",
    });
  } else {
    // 验证每个语言 ID
    const validLanguages = new Set([
      "c",
      "cpp",
      "csharp",
      "dart",
      "elixir",
      "erlang",
      "go",
      "haskell",
      "html",
      "java",
      "javascript",
      "javascriptreact",
      "json",
      "julia",
      "kotlin",
      "less",
      "lua",
      "markdown",
      "matlab",
      "ocaml",
      "perl",
      "php",
      "python",
      "r",
      "ruby",
      "rust",
      "scala",
      "scss",
      "sql",
      "swift",
      "typescript",
      "typescriptreact",
      "xml",
      "yaml",
      "zig",
    ]);

    for (let i = 0; i < config.languages.length; i++) {
      const lang = config.languages[i];
      if (typeof lang !== "string") {
        errors.push({
          message: `languages[${i}] 必须是字符串`,
          path: `$.servers["${serverId}"].languages[${i}]`,
          severity: "error",
        });
      } else if (!validLanguages.has(lang)) {
        errors.push({
          message: `未知的语言 ID: ${lang}`,
          path: `$.servers["${serverId}"].languages[${i}]`,
          severity: "warning",
        });
      }
    }
  }

  // 验证 transport 字段
  if (config.transport !== undefined) {
    if (!["stdio", "socket"].includes(config.transport)) {
      errors.push({
        message: `transport 必须是 "stdio" 或 "socket"`,
        path: `$.servers["${serverId}"].transport`,
        severity: "error",
      });
    }
  }

  // 验证 initializationOptions 字段
  if (config.initializationOptions !== undefined) {
    if (typeof config.initializationOptions !== "object" || Array.isArray(config.initializationOptions)) {
      errors.push({
        message: "initializationOptions 必须是对象",
        path: `$.servers["${serverId}"].initializationOptions`,
        severity: "error",
      });
    }
  }

  // 验证 settings 字段
  if (config.settings !== undefined) {
    if (typeof config.settings !== "object" || Array.isArray(config.settings)) {
      errors.push({
        message: "settings 必须是对象",
        path: `$.servers["${serverId}"].settings`,
        severity: "error",
      });
    }
  }

  // 可选:检查命令是否存在
  if (opts.checkCommandExists && config.command) {
    const commandExists = checkCommandExists(config.command);
    if (!commandExists) {
      errors.push({
        message: `命令不存在或无法执行: ${config.command}`,
        path: `$.servers["${serverId}"].command`,
        severity: "warning",
      });
    }
  }

  return {
    errors,
    valid: errors.filter((e) => e.severity === "error").length === 0,
  };
}

/**
 * 检查命令是否在 PATH 中。
 * P2-2: 检查命令名是否为非空字符串；不检查文件系统存在性（保持同步，
 * 真实存在性检测由 serverRegistry.isServerInstalled 在运行时完成）。
 */
function checkCommandExists(command: string): boolean {
  if (!command || command.trim().length === 0) {
    return false;
  }
  // 包含路径分隔符的视为可能的绝对路径，放行
  if (command.includes("/") || command.includes("\\")) {
    return true;
  }
  return command.length > 0;
}
