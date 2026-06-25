/**
 * 连接管理模块。
 *
 * 职责:
 *   - 提供统一的连接管理功能（单例模式）
 *   - 支持本地、SSH、Docker、WSL 等多种连接类型
 *   - 管理连接生命周期
 *   - 提供连接上下文
 *
 * 模块功能:
 *   - ConnectionManager: 连接管理器类
 *   - connectionManager: 全局连接管理器实例
 *   - ConnectionType: 连接类型
 *   - ConnectionStatus: 连接状态
 *   - ConnectionConfig: 连接配置
 *   - Connection: 连接
 *   - ConnectionContext: 连接上下文
 *   - ConnectionEvent: 连接事件
 *   - ConnectionEventType: 连接事件类型
 *   - ConnectionFilter: 连接过滤器
 *   - ConnectionStats: 连接统计
 *   - addConnection: 添加连接
 *   - connect: 建立连接
 *   - disconnect: 断开连接
 *   - setActiveConnection: 设置活动连接
 *   - getActiveConnectionContext: 获取活动连接上下文
 *   - removeConnection: 移除连接
 *   - listConnections: 列出连接
 *
 * 使用场景:
 *   - 管理多个项目连接
 *   - 切换本地和远程开发环境
 *   - 支持 Docker 容器开发
 *   - WSL 环境开发
 *
 * 边界:
 *   1. 仅负责连接管理，不负责具体的连接协议实现
 *   2. 连接配置需要符合类型定义
 *   3. 同一时间只有一个活动连接
 *   4. 连接状态变更会触发事件
 *
 * 流程:
 *   1. 使用 addConnection 添加连接配置
 *   2. 调用 connect 建立连接
 *   3. 使用 setActiveConnection 切换活动连接
 *   4. 通过 getActiveConnectionContext 获取上下文
 *   5. 使用 disconnect 断开连接
 *   6. 使用 removeConnection 移除连接
 */

// 类型定义 + 辅助值
export type {
  ConnectionType,
  ConnectionStatus,
  ConnectionConfig,
  Connection,
  ConnectionContext,
  ConnectionEvent,
  ConnectionEventType,
  ConnectionFilter,
  ConnectionStats,
} from "./types";
export { CONNECTION_STUB_LABEL, isExperimentalConnectionType, getConnectionTypeLabel } from "./types";

// 连接管理器
export { ConnectionManager, connectionManager } from "./manager";
