/**
 * 连接管理类型定义。
 *
 * 职责:定义连接配置、连接状态、连接上下文等核心类型。
 * 边界:包含类型定义与类型相关的辅助工具函数。
 */

/** 连接类型 */
export type ConnectionType = "local" | "ssh" | "docker" | "wsl";

export const CONNECTION_STUB_LABEL = "Experimental stub / preview";

/** 实验性连接类型的快速查找集合 */
const EXPERIMENTAL_SET = new Set<ConnectionType>(["docker", "wsl"]);

export function isExperimentalConnectionType(type: ConnectionType): boolean {
  return EXPERIMENTAL_SET.has(type);
}

export function getConnectionTypeLabel(type: ConnectionType): string {
  return isExperimentalConnectionType(type) ? `${type} (${CONNECTION_STUB_LABEL})` : type;
}

/** 连接状态 */
export type ConnectionStatus = "connected" | "disconnected" | "connecting" | "error";

/**
 * 连接配置
 *
 * 用于创建或更新连接的完整配置信息
 */
export interface ConnectionConfig {
  /** 连接唯一标识符 */
  id: string;
  /** 连接显示名称 */
  name: string;
  /** 连接类型 */
  type: ConnectionType;
  /** 主机地址(SSH/Docker 等远程连接需要) */
  host?: string;
  /** 端口号(SSH/Docker 等需要) */
  port?: number;
  /** 用户名(SSH 等需要) */
  username?: string;
  /** 工作目录 */
  workingDir: string;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 认证信息(可选，根据连接类型决定) */
  auth?: {
    /** 密码认证 */
    password?: string;
    /** 私钥认证 */
    privateKey?: string;
    /** 私钥密码 */
    passphrase?: string;
  };
}

/**
 * 连接实例
 *
 * 表示一个已创建的连接及其当前状态
 */
export interface Connection {
  /** 连接唯一标识符 */
  id: string;
  /** 连接配置 */
  config: ConnectionConfig;
  /** 连接状态 */
  status: ConnectionStatus;
  /** 最后使用时间 */
  lastUsed: Date;
  /** 错误信息(当 status 为 error 时) */
  error?: string;
  /** 连接建立时间 */
  connectedAt?: Date;
  /** 连接断开时间 */
  disconnectedAt?: Date;
}

/**
 * 连接上下文
 *
 * 用于在连接上执行操作时传递的上下文信息
 */
export interface ConnectionContext {
  /** 连接 ID */
  connectionId: string;
  /** 工作目录 */
  workingDir: string;
  /** 环境变量 */
  env: Record<string, string>;
  /** 连接类型 */
  type: ConnectionType;
  /** 主机信息(如果有) */
  host?: string;
}

/**
 * 连接事件类型
 */
export type ConnectionEventType =
  | "connection:created"
  | "connection:updated"
  | "connection:removed"
  | "connection:connecting"
  | "connection:connected"
  | "connection:disconnected"
  | "connection:error";

/**
 * 连接事件
 */
export interface ConnectionEvent {
  type: ConnectionEventType;
  connectionId: string;
  timestamp: Date;
  error?: string;
}

/**
 * 连接过滤器
 */
export interface ConnectionFilter {
  type?: ConnectionType;
  status?: ConnectionStatus;
  name?: string;
}

/**
 * 连接统计信息
 */
export interface ConnectionStats {
  total: number;
  connected: number;
  disconnected: number;
  connecting: number;
  error: number;
}
