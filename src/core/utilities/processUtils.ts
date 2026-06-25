/**
 * 进程工具 — 进程存活检测等。
 */
import { unlinkSync, writeFileSync } from "node:fs";

/**
 * 检测进程是否存活。
 * EPERM 表示进程存在但无权限探测，按存活处理。
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      const code = String((error as NodeJS.ErrnoException).code ?? "");
      if (code === "EPERM") {
        return true;
      }
    }
    return false;
  }
}

/**
 * 安全删除文件（降级策略: unlink → 覆盖空内容 → 忽略）。
 * 用于持久化清理场景，即使删除失败也不影响主流程。
 */
export function safeUnlinkSync(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch {
    try {
      writeFileSync(filePath, "", "utf8");
    } catch {
      /* 彻底无法操作文件，忽略 */
    }
  }
}
