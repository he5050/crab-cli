/**
 * 实例锁 — 防止同一项目目录下启动多个 crab-cli 实例
 *
 * 职责:
 *   - 基于 PID 的文件锁(.crab/locks/<id>.lock)
 *   - 僵尸锁自动清理(检测 PID 是否存活)
 *   - 支持多实例 ID(如不同项目目录各自独立锁)
 *
 * 模块功能:
 *   - InstanceLockManager: 实例锁管理器类
 *   - isLocked: 检查实例 ID 是否被锁定
 *   - lock: 锁定实例 ID
 *   - unlock: 解锁实例 ID
 *   - cleanupStaleLocks: 清理所有僵尸锁
 *   - createInstanceId: 创建实例 ID
 *   - instanceLock: 默认实例锁管理器
 *
 * 使用场景:
 *   - 防止同一项目启动多个 crab 实例
 *   - 多项目独立锁管理
 *   - 应用启动时检查实例冲突
 *
 * 边界:
 * 1. 基于文件系统实现，依赖 PID 检测
 * 2. 僵尸锁自动清理需要文件系统权限
 * 3. 实例 ID 基于项目目录路径
 *
 * 流程:
 * 1. 创建 InstanceLockManager
 * 2. 调用 lock 锁定实例
 * 3. 应用退出时调用 unlock 释放锁
 * 4. 定期调用 cleanupStaleLocks 清理僵尸锁
 */

import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("core:instance-lock");

interface LockData {
  pid: number;
  timestamp: number;
  cwd?: string;
}

export class InstanceLockManager {
  private readonly locksDir: string;

  constructor(baseDir?: string) {
    // 默认使用当前项目的 .crab/locks 目录
    this.locksDir = path.join(baseDir ?? path.join(process.cwd(), ".crab"), "locks");
  }

  /** 确保 locks 目录存在 */
  private ensureLocksDir(): void {
    if (!fs.existsSync(this.locksDir)) {
      fs.mkdirSync(this.locksDir, { recursive: true });
    }
  }

  /** 获取锁文件路径 */
  private getLockPath(instanceId: string): string {
    // 安全化 instanceId，防止路径遍历
    const safeId = instanceId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.locksDir, `${safeId}.lock`);
  }

  /**
   * 检查实例 ID 是否被其他进程锁定。
   * 僵尸锁(进程已退出)会自动清理。
   */
  isLocked(instanceId: string): boolean {
    try {
      const lockPath = this.getLockPath(instanceId);
      if (!fs.existsSync(lockPath)) {
        return false;
      }

      const lockContent = fs.readFileSync(lockPath, "utf8");
      const lockData: LockData = JSON.parse(lockContent);

      // 检查进程是否仍在运行
      try {
        // Process.kill(pid, 0) 不发送信号，只检查进程是否存在
        // 如果进程不存在，会抛出 ESRCH
        process.kill(lockData.pid, 0);
        return true; // 进程仍在运行
      } catch {
        // 进程已退出 → 僵尸锁，清理之
        log.info(`清理僵尸锁: ${instanceId} (PID ${lockData.pid} 已退出)`);
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // 忽略清理错误
        }
        return false;
      }
    } catch {
      return false;
    }
  }

  /**
   * 锁定实例 ID（原子操作，基于 O_EXCL）。
   * @returns true = 锁定成功，false = 已被其他进程锁定
   */
  lock(instanceId: string): boolean {
    try {
      this.ensureLocksDir();
      const lockPath = this.getLockPath(instanceId);

      // 清理僵尸锁（不影响正常锁）
      this.isLocked(instanceId);

      // 使用 O_EXCL 原子创建，文件已存在时直接失败
      const lockData: LockData = {
        cwd: process.cwd(),
        pid: process.pid,
        timestamp: Date.now(),
      };
      const content = JSON.stringify(lockData, null, 2);
      const fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_WRONLY | fs.constants.O_EXCL, 0o600);
      try {
        fs.writeSync(fd, Buffer.from(content, "utf8"));
      } finally {
        fs.closeSync(fd);
      }

      log.debug(`实例已锁定: ${instanceId} (PID ${process.pid})`);
      return true;
    } catch (error) {
      // EEXIST 表示文件已存在（其他进程持有锁）
      if (error && typeof error === "object" && "code" in error && (error as { code: string }).code === "EEXIST") {
        log.debug(`实例已被锁定: ${instanceId}`);
        return false;
      }
      log.warn(`锁定实例失败: ${instanceId} — ${error}`);
      return false;
    }
  }

  /** 解锁实例 ID */
  unlock(instanceId: string): void {
    try {
      const lockPath = this.getLockPath(instanceId);
      if (fs.existsSync(lockPath)) {
        fs.unlinkSync(lockPath);
        log.debug(`实例已解锁: ${instanceId}`);
      }
    } catch (error) {
      log.warn(`解锁实例失败: ${instanceId} — ${error}`);
    }
  }

  /** 清理所有僵尸锁 */
  cleanupStaleLocks(): number {
    let cleaned = 0;
    try {
      if (!fs.existsSync(this.locksDir)) {
        return 0;
      }

      const files = fs.readdirSync(this.locksDir);
      for (const file of files) {
        if (!file.endsWith(".lock")) {
          continue;
        }
        const lockPath = path.join(this.locksDir, file);
        try {
          const content = fs.readFileSync(lockPath, "utf8");
          const data: LockData = JSON.parse(content);
          // 检查进程是否存活
          try {
            process.kill(data.pid, 0);
          } catch {
            // 进程已退出，清理锁
            fs.unlinkSync(lockPath);
            cleaned++;
          }
        } catch {
          // 无效锁文件，清理
          try {
            fs.unlinkSync(lockPath);
            cleaned++;
          } catch {
            /* Ignore */
          }
        }
      }
    } catch {
      // 目录不存在等
    }
    if (cleaned > 0) {
      log.info(`清理了 ${cleaned} 个僵尸锁`);
    }
    return cleaned;
  }
}

export function createInstanceId(projectDir: string = process.cwd()): string {
  return path.resolve(projectDir);
}

/** 默认的实例锁管理器(基于当前工作目录) */
export const instanceLock = new InstanceLockManager();
