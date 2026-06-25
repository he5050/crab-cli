/**
 * 编辑前文件备份 — 在文件变更前创建快照备份。
 *
 * 职责:
 *   - 在文件变更前创建备份
 *   - 管理备份文件生命周期
 *   - 限制备份数量
 *   - 提供恢复能力
 *
 * 模块功能:
 *   - backupFileBeforeMutation: 变更前备份
 *   - cleanupOldBackups: 清理旧备份
 *   - 备份命名管理
 *   - 最大备份数限制
 *
 * 使用场景:
 *   - 文件编辑前备份
 *   - 防止数据丢失
 *   - 支持操作回滚
 *   - 自动备份管理
 *
 * 边界:
 *   1. 备份存储在 .crab/backups/
 *   2. 默认保留最近 5 份备份
 *   3. 备份文件名包含时间戳
 *   4. 自动清理旧备份
 *   5. 备份失败不影响主操作
 *
 * 流程:
 *   1. 检查文件是否存在
 *   2. 创建备份目录
 *   3. 生成备份文件名
 *   4. 复制文件到备份目录
 *   5. 清理旧备份
 */

import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("tool:filesystem:backup");

/** 保留的最大备份数 */
const MAX_BACKUPS = 5;

/**
 * 在文件变更前创建备份，存储在 .crab/backups/ 目录并保留最近 N 份。
 * @param filePath 待备份的文件路径
 * @returns 备份文件路径，失败时返回 null
 */
/** backupFileBeforeMutation 的实现 */
export function backupFileBeforeMutation(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) {
      return null;
    }

    const cwd = process.cwd();
    const backupDir = join(cwd, ".crab", "backups");
    if (!existsSync(backupDir)) {
      mkdirSync(backupDir, { mode: 0o700, recursive: true });
    }
    chmodSync(backupDir, 0o700);

    // 创建备份文件名(时间戳 + 原始文件名)
    const baseName = filePath.replace(/[/\\]/g, "_");
    const timestamp = Date.now();
    const backupName = `${timestamp}_${baseName}`;
    const backupPath = join(backupDir, backupName);

    copyFileSync(filePath, backupPath);
    chmodSync(backupPath, 0o600);
    log.debug(`备份已创建: ${backupPath}`);

    // 清理旧备份
    cleanupOldBackups(backupDir, baseName);

    return backupPath;
  } catch (error) {
    log.warn(`备份失败: ${filePath} — ${error}`);
    return null;
  }
}

/** 清理同一文件的旧备份，保留最近 MAX_BACKUPS 份 */
function cleanupOldBackups(backupDir: string, baseName: string): void {
  try {
    const files = readdirSync(backupDir)
      .filter((f) => f.endsWith(baseName))
      .toSorted()
      .toReversed(); // 最新在前

    if (files.length > MAX_BACKUPS) {
      for (let i = MAX_BACKUPS; i < files.length; i++) {
        const oldBackup = join(backupDir, files[i]!);
        try {
          unlinkSync(oldBackup);
        } catch {
          /* Ignore */
        }
      }
    }
  } catch {
    /* Ignore */
  }
}
