/**
 * Server 模块
 *
 * 职责:
 *   - 提供多种服务器运行模式
 *   - 支持无头模式、SSE 服务、ACP 协议
 *   - 后台任务管理
 *   - Shell 进程管理
 *
 * 模块功能:
 *   - HeadlessRunner: 无头模式运行器类
 *   - HeadlessOptions: 无头模式选项类型
 *   - startSseServer: 启动 SSE 服务器
 *   - SseServerOptions: SSE 服务器选项类型
 *   - startAcpServer: 启动 ACP 服务器
 *   - AcpServerOptions: ACP 服务器选项类型
 *   - listTasks: 列出任务
 *   - getTask: 获取任务
 *   - registerTask: 注册任务
 *   - setTaskPid: 设置任务 PID
 *   - completeTask: 完成任务
 *   - TaskRecord: 任务记录类型
 *   - ShellManager: Shell 管理器类
 *   - shellManager: 全局 Shell 管理器实例
 *   - ShellOptions: Shell 选项类型
 *   - SshOptions: SSH 选项类型
 *   - ShellResult: Shell 结果类型
 *
 * 使用场景:
 *   - 无头模式运行 Agent(无需 TUI)
 *   - 通过 SSE 提供实时流式响应
 *   - ACP 协议通信
 *   - 后台任务管理和监控
 *   - Shell 命令执行和管理
 *
 * 边界:
 *   1. 无头模式不支持交互式操作
 *   2. SSE 服务需要 HTTP 服务器支持
 *   3. ACP 协议需要客户端支持
 *   4. Shell 管理受系统权限限制
 *
 * 流程:
 *   1. 根据需求选择服务器模式
 *   2. 配置并启动对应的服务
 *   3. 处理客户端请求
 *   4. 管理后台任务生命周期
 *   5. 执行 Shell 命令并返回结果
 */

export { HeadlessRunner } from "./headless";
export type { HeadlessOptions } from "./headless";

export { startSseServer } from "./sseServer";
export type { SseServerOptions } from "./sseServer";

export { startAcpServer } from "./acpServer";
export type { AcpServerOptions } from "./acpServer";

export { listTasks, getTask, registerTask, setTaskPid, completeTask } from "./taskRunner";
export type { TaskRecord } from "./taskRunner";

export { ShellManager, shellManager } from "./shellManager";
export type { ShellOptions, SshOptions, ShellResult } from "./shellManager";
