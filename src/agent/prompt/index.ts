/**
 * Prompt 模块入口 — 系统提示词构建 + 模式管理。
 *
 * 职责:
 *   - 根据对话模式构建系统提示词
 *   - 管理当前活跃模式
 *   - 注入运行时环境上下文
 *   - 加载指令文件(AGENTS.md/CLAUDE.md)
 *   - 模型感知基础提示词选择
 *   - 动态 system-reminder 注入
 *
 * 模块功能:
 *   - buildSystemPrompt: 构建系统提示词
 *   - buildSystemPromptAsync: 异步构建系统提示词
 *   - previewSystemPrompt: 预览系统提示词
 *   - getModeInstruction: 获取模式指令
 *   - selectBasePromptByModel: 根据模型选择基础提示词
 *   - buildDynamicReminder: 构建动态提醒
 *   - buildEnvironmentContext: 构建环境上下文
 *   - loadInstructionFiles: 加载指令文件
 *   - ChatMode: 对话模式类型
 *   - ModeMeta: 模式元数据类型
 *   - MODE_META: 模式元数据常量
 *   - isReadOnlyMode: 判断是否只读模式
 *   - isAutoApproveMode: 判断是否自动批准模式
 *
 * 使用场景:
 *   - Agent 初始化时构建系统提示词
 *   - 切换对话模式时更新提示词
 *   - 加载项目特定的指令文件
 *   - 根据模型特性调整提示词
 *
 * 边界:
 *   1. 不涉及 TUI 渲染
 *   2. 不涉及 LLM 调用
 *   3. 仅构建提示词文本，不执行逻辑
 *   4. 指令文件向上查找直至项目根目录
 *
 * 流程:
 *   1. 确定当前对话模式
 *   2. 选择基础提示词(根据模型)
 *   3. 加载指令文件(AGENTS.md/CLAUDE.md)
 *   4. 构建环境上下文
 *   5. 注入动态提醒
 *   6. 组合成最终系统提示词
 */

// ─── 类型导出 ────────────────────────────────────────────────

export {
  // 模式类型
  type ChatMode,
  type ModeMeta,
  MODE_META,
  getModeMeta,
  listModes,
  isReadOnlyMode as isModeReadOnly,
  isAutoApproveMode as isModeAutoApprove,
} from "./types";

// ─── 模式指令 ────────────────────────────────────────────────

export {
  getModeInstruction,
  CHAT_MODE_INSTRUCTION,
  PLAN_MODE_INSTRUCTION,
  TEAM_MODE_INSTRUCTION,
  YOLO_MODE_INSTRUCTION,
  SIMPLE_MODE_INSTRUCTION,
  SECURITY_MODE_INSTRUCTION,
} from "./modes/index";

// ─── 提示词构建 ──────────────────────────────────────────────

export {
  buildSystemPrompt,
  buildSystemPromptAsync,
  previewSystemPrompt,
  isReadOnlyMode,
  isAutoApproveMode,
  selectBasePromptByModel,
  buildDynamicReminder,
  type PromptBuilderOptions,
  type DynamicReminderOptions,
} from "./builder";

// ─── Registry ────────────────────────────────────────────────

export {
  buildPromptFromRegistry,
  listPromptSectionNames,
  type PromptRegistryOptions,
  type AgentPromptContract,
} from "./registry";

// ─── 环境上下文 ──────────────────────────────────────────────

export {
  buildEnvironmentContext,
  getShellName,
  getPlatformCommandsSection,
  loadInstructionFiles,
  loadInstructionFilesSync,
  buildInstructionSection,
  clearInstructionCache,
  type EnvironmentContextOptions,
  type InstructionFile,
} from "./context";

// ─── Sections ────────────────────────────────────────────────

export {
  buildBaseBehaviorSection,
  buildToolPolicySection,
  buildOutputStyleSection,
  buildAgentContractSection,
} from "./sections";

// ─── 运行时覆盖项 ────────────────────────────────────────

export { buildChatRuntimeOverrides } from "./runtimeOverrides";
