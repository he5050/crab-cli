/**
 * Specialized Agent 注册表 — 统一注册入口，消除 5 处重复的 registerAgent 模式。
 *
 * 职责:
 *   - 提供统一的 Agent 注册辅助函数
 *   - 封装动态导入 + 错误处理 + 日志的重复逻辑
 *   - 集中管理 builtin agent 的注册入口
 *
 * 使用场景:
 *   - 各 specialized agent 模块初始化时调用 registerBuiltinAgent
 *   - 应用启动时通过 registerAllBuiltinAgents 批量注册
 *
 * 边界:
 *   - 仅封装注册样板，不改变 Agent 定义内容
 *   - 调用方仍负责构造完整的 AgentInfo 对象
 */
import { createLogger } from "@/core/logging/logger";
import type { AgentMode } from "@/agent/core/manager";

const log = createLogger("agent:specialized:registry");

/**
 * 统一注册一个 builtin Agent。
 *
 * 封装了动态导入 registerAgent + 成功/失败日志的重复模式。
 *
 * @param config - 完整的 AgentInfo 配置对象
 */
export function registerBuiltinAgent(config: {
  description: string;
  label: string;
  name: string;
  allowedTools?: string[];
  hidden?: boolean;
  mode?: AgentMode;
  native?: boolean;
  options?: Record<string, unknown>;
  prompt: string;
}): void {
  import("@/agent/core/manager")
    .then(({ registerAgent }) => {
      registerAgent({
        allowedTools: config.allowedTools ?? ["*"],
        description: config.description,
        hidden: config.hidden ?? false,
        label: config.label,
        mode: config.mode ?? "subagent",
        name: config.name,
        native: config.native ?? true,
        options: config.options ?? {},
        prompt: config.prompt,
      });
      log.info(`${config.label} Agent 已注册 (${config.name})`);
    })
    .catch((err) => log.error(`${config.label} Agent 注册失败`, err));
}
