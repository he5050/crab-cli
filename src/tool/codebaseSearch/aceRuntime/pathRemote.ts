/**
 * SSH 远程路径工具 — 处理 ssh:// URL 的路径操作
 *
 * 职责:
 *   - 解析 ssh:// URL 并提取各组成部分
 *   - 提供 POSIX 路径拼接和转换
 *   - 处理远程路径的解析和相对路径计算
 *
 * 模块功能:
 *   - isSSHPath: 检查路径是否是 SSH URL
 *   - splitSshUrl: 解析 ssh://user@host:port/abs/path URL
 *   - posixJoin: POSIX 路径拼接(折叠多个斜杠)
 *   - toSshUrl: 将远程绝对路径转换为 ssh:// URL
 *   - resolveRemotePath: 将相对路径解析为远程绝对路径
 *   - relativeRemotePath: 计算从 root 到 target 的相对 POSIX 路径
 *   - SshUrlParts: SSH URL 拆分结果接口定义
 *
 * 使用场景:
 *   - SSH 远程代码搜索的路径处理
 *   - 远程文件路径和本地路径的转换
 *   - SSH URL 的构建和解析
 *
 * 边界:
 * 1. Node.js 的 path.resolve/path.relative/path.join 会破坏 ssh:// URL(将协议视为路径段并折叠双斜杠)
 * 2. 需要使用专用的路径处理函数
 * 3. SSH URL 格式:ssh://user@host:port/abs/path
 * 4. 所有远程路径使用 POSIX 格式(正斜杠)
 *
 * 流程:
 * 1. 检测路径是否为 SSH URL
 * 2. 解析 SSH URL 提取协议、用户、主机、端口、根路径
 * 3. 使用 POSIX 路径操作代替 Node.js 原生 path 模块
 * 4. 在 URL 和绝对路径之间进行转换
 */

import { parseSSHUrl } from "@/tool/shared/sshUrl";

/**
 * 检查路径是否是 SSH URL。
 */
/** isSSHPath 的实现 */
export function isSSHPath(p: string | undefined | null): p is string {
  return typeof p === "string" && p.startsWith("ssh://");
}

/** SSH URL 拆分结果 */
export interface SshUrlParts {
  /** `ssh://user@host:port`(无尾部斜杠，无路径) */
  prefix: string;
  /** 远程绝对 POSIX 路径，始终以 `/` 开头 */
  root: string;
  username: string;
  host: string;
  port: number;
}

/**
 * 解析 ssh://user@host:port/abs/path URL 为各组成部分。
 */
/** splitSshUrl 的实现 */
export function splitSshUrl(url: string): SshUrlParts | null {
  const parsed = parseSSHUrl(url);
  if (!parsed) {
    return null;
  }
  const prefix = `ssh://${parsed.username}@${parsed.host}:${parsed.port}`;
  let root = parsed.path || "/";
  // 规范化反斜杠
  root = root.replace(/\\/g, "/");
  // 折叠尾部斜杠(根路径 `/` 除外)
  if (root.length > 1 && root.endsWith("/")) {
    root = root.replace(/\/+$/, "");
  }
  return {
    host: parsed.host,
    port: parsed.port,
    prefix,
    root,
    username: parsed.username,
  };
}

/**
 * POSIX 路径拼接。
 * 折叠多个斜杠，保留首个段的 leading slash。
 */
/** posixJoin 的实现 */
export function posixJoin(...segments: string[]): string {
  const filtered = segments.filter((s) => s && s.length > 0);
  if (filtered.length === 0) {
    return "";
  }
  const joined = filtered.join("/").replace(/\\/g, "/");
  const leading = filtered[0]!.startsWith("/") ? "/" : "";
  return leading + joined.replace(/^\/+/, "").replace(/\/{2,}/g, "/");
}

/**
 * 将远程绝对路径转换为 ssh:// URL。
 */
/** toSshUrl 的实现 */
export function toSshUrl(baseUrl: string, absoluteRemotePath: string): string {
  const parts = splitSshUrl(baseUrl);
  if (!parts) {
    return baseUrl + absoluteRemotePath;
  }
  const abs = absoluteRemotePath.startsWith("/") ? absoluteRemotePath : `/${absoluteRemotePath}`;
  return parts.prefix + abs;
}

/**
 * 将可能相对的路径解析为远程绝对路径。
 */
/** resolveRemotePath 的实现 */
export function resolveRemotePath(root: string, p: string): string {
  const normalized = p.replace(/\\/g, "/");
  if (normalized.startsWith("/")) {
    return normalized;
  }
  return posixJoin(root, normalized);
}

/**
 * 计算从 root 到 target 的相对 POSIX 路径。
 */
/** relativeRemotePath 的实现 */
export function relativeRemotePath(root: string, target: string): string {
  const r = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const t = target.replace(/\\/g, "/");
  if (r && t.startsWith(`${r}/`)) {
    return t.slice(r.length + 1);
  }
  if (t === r) {
    return "";
  }
  return t;
}
