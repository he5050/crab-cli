/**
 * 系统提示词构建器 — 根据模式和上下文组装完整的系统提示词。
 *
 * 职责:
 *   - 选择适合不同模型的基础提示词(Claude/GPT/Gemini)
 *   - 根据对话模式注入相应的指令(chat/plan/team/yolo/simple/security)
 *   - 组装环境上下文、平台命令、工具说明等模块
 *   - 管理 YOLO 模式叠加和动态 reminder
 *
 * 模块功能:
 *   - selectBasePromptByModel(): 根据模型 ID 选择基础提示词模板
 *   - buildSystemPrompt(): 同步构建完整的系统提示词
 *   - buildSystemPromptAsync(): 异步构建系统提示词(支持远程指令)
 *   - buildDynamicReminder(): 构建动态 system-reminder 文本
 *   - getModeInstruction(): 获取纯模式指令文本
 *   - previewSystemPrompt(): 预览构建后的提示词
 *   - isReadOnlyMode(): 判断是否为只读模式
 *   - isAutoApproveMode(): 判断是否自动批准工具调用
 *
 * 使用场景:
 *   - 启动新对话时构建系统提示词
 *   - 模式切换时重新组装提示词
 *   - 预览提示词内容用于调试
 *
 * 边界:
 * 1. 组装顺序:基础提示词 → 模式指令 → YOLO叠加 → 平台命令 → 工具说明 → 环境上下文 → Token预算 → 指令文件 → 动态reminder → 自定义追加
 * 2. YOLO 叠加:在 chat/plan/team 基础模式上追加 YOLO 标识
 * 3. 指令文件:默认从环境 cwd 向上查找 AGENTS.md/CLAUDE.md
 * 4. Token 预算:可选约束最大输出和上下文 Token 数
 *
 * 流程:
 * 1. 选择基础提示词(基于模型类型)
 * 2. 注入模式指令(基于当前模式)
 * 3. 叠加 YOLO 标识(如果启用)
 * 4. 依次添加平台命令、工具说明、环境上下文
 * 5. 注入指令文件内容(可选)
 * 6. 添加动态 reminder 和自定义内容
 * 7. 返回组装完成的系统提示词
 */
import type { ChatMode } from "./types";
import {
  type EnvironmentContextOptions,
  buildEnvironmentContext,
  buildInstructionSection,
  getPlatformCommandsSection,
  loadGlobalInstructionSync,
  loadInstructionFilesSync,
} from "./context";
import { TOOL_USAGE_SECTION } from "./toolUsageSection";
import { MODE_INSTRUCTIONS, getModeInstruction, YOLO_MODE_INSTRUCTION } from "./modes/index";
import { buildMemoryPrompt } from "@/session/memory";
import { getCompanionSystemPromptAddon } from "@/buddy/prompt";

// ─── 模型感知基础提示词(C3) ──────────────────────────────────

/**
 * 根据模型 ID 选择基础提示词模板。
 */
export function selectBasePromptByModel(modelId: string, fallback: string): string {
  const lower = modelId.toLowerCase();
  if (lower.includes("claude") || lower.includes("anthropic")) {
    return CLAUDE_BASE_PROMPT;
  }
  if (lower.includes("gpt") || lower.includes("o1") || lower.includes("o3") || lower.includes("o4")) {
    return GPT_BASE_PROMPT;
  }
  if (lower.includes("gemini")) {
    return GEMINI_BASE_PROMPT;
  }
  return fallback;
}

const CLAUDE_BASE_PROMPT = `你是一个专业的编程助手，基于 Anthropic Claude 模型。

## 模型特性
- 擅长代码生成、分析、重构
- 支持长上下文理解
- 思维链推理能力强

## 工作原则
- 用中文回复，回答简洁明了
- 在修改代码之前先阅读和理解现有代码
- 遵循项目现有的代码风格和约定
- 修改代码后运行测试验证正确性
- 遇到不确定的地方主动询问用户`;

const GPT_BASE_PROMPT = `你是一个专业的编程助手，基于 OpenAI GPT 模型。

## 模型特性
- 擅长自然语言理解和代码生成
- 支持结构化输出
- 工具调用能力强

## 工作原则
- 用中文回复，回答简洁明了
- 在修改代码之前先阅读和理解现有代码
- 遵循项目现有的代码风格和约定
- 修改代码后运行测试验证正确性
- 遇到不确定的地方主动询问用户`;

const GEMINI_BASE_PROMPT = `你是一个专业的编程助手，基于 Google Gemini 模型。

## 模型特性
- 多模态理解能力强
- 长上下文窗口
- 代码分析和生成能力优秀

## 工作原则
- 用中文回复，回答简洁明了
- 在修改代码之前先阅读和理解现有代码
- 遵循项目现有的代码风格和约定
- 修改代码后运行测试验证正确性
- 遇到不确定的地方主动询问用户`;

// ─── 动态 system-reminder(C2) ───────────────────────────────

/** 动态 reminder 选项 */
export interface DynamicReminderOptions {
  /** 已发现但尚未读取完整正文的 skills 列表 */
  discoveredSkills?: string[];
  /** 已由用户显式指定或 info/execute 激活的 skills 列表 */
  activeSkills?: string[];
  /** 已读取完整正文或执行生成 prompt 的 skills 列表 */
  loadedSkills?: string[];
  /** 当前会话已启用的外部/MCP 工具 */
  externalTools?: string[];
  /** 文件变化数量 */
  fileChanges?: number;
  /** 当前对话轮次 */
  turnNumber?: number;
  /** 附加动态信息 */
  extra?: string;
}

/**
 * 构建动态 system-reminder 文本。
 * 返回空字符串如果没有任何动态信息。
 */
export function buildDynamicReminder(opts: DynamicReminderOptions): string {
  const parts: string[] = [];
  if (opts.discoveredSkills && opts.discoveredSkills.length > 0) {
    parts.push(`已发现的 Skills: ${opts.discoveredSkills.join(", ")}`);
  }
  if (opts.activeSkills && opts.activeSkills.length > 0) {
    parts.push(`已激活的 Skills: ${opts.activeSkills.join(", ")}`);
  }
  if (opts.loadedSkills && opts.loadedSkills.length > 0) {
    parts.push(`已加载的 Skills: ${opts.loadedSkills.join(", ")}`);
  }
  if (opts.externalTools && opts.externalTools.length > 0) {
    parts.push(`当前会话已启用的外部工具: ${opts.externalTools.join(", ")}`);
  }
  if (opts.fileChanges !== undefined && opts.fileChanges > 0) {
    parts.push(`本次会话已修改 ${opts.fileChanges} 个文件`);
  }
  if (opts.turnNumber !== undefined && opts.turnNumber > 0) {
    parts.push(`当前对话轮次: ${opts.turnNumber}`);
  }
  if (opts.extra) {
    parts.push(opts.extra);
  }
  if (parts.length === 0) {
    return "";
  }
  return `<system-reminder>\n${parts.join("\n")}\n</system-reminder>`;
}

// ─── 提示词构建器 ─────────────────────────────────────────────

/** 提示词构建选项 */
export interface PromptBuilderOptions {
  /** 基础提示词(来自 Agent 定义) */
  basePrompt: string;
  /** 当前对话模式 */
  mode: ChatMode;
  /** 环境上下文选项 */
  environment?: EnvironmentContextOptions;
  /** 是否包含工具使用说明 */
  includeToolUsage?: boolean;
  /** 是否包含平台命令段 */
  includePlatformCommands?: boolean;
  /** 是否注入指令文件(AGENTS.md/CLAUDE.md) */
  includeInstructions?: boolean;
  /** 指令文件搜索根目录 */
  instructionRoot?: string;
  /** 自定义追加内容(用户自定义指令) */
  customAppend?: string;
  /** 是否为 YOLO 模式(在基础模式之上叠加) */
  yoloOverlay?: boolean;
  /** Token 预算(I5) */
  maxTokens?: number;
  /** 最大上下文 Token 数(I5) */
  maxContextTokens?: number;
  /** 动态 reminder 选项(C2) */
  dynamicReminder?: DynamicReminderOptions;
}

/**
 * 构建完整的系统提示词(同步版本)。
 *
 * 组装顺序:
 *   1. 基础提示词(Agent 定义)
 *   2. 模式指令(mode overlay)
 *   2.5 YOLO 叠加
 *   3. 平台命令段
 *   4. 工具使用说明 + schema
 *   5. 环境上下文
 *   5.5 Token 预算约束
 *   6. 指令文件(AGENTS.md/CLAUDE.md)
 *   7. 动态 system-reminder
 *   8. 自定义追加
 */
export function buildSystemPrompt(options: PromptBuilderOptions): string {
  const {
    basePrompt,
    mode,
    environment,
    includeToolUsage = true,
    includePlatformCommands = true,
    includeInstructions = true,
    instructionRoot,
    customAppend,
    yoloOverlay = false,
    maxTokens,
    maxContextTokens,
    dynamicReminder,
  } = options;

  const sections: string[] = [];

  // 1. 基础提示词
  if (basePrompt) {
    sections.push(basePrompt);
  }

  // 2. 模式指令
  const modeInstruction = MODE_INSTRUCTIONS[mode];
  if (modeInstruction) {
    sections.push(modeInstruction);
  }

  // 2.5 YOLO 叠加(在 chat/plan/team 基础模式之上追加 YOLO 标识)
  if (yoloOverlay && mode !== "yolo") {
    sections.push(YOLO_MODE_INSTRUCTION);
  }

  // 3. 平台命令段
  if (includePlatformCommands && environment) {
    sections.push(getPlatformCommandsSection(environment.platform));
  }

  // 4. 工具使用说明
  if (includeToolUsage) {
    sections.push(TOOL_USAGE_SECTION);
  }

  // 5. 环境上下文
  if (environment) {
    sections.push(buildEnvironmentContext(environment));
  }

  // 5.5 Token 预算约束(I5)
  if (maxTokens || maxContextTokens) {
    const budgetLines: string[] = ["## Token 预算"];
    if (maxTokens) {
      budgetLines.push(`- 最大输出 Token: ${maxTokens}`);
    }
    if (maxContextTokens) {
      budgetLines.push(`- 最大上下文 Token: ${maxContextTokens}`);
    }
    budgetLines.push("- 请控制回复长度，避免超出预算");
    sections.push(budgetLines.join("\n"));
  }

  // 6. 指令文件(AGENTS.md/CLAUDE.md/CRAB.md)— 使用同步版本
  if (includeInstructions) {
    const instructions = loadInstructionFilesSync(instructionRoot ?? environment?.cwd);
    const instructionText = buildInstructionSection(instructions);
    if (instructionText) {
      sections.push(instructionText);
    }

    // 6.5 全局指令文件(~/.crab/CRAB.md)
    const globalInstruction = loadGlobalInstructionSync();
    if (globalInstruction) {
      sections.push(globalInstruction);
    }

    // 6.6 跨会话记忆注入
    try {
      const memoryPrompt = buildMemoryPrompt();
      if (memoryPrompt) {
        sections.push(memoryPrompt);
      }
    } catch {
      // 记忆模块加载失败不阻断提示词构建
    }
  }

  // 6.7 宠物伴侣系统提示词
  const companionAddon = getCompanionSystemPromptAddon();
  if (companionAddon) {
    sections.push(companionAddon);
  }

  // 7. 动态 system-reminder(C2)
  if (dynamicReminder) {
    const reminder = buildDynamicReminder(dynamicReminder);
    if (reminder) {
      sections.push(reminder);
    }
  }

  // 8. 自定义追加
  if (customAppend) {
    sections.push(customAppend);
  }

  return sections.join("\n\n");
}

/**
 * 异步版提示词构建(支持远程 URL 指令和向上查找)。
 */
export async function buildSystemPromptAsync(
  options: PromptBuilderOptions & { remoteInstructionUrls?: string[] },
): Promise<string> {
  const {
    basePrompt,
    mode,
    environment,
    includeToolUsage = true,
    includePlatformCommands = true,
    includeInstructions = true,
    instructionRoot,
    customAppend,
    yoloOverlay = false,
    maxTokens,
    maxContextTokens,
    dynamicReminder,
    remoteInstructionUrls,
  } = options;

  const sections: string[] = [];

  if (basePrompt) {
    sections.push(basePrompt);
  }

  const modeInstruction = MODE_INSTRUCTIONS[mode];
  if (modeInstruction) {
    sections.push(modeInstruction);
  }

  if (yoloOverlay && mode !== "yolo") {
    sections.push(YOLO_MODE_INSTRUCTION);
  }

  if (includePlatformCommands && environment) {
    sections.push(getPlatformCommandsSection(environment.platform));
  }

  if (includeToolUsage) {
    sections.push(TOOL_USAGE_SECTION);
  }

  if (environment) {
    sections.push(buildEnvironmentContext(environment));
  }

  if (maxTokens || maxContextTokens) {
    const budgetLines: string[] = ["## Token 预算"];
    if (maxTokens) {
      budgetLines.push(`- 最大输出 Token: ${maxTokens}`);
    }
    if (maxContextTokens) {
      budgetLines.push(`- 最大上下文 Token: ${maxContextTokens}`);
    }
    budgetLines.push("- 请控制回复长度，避免超出预算");
    sections.push(budgetLines.join("\n"));
  }

  if (includeInstructions) {
    const { loadInstructionFiles } = await import("./context");
    const instructions = await loadInstructionFiles(instructionRoot ?? environment?.cwd, remoteInstructionUrls);
    const instructionText = buildInstructionSection(instructions);
    if (instructionText) {
      sections.push(instructionText);
    }
  }

  if (dynamicReminder) {
    const reminder = buildDynamicReminder(dynamicReminder);
    if (reminder) {
      sections.push(reminder);
    }
  }

  if (customAppend) {
    sections.push(customAppend);
  }

  return sections.join("\n\n");
}

/**
 * 获取完整的构建后提示词预览(用于 /prompt 命令)。
 */
export function previewSystemPrompt(options: PromptBuilderOptions): string {
  return buildSystemPrompt(options);
}

/**
 * 判断指定模式是否为只读模式。
 * Plan 模式下只能使用只读工具，不能修改文件。
 */
export function isReadOnlyMode(mode: ChatMode): boolean {
  return mode === "plan" || mode === "security";
}

/**
 * 判断指定模式是否自动批准工具调用。
 * YOLO 模式下跳过所有权限确认。
 */
export function isAutoApproveMode(mode: ChatMode, yoloOverlay?: boolean): boolean {
  return mode === "yolo" || yoloOverlay === true;
}

// Re-export for convenience
export { getModeInstruction };
