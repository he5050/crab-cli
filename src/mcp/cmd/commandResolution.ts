/**
 * MCP STDIO 命令解析模块
 *
 * 职责:
 *   - 解析和验证 MCP STDIO 类型的命令配置
 *   - 执行环境变量插值(${VAR} 和 $VAR 语法)
 *   - 提供四层命令查找回退策略
 *   - 支持 npx 到 bunx 的自动回退
 *
 * 模块功能:
 *   - resolveStdioCommand:解析完整的 STDIO 命令配置
 *   - checkCommandExists:四层回退检查命令存在性
 *   - interpolateEnvVars:环境变量插值(支持 ${} 和 $ 语法)
 *   - buildEnv:构建增强的 PATH 环境变量
 *   - getShellCommand:获取可用的 shell 命令
 *
 * 使用场景:
 *   - MCP STDIO 服务器启动前解析命令
 *   - 处理用户自定义的命令路径
 *   - 环境变量动态替换
 *
 * 边界:
 *   1. 命令查找优先级:自定义路径 > 候选路径 > PATH 搜索 > Shell 兜底
 *   2. npx 默认回退到 bunx(除 @drawio/mcp 外)
 *   3. 自动添加用户目录下的常见 bin 目录到 PATH
 *   4. 支持 bash/zsh 作为 shell 兜底
 *
 * 流程:
 * 1. 接收 STDIO 命令配置(command/args/env/commandPath)
 * 2. 执行环境变量插值(interpolateEnvVars)
 * 3. npx 到 bunx 自动回退(除 drawio MCP 外)
 * 4. 四层回退查找命令(custom > candidate > path > shell)
 * 5. 返回解析后的命令配置
 */

import { createLogger } from "@/core/logging/logger";
const log = createLogger("mcp:cmd-resolve");

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ResolveStdioCommandInput {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** 用户自定义的命令绝对路径(可选) */
  commandPath?: string;
}

export interface ResolvedStdioCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
  /** 是否使用 shell 模式执行 */
  useShell?: boolean;
  /** 命令预检查结果(用于日志和错误提示) */
  checkResult?: CommandCheckResult;
}

export interface CommandCheckResult {
  found: boolean;
  command: string;
  method: "absolute" | "candidate" | "path" | "shell" | "custom" | "not_found";
  suggestion?: string;
}

/**
 * 安装建议映射 — 当命令未找到时给出友好的安装指引。
 */
const INSTALL_SUGGESTIONS: Record<string, { install: string; url?: string }> = {
  bunx: { install: "curl -fsSL https://bun.sh/install | bash", url: "https://bun.sh/docs/installation" },
  node: { install: "brew install node 或 nvm install --lts", url: "https://nodejs.org" },
  npx: { install: "npm install -g npm", url: "https://docs.npmjs.com/downloading-and-installing-node-js-and-npm" },
  pipx: { install: "pip install pipx", url: "https://pipx.pypa.io/stable/installation/" },
  python: { install: "brew install python", url: "https://www.python.org/downloads/" },
  python3: { install: "brew install python@3", url: "https://www.python.org/downloads/" },
  uv: { install: "curl -LsSf https://astral.sh/uv/install.sh | sh", url: "https://docs.astral.sh/uv/" },
  uvx: { install: "uv tool install <package>", url: "https://docs.astral.sh/uv/" },
};

/**
 * 环境变量插值 — 支持 ${VAR_NAME} 和 $VAR_NAME 语法。
 */
export function interpolateEnvVars(
  value: string,
  env: Record<string, string> = process.env as Record<string, string>,
): string {
  let result = value.replace(/\$\{([^}]+)\}/g, (match, varName) => {
    const trimmed = varName.trim();
    const replacement = env[trimmed];
    if (replacement === undefined) {
      log.warn(`环境变量未定义: ${trimmed}`);
      return match;
    }
    return replacement;
  });

  result = result.replace(/(?<!\$)\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, varName) => {
    const replacement = env[varName];
    if (replacement === undefined) {
      log.warn(`环境变量未定义: ${varName}`);
      return match;
    }
    return replacement;
  });

  return result;
}

/**
 * 对字符串数组进行环境变量插值。
 */
export function interpolateEnvVarsInArray(values: string[], env?: Record<string, string>): string[] {
  return values.map((v) => interpolateEnvVars(v, env));
}

/**
 * 对对象的所有字符串值进行环境变量插值。
 */
export function interpolateEnvVarsInRecord(
  record: Record<string, string>,
  env?: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    result[key] = interpolateEnvVars(value, env);
  }
  return result;
}

const USER_BIN_DIRS = [
  path.join(os.homedir(), ".bun", "bin"),
  path.join(os.homedir(), ".volta", "bin"),
  path.join(os.homedir(), ".local", "bin"),
  path.join(os.homedir(), ".cargo", "bin"),
  "/usr/local/bin",
  "/opt/homebrew/bin",
];

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of paths) {
    if (!entry) {
      continue;
    }
    if (seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    result.push(entry);
  }
  return result;
}

function buildEnv(env?: Record<string, string>): Record<string, string> {
  const merged = {
    ...process.env,
    ...env,
  } as Record<string, string>;

  const currentPath = merged.PATH ?? merged.Path ?? "";
  const parts = currentPath ? currentPath.split(path.delimiter) : [];
  const existingDirs = parts.filter(Boolean);
  const preferredDirs = USER_BIN_DIRS.filter((dir) => fs.existsSync(dir));

  const newPath = uniquePaths([...preferredDirs, ...existingDirs]).join(path.delimiter);

  log.debug(`构建环境变量 PATH:`, {
    newPath: newPath.slice(0, 200),
    originalPath: currentPath.slice(0, 200),
    preferredDirs,
  });

  merged.PATH = newPath;
  return merged;
}

/**
 * 获取可用的 shell 命令(按优先级排序)
 */
function getShellCommand(): string | null {
  const shellCandidates = ["bash", "zsh"];

  for (const shell of shellCandidates) {
    // 先在 PATH 中搜索
    const pathEntries = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
    for (const entry of pathEntries) {
      const candidate = path.join(entry, shell);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    // 再检查常见位置
    const commonPaths = ["/bin", "/usr/bin", "/usr/local/bin", "/opt/homebrew/bin"];
    for (const dir of commonPaths) {
      const candidate = path.join(dir, shell);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

/**
 * 命令存在性检查 — 四层回退策略
 *
 * 回退链:
 *   1. 自定义路径 (commandPath)
 *   2. 预定义候选路径表
 *   3. PATH 遍历搜索
 *   4. Shell 兜底
 */
export function checkCommandExists(
  command: string,
  env: Record<string, string>,
  customPath?: string,
): CommandCheckResult {
  // 第0层:自定义路径优先
  if (customPath && fs.existsSync(customPath)) {
    return {
      command: customPath,
      found: true,
      method: "custom",
    };
  }

  // 如果已经是绝对路径或包含路径分隔符，直接返回
  if (path.isAbsolute(command) || command.includes(path.sep) || command.includes("/")) {
    return {
      command,
      found: fs.existsSync(command),
      method: "absolute",
      suggestion: fs.existsSync(command) ? undefined : `文件不存在: ${command}`,
    };
  }

  const homeDir = os.homedir();
  const commandCandidates: Record<string, string[]> = {
    node: [
      path.join(homeDir, ".volta", "bin", "node"),
      path.join(homeDir, ".nvm", "versions", "node", process.version.slice(1), "bin", "node"),
      "/usr/local/bin/node",
      "/opt/homebrew/bin/node",
      "/usr/bin/node",
    ],
    npx: [path.join(homeDir, ".npm-global", "bin", "npx"), "/usr/local/bin/npx", "/opt/homebrew/bin/npx"],
    pipx: [path.join(homeDir, ".local", "bin", "pipx"), "/usr/local/bin/pipx", "/opt/homebrew/bin/pipx"],
    python: ["/opt/homebrew/bin/python", "/usr/local/bin/python", "/usr/bin/python"],
    python3: ["/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/usr/bin/python3"],
    uv: [
      path.join(homeDir, ".local", "bin", "uv"),
      path.join(homeDir, ".cargo", "bin", "uv"),
      "/usr/local/bin/uv",
      "/opt/homebrew/bin/uv",
    ],
    uvx: [
      path.join(homeDir, ".local", "bin", "uvx"),
      path.join(homeDir, ".cargo", "bin", "uvx"),
      "/usr/local/bin/uvx",
      "/opt/homebrew/bin/uvx",
    ],
  };

  // 第1层:查预定义候选路径
  const candidates = commandCandidates[command];
  if (candidates) {
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return { command: candidate, found: true, method: "candidate" };
      }
    }
  }

  // 第2层:在 PATH 中搜索
  const pathEntries = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const entry of pathEntries) {
    const candidate = path.join(entry, command);
    if (fs.existsSync(candidate)) {
      return { command: candidate, found: true, method: "path" };
    }
  }

  // 第3层:Shell 兜底 — shell 会加载 .zshrc/.bashrc，拥有完整环境
  const shellCmd = getShellCommand();
  if (shellCmd) {
    log.info(`命令 "${command}" 未在文件系统中找到，将使用 shell (${path.basename(shellCmd)}) 兜底执行`);
    return {
      command: shellCmd,
      found: true,
      method: "shell",
      suggestion: `命令 "${command}" 将通过 shell 执行。如果仍失败，请确认该命令已安装。`,
    };
  }

  // 全部失败:返回未找到
  const suggestion = INSTALL_SUGGESTIONS[command]
    ? `命令 "${command}" 未找到。安装方式: ${INSTALL_SUGGESTIONS[command].install}`
    : `命令 "${command}" 未找到，请确认已安装并添加到 PATH`;

  return {
    command,
    found: false,
    method: "not_found",
    suggestion,
  };
}

/**
 * 构建完整命令字符串(用于 shell 执行模式)
 */
function buildShellCommand(command: string, args: string[]): string {
  // 转义参数中的特殊字符
  const escapedArgs = args.map((arg) => {
    // 如果包含空格或特殊字符，用引号包裹
    if (/[\s'"$`\\]/.test(arg)) {
      return `'${arg.replace(/'/g, String.raw`'\''`)}'`;
    }
    return arg;
  });

  return `${command} ${escapedArgs.join(" ")}`;
}

function shouldPreserveNpx(args: string[]): boolean {
  const packageName = args.find((arg) => arg !== "-y" && arg !== "--yes");
  return packageName === "@drawio/mcp";
}

export function resolveStdioCommand(input: ResolveStdioCommandInput): ResolvedStdioCommand {
  log.debug(`解析 STDIO 命令: ${input.command} ${input.args?.join(" ") ?? ""}`);

  // 环境变量插值
  const interpolatedCommand = interpolateEnvVars(input.command);
  let interpolatedArgs = interpolateEnvVarsInArray(input.args ?? []);
  const interpolatedEnv = input.env ? interpolateEnvVarsInRecord(input.env) : undefined;

  // Npx → bunx 自动回退(项目约定使用 Bun 而非 Node.js)
  let finalCommand = interpolatedCommand;
  if (finalCommand === "npx") {
    if (shouldPreserveNpx(interpolatedArgs)) {
      log.info("检测到 drawio MCP，保留 npx 执行以避免 bunx 兼容性问题");
    } else {
      log.info("检测到 npx 命令，自动回退到 bunx(项目约定使用 Bun)");
      finalCommand = "bunx";
      // 移除 npx 的 -y/--yes 标志(bunx 不需要)
      const yesFlags = new Set(["-y", "--yes"]);
      interpolatedArgs = interpolatedArgs.filter((arg) => !yesFlags.has(arg));
    }
  }

  log.debug(`环境变量插值后: ${finalCommand} ${interpolatedArgs.join(" ")}`);

  const env = buildEnv(interpolatedEnv);

  // 所有命令统一走四层回退检查，不做任何转换
  const checkResult = checkCommandExists(finalCommand, env, input.commandPath);

  switch (checkResult.method) {
    case "absolute":
    case "custom":
    case "candidate":
    case "path": {
      log.info(`命令路径解析: ${finalCommand} → ${checkResult.command} [${checkResult.method}]`);
      return {
        args: interpolatedArgs,
        checkResult,
        command: checkResult.command,
        env,
      };
    }

    case "shell": {
      const fullCommand = buildShellCommand(finalCommand, interpolatedArgs);
      log.info(`Shell 扺底模式: ${fullCommand}`);
      return {
        args: ["-c", fullCommand],
        checkResult,
        command: checkResult.command,
        env,
        useShell: true,
      };
    }

    case "not_found": {
      log.warn(`MCP 命令未找到: ${checkResult.suggestion}`);
      return {
        args: interpolatedArgs,
        checkResult,
        command: finalCommand,
        env,
      };
    }

    default: {
      return {
        args: interpolatedArgs,
        checkResult,
        command: finalCommand,
        env,
      };
    }
  }
}
