/**
 * 应用命令主入口 — 聚合所有应用命令。
 *
 * 职责:
 *   - 聚合所有应用命令
 *   - 导出命令依赖类型
 *   - 提供命令创建工厂函数
 *   - 协调各分类命令的构建
 *
 * 模块功能:
 *   - createAppCommands: 创建所有应用命令
 *   - CommandDeps: 命令依赖类型
 *   - getAppConfig: 获取应用配置
 *
 * 使用场景:
 *   - TUI 应用初始化命令
 *   - 命令注册表注册
 *   - 应用启动时批量创建命令
 *
 * 边界:
 *   1. 仅聚合命令，不包含具体实现
 *   2. 命令实现在 appCommands/ 子目录
 *   3. 依赖注入模式，通过 CommandDeps 传递依赖
 *
 * 流程:
 *   1. 从各分类命令模块导入构建函数
 *   2. 接收 CommandDeps 依赖对象
 *   3. 调用各分类的构建函数生成命令
 *   4. 合并所有命令并返回
 */

import type { Command } from "@/commandPalette/types";
import { buildFrameworkNavigationCommands } from "./categories/operational/frameworkNavigation";
import { buildConfigModeCommands } from "./categories/config";
import { buildToolHookRoleSkillCommands } from "./categories/operational/toolHookRoleSkill";
import { buildSessionAgentCommands } from "./categories/session";
import { buildGitCodebaseIdeCommands } from "./categories/ide/gitCodebase";
import { buildTaskManageOtherCommands } from "./categories/task/manageOther";
import { buildPluginWorkspaceCommands } from "./categories/operational/pluginWorkspaceCommands";
import { buildBuddyCommands } from "./categories/buddy";
import { buildQuickCommands } from "./categories/operational/quickCommands";
import { buildDiagnosticCommands } from "./categories/operational/diagnosticCommands";
import { buildCustomCommands } from "./categories/custom/customCommands";
import { buildDynamicCustomCommands } from "./categories/custom/customCommands";
import { buildRoleCommands } from "./categories/role/roleCommands";
export { getAppConfig, type CommandDeps } from "./shared";

/**
 * 创建所有应用命令
 * @param deps - 命令依赖
 * @returns 命令数组
 */
export function createAppCommands(deps: import("./shared").CommandDeps): Command[] {
  return [
    ...buildFrameworkNavigationCommands(deps),
    ...buildConfigModeCommands(deps),
    ...buildToolHookRoleSkillCommands(deps),
    ...buildSessionAgentCommands(deps),
    ...buildGitCodebaseIdeCommands(deps),
    ...buildTaskManageOtherCommands(deps),
    ...buildPluginWorkspaceCommands(deps),
    ...buildBuddyCommands(deps),
    ...buildQuickCommands(deps),
    ...buildDiagnosticCommands(deps),
    ...buildCustomCommands(deps),
    ...buildDynamicCustomCommands(deps),
    ...buildRoleCommands(deps),
  ];
}
