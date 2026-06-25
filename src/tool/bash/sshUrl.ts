/**
 * SSH URL 解析 — re-export from shared，保留向后兼容。
 *
 * 原实现已迁移至 @/tool/shared/sshUrl.ts。
 * 本文件仅做 re-export，避免现有 import 路径断裂。
 */
export { parseSSHUrl, type ParsedSSHUrl } from "@/tool/shared/sshUrl";
