export { SSHClient, createSSHClient } from "./client";
export { SSHConnectionPool, sshConnectionPool, SSHConnectionError } from "./client/pool";
export { RemoteWorkspace, createRemoteWorkspace } from "./workspace";
export { WorkspaceManager, getWorkspaceManager } from "./workspace";
export { sanitizeSSHCommand, checkSSHDenylist, makeSSHCommandSafe, shellQuote } from "./safety";

export type {
  SSHConnectionConfig,
  SSHConnection,
  SSHConnectionPoolStats,
  SSHExecOptions,
  SSHExecResult,
  SSHExecContext,
} from "./types";

export type { RemoteWorkspaceConfig } from "./workspace";
