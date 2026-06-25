/**
 * Bash 安全检查 — 供 bash 工具直接调用的安全函数。
 *
 * 职责:
 *   - 检测危险命令
 *   - 检测自毁命令
 *   - 截断输出
 *   - 提供安全检查函数
 *
 * 模块功能:
 *   - isDangerousCommand: 检测危险命令
 *   - isSelfDestructiveCommand: 检测自毁命令
 *   - truncateOutput: 截断输出
 *   - 从 @permission/sensitive-command 重新导出
 *
 * 使用场景:
 *   - bash 工具执行前安全检查
 *   - 防止执行危险命令
 *   - 防止自毁操作
 *   - 输出长度控制
 *
 * 边界:
 *   1. 封装 @permission/sensitive-command
 *   2. bash 工具只依赖此模块
 *   3. 不直接依赖敏感命令管理器
 *   4. 提供类型导出
 *
 * 流程:
 *   1. 接收命令
 *   2. 调用安全检查函数
 *   3. 返回检查结果
 */
export { isDangerousCommand, isSelfDestructiveCommand, truncateOutput } from "@/permission";

/** re-export */
export type { SelfDestructiveResult } from "@/permission";
