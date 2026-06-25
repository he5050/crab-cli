/**
 * SSH URL 解析工具 — 纯函数，无外部依赖。
 *
 * 从 bash/sshUrl.ts 提取到 shared，供 codebaseSearch/aceRuntime/pathRemote 等模块复用，
 * 避免 codebaseSearch → bash 的跨子模块耦合。
 */

/** 解析后的 SSH URL 结构体 */
export interface ParsedSSHUrl {
  username: string;
  host: string;
  port: number;
  path: string;
}

/**
 * 解析 SSH URL，支持 `ssh://user@host[:port][/abs/path]`
 * @param url - SSH URL 字符串
 * @returns 解析结果，格式不合法时返回 null
 */
/** parseSSHUrl 的实现 */
export function parseSSHUrl(url: string): ParsedSSHUrl | null {
  const match = url.match(/^ssh:\/\/([^@]+)@([^:/]+)(?::(\d+))?(\/.*)?$/);
  if (!match) {
    return null;
  }

  return {
    host: match[2]!,
    path: match[4] ?? "",
    port: match[3] ? parseInt(match[3], 10) : 22,
    username: match[1]!,
  };
}
