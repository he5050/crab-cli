/**
 * SSH 模块类型定义
 */

export interface SSHConnectionConfig {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  readyTimeout?: number;
  /**
   * 主机密钥验证回调。
   * 收到远程主机公钥时调用，返回 true 接受、false 拒绝。
   * 未提供时默认拒绝未知主机密钥（防止中间人攻击）。
   */
  hostVerifier?: (key: Buffer) => boolean;
  /**
   * 已知主机公钥指纹列表（SHA256）。
   * 如果设置，将自动生成 hostVerifier 进行校验。
   */
  knownHostKeys?: string[];
}

export interface SSHConnection {
  id: string;
  config: SSHConnectionConfig;
  client: any; // Ssh2 Client
  isConnected: boolean;
  lastUsed: Date;
  createdAt: Date;
}

export interface SSHConnectionPoolStats {
  total: number;
  active: number;
  idle: number;
}

export interface RemoteWorkspace {
  connectionId: string;
  remotePath: string;
  localMountPath?: string;
}

export interface SSHExecOptions {
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
  /**
   * 跳过 CWE-78 sanitize + denylist 检查。
   * ⚠️ 仅在调用方完全信任 command 来源时使用(如硬编码内部工具)。
   * 用户输入或 AI 输出绝对不能传 true。
   */
  dangerousAllow?: boolean;
}

export interface SSHExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SSHExecContext {
  workspaceId?: string;
  connection?: SSHConnectionConfig;
  cwd?: string;
}
