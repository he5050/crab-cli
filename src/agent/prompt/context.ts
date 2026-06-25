/**
 * 环境上下文注入 — 构建运行时环境信息段和指令文件加载。
 *
 * 职责:
 *   - 构建环境上下文信息(cwd、平台、日期、模型信息)
 *   - 查找并加载指令文件(AGENTS.md/CLAUDE.md 等)
 *   - 平台特定命令说明生成
 *
 * 模块功能:
 *   - buildEnvironmentContext(): 构建环境上下文字符串
 *   - getShellName(): 获取当前 Shell 名称
 *   - getPlatformCommandsSection(): 获取平台特定命令说明
 *   - loadInstructionFiles(): 异步加载指令文件(支持远程 URL 和向上查找)
 *   - loadInstructionFilesSync(): 同步加载指令文件
 *   - buildInstructionSection(): 构建指令文件注入文本
 *   - clearInstructionCache(): 清除指令文件缓存
 *
 * 使用场景:
 *   - 构建系统提示词时注入环境上下文
 *   - 加载项目级指令文件(AGENTS.md/CLAUDE.md)
 *   - 为不同平台生成适配的命令说明
 *
 * 边界:
 * 1. 指令文件查找优先级:AGENTS.md > CLAUDE.md > CONTEXT.md > .crab/instructions.md
 * 2. 向上查找范围:从 startDir 向上逐级查找到用户主目录
 * 3. 缓存机制:基于 mtime 缓存本地文件内容，减少重复 IO
 * 4. 远程 URL:支持通过 remoteUrls 参数加载远程指令文件，超时 5 秒
 *
 * 流程:
 * 1. buildEnvironmentContext():收集环境信息并格式化为 <env> 标签段
 * 2. getPlatformCommandsSection():根据平台类型生成对应的命令说明
 * 3. loadInstructionFiles():从当前目录向上查找指令文件，同时加载远程 URL
 * 4. buildInstructionSection():将加载的指令文件格式化为可注入文本
 */
import os from "os";
import path from "path";
import fs from "fs";

/** 环境上下文选项 */
export interface EnvironmentContextOptions {
  /** 工作目录(默认 process.cwd()) */
  cwd?: string;
  /** 项目根目录 */
  projectRoot?: string;
  /** 是否为 Git 仓库 */
  isGitRepo?: boolean;
  /** 平台覆盖(测试用) */
  platform?: string;
  /** 日期覆盖(测试用) */
  date?: string;
  /** 模型 ID(如 anthropic/claude-sonnet-4) */
  modelId?: string;
  /** Shell 覆盖(测试用) */
  shell?: string;
}

/** 构建环境上下文字符串 */
export function buildEnvironmentContext(options: EnvironmentContextOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const platform = options.platform ?? os.platform();
  const date = options.date ?? new Date().toISOString().split("T")[0];
  const isGit = options.isGitRepo ?? false;
  const shell = options.shell ?? getShellName();

  const lines: string[] = [`<env>`, `  Working directory: ${cwd}`];

  if (options.projectRoot) {
    lines.push(`  Project root: ${options.projectRoot}`);
  }

  lines.push(
    `  Is directory a git repo: ${isGit ? "yes" : "no"}`,
    `  Platform: ${getPlatformLabel(platform)}`,
    `  Shell: ${shell}`,
    `  Today's date: ${date}`,
  );

  if (options.modelId) {
    lines.push(`  Model: ${options.modelId}`);
  }

  lines.push(`</env>`);
  return lines.join("\n");
}

/** 获取平台显示名称 */
function getPlatformLabel(platform: string): string {
  switch (platform) {
    case "win32": {
      return "Windows";
    }
    case "darwin": {
      return "macOS";
    }
    case "linux": {
      return "Linux";
    }
    default: {
      return platform;
    }
  }
}

/** 获取 Shell 名称 */
export function getShellName(): string {
  const platform = os.platform();
  if (platform === "win32") {
    return detectWindowsPowerShell() ?? "cmd.exe";
  }
  const shell = process.env.SHELL ?? "";
  const base = path.basename(shell).toLowerCase();
  if (base.includes("zsh")) {
    return "zsh";
  }
  if (base.includes("bash")) {
    return "bash";
  }
  if (base.includes("fish")) {
    return "fish";
  }
  if (base.includes("pwsh")) {
    return "PowerShell";
  }
  if (base) {
    return base;
  }
  return "sh";
}

/** 检测 Windows PowerShell 版本 */
function detectWindowsPowerShell(): string | null {
  const psModulePath = process.env.PSModulePath ?? "";
  if (!psModulePath) {
    return null;
  }
  if (psModulePath.includes(String.raw`PowerShell\7`) || psModulePath.includes(String.raw`powershell\7`)) {
    return "PowerShell 7.x";
  }
  if (psModulePath.toLowerCase().includes("windowspowershell")) {
    return "PowerShell 5.x";
  }
  return "PowerShell";
}

/** 获取平台特定命令段*/
export function getPlatformCommandsSection(platform?: string): string {
  const p = platform ?? os.platform();
  if (p === "win32") {
    const psType = detectWindowsPowerShell();
    if (psType?.includes("7")) {
      return `## 平台命令说明

**环境: Windows + PowerShell 7.x+**
- 使用 PowerShell cmdlets(Remove-Item, Copy-Item, Select-String 等)
- 支持 &&, ||, -and, -or 操作符
- 复杂任务优先使用 Node.js 脚本`;
    }
    return `## 平台命令说明

**环境: Windows + ${psType ?? "cmd.exe"}**
- 使用 del, copy, move, findstr, type, dir, mkdir
- 复杂任务优先使用 Node.js 脚本`;
  }
  if (p === "darwin" || p === "linux") {
    return `## 平台命令说明

**环境: ${p === "darwin" ? "macOS" : "Linux"} + Unix Shell**
- 使用 rm, cp, mv, grep, cat, ls, mkdir, find, sed, awk
- 支持 &&, ||, 管道 |, 重定向 >, >>, <
- 复杂任务优先使用 Node.js 脚本`;
  }
  return `## 平台命令说明

**环境: ${p}**
- 优先使用跨平台的 Node.js 脚本`;
}

// ─── 指令文件系统 ─────────────────────────────────────────────

/** 指令文件信息 */
export interface InstructionFile {
  /** 文件来源路径或 URL */
  path: string;
  /** 文件内容 */
  content: string;
  /** 来源类型 */
  source: "local" | "remote";
}

/** 指令文件缓存 */
interface InstructionCache {
  /** 缓存键 → 内容 */
  content: string;
  /** 上次读取的 mtime(本地文件) */
  mtimeMs: number;
}

const instructionCache = new Map<string, InstructionCache>();

/** 指令文件查找名列表(优先级从高到低) */
const INSTRUCTION_FILENAMES = ["CRAB.md", "AGENTS.md", "CLAUDE.md", "CONTEXT.md", ".crab/instructions.md"];

/**
 * 查找并读取指令文件。
 *
 * 搜索策略:
 *   1. 从 startDir 开始，检查每个查找名
 *   2. 向上逐级查找到用户主目录
 *   3. 去重:同一文件名只取最高优先级的版本
 *   4. 支持 remoteUrls 远程指令 URL
 *
 * 使用 Bun.file 替代 require("fs")。
 */
export async function loadInstructionFiles(startDir?: string, remoteUrls?: string[]): Promise<InstructionFile[]> {
  const results: InstructionFile[] = [];
  const seen = new Set<string>(); // 去重:同一 basename 只取第一个

  // ── 本地文件向上查找 ──
  const dir = startDir ?? process.cwd();
  const home = os.homedir();
  let current = path.resolve(dir);
  const root = path.resolve(home);

  while (true) {
    for (const filename of INSTRUCTION_FILENAMES) {
      if (seen.has(filename)) {
        continue;
      }
      try {
        const filepath = path.resolve(current, filename);
        const file = Bun.file(filepath);
        const exists = await file.exists();
        if (!exists) {
          continue;
        }

        const stat = await file.stat();
        if (!stat) {
          continue;
        }

        // 检查缓存:mtime 未变则使用缓存
        const cached = instructionCache.get(filepath);
        if (cached && cached.mtimeMs === stat.mtimeMs) {
          seen.add(filename);
          results.push({ content: cached.content, path: filepath, source: "local" });
          continue;
        }

        const content = (await file.text()).trim();
        if (!content) {
          continue;
        }

        // 更新缓存
        instructionCache.set(filepath, { content, mtimeMs: stat.mtimeMs });
        seen.add(filename);
        results.push({ content, path: filepath, source: "local" });
      } catch {
        // 文件不存在或无法读取，跳过
      }
    }

    // 已到达用户主目录，停止向上查找
    if (path.resolve(current) === root) {
      break;
    }

    // 向上一级
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    } // 已到文件系统根
    current = parent;
  }

  // ── 远程 URL 加载 ──
  if (remoteUrls && remoteUrls.length > 0) {
    for (const url of remoteUrls) {
      try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!resp.ok) {
          continue;
        }
        const content = (await resp.text()).trim();
        if (content) {
          results.push({ content, path: url, source: "remote" });
        }
      } catch {
        // 远程加载失败，跳过
      }
    }
  }

  return results;
}

/**
 * 同步版指令文件加载(用于测试和简单场景)。
 * 仅搜索 startDir 本身，不向上查找。
 */
export function loadInstructionFilesSync(startDir?: string): InstructionFile[] {
  const targetDir = startDir ?? process.cwd();
  const results: InstructionFile[] = [];

  for (const filename of INSTRUCTION_FILENAMES) {
    try {
      const filepath = path.resolve(targetDir, filename);
      const file = Bun.file(filepath);
      // 同步路径:通过 fs 模块做 existsSync + readFileSync
      // 因为 Bun.file 的 exists() 是异步的
      if (!fs.existsSync(filepath)) {
        continue;
      }
      const content = fs.readFileSync(filepath, "utf8").trim();
      if (content) {
        results.push({ content, path: filepath, source: "local" });
      }
    } catch {
      // 跳过
    }
  }

  return results;
}

/** 构建指令文件注入文本 */
export function buildInstructionSection(instructions: InstructionFile[]): string {
  if (instructions.length === 0) {
    return "";
  }
  const parts = instructions.map((f) => {
    const tag = f.source === "remote" ? "Remote instructions" : "Instructions from";
    return `${tag}: ${f.path}\n${f.content}`;
  });
  return parts.join("\n\n");
}

/** 清除指令文件缓存(用于测试) */
export function clearInstructionCache(): void {
  instructionCache.clear();
}

// ─── 全局指令文件 ─────────────────────────────────────────────

/**
 * 同步加载全局指令文件(~/.crab/CRAB.md)。
 * 如果文件存在且内容非空，返回格式化的指令段；否则返回空字符串。
 */
export function loadGlobalInstructionSync(): string {
  try {
    const home = os.homedir();
    const globalPath = path.join(home, ".crab", "CRAB.md");
    if (!fs.existsSync(globalPath)) {
      return "";
    }
    const content = fs.readFileSync(globalPath, "utf8").trim();
    if (!content) {
      return "";
    }
    return `Global instructions: ${globalPath}\n${content}`;
  } catch {
    return "";
  }
}
