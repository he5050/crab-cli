/**
 * Log Rotation 模块
 *
 * 职责:
 *   - SSE Daemon 日志轮转管理
 *   - 日志文件大小监控和归档
 *   - 旧日志自动清理
 *
 * 模块功能:
 *   - createRotatingLogStream(): 创建自动轮转的日志流
 *   - RotatingLogStreamOptions: 轮转配置
 *   - 日志文件写入和大小检测
 *   - 归档文件命名和管理
 *
 * 使用场景:
 *   - SSE Daemon 后台进程日志记录
 *   - 防止日志文件无限增长
 *   - 保留最近 N 个日志备份
 *
 * 边界:
 *   1. 仅用于 SSE daemon 模式，不影响正常日志系统
 *   2. 日志存储在 ~/.crab/sse-daemon/ 目录
 *   3. 默认 5MB 轮转阈值，保留 3 个备份
 *   4. 纯文本日志格式(非结构化)
 *   5. 同步写入，不做缓冲
 *
 * 流程:
 *   1. 创建日志目录(如不存在)
 *   2. 打开或创建日志文件
 *   3. 每次写入前检查文件大小
 *   4. 超过阈值时执行轮转:.log → .1.log → .2.log → .3.log
 *   5. 删除超出备份数量的旧文件
 */

import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("log-rotation");

export interface RotatingLogStreamOptions {
  logFilePath: string;
  maxSizeBytes?: number;
  maxBackups?: number;
}

export interface RotatingLogStream {
  write(data: string): void;
  close(): void;
}

const DEFAULT_MAX_SIZE = 5 * 1024 * 1024; // 5MB
const DEFAULT_MAX_BACKUPS = 3;

export function createRotatingLogStream(options: RotatingLogStreamOptions): RotatingLogStream {
  const maxSize = options.maxSizeBytes ?? DEFAULT_MAX_SIZE;
  const maxBackups = options.maxBackups ?? DEFAULT_MAX_BACKUPS;
  const logDir = path.dirname(options.logFilePath);

  // 确保日志目录存在
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  let currentSize = 0;
  let fd: number | null = null;
  let closed = false;

  function openLogFile(): void {
    if (fd !== null) {
      return;
    }

    try {
      // 打开日志文件(追加模式)
      fd = fs.openSync(options.logFilePath, "a");
      const stats = fs.fstatSync(fd);
      currentSize = stats.size;
    } catch (error) {
      log.error(`打开日志文件失败: ${error instanceof Error ? error.message : String(error)}`);
      fd = null;
    }
  }

  function closeLogFile(): void {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch (error) {
        log.error(`关闭日志文件失败: ${error instanceof Error ? error.message : String(error)}`);
      }
      fd = null;
    }
  }

  function rotateLogFile(): void {
    closeLogFile();

    try {
      // 删除最旧的备份(如果存在)
      const oldestBackup = `${options.logFilePath}.${maxBackups}.log`;
      if (fs.existsSync(oldestBackup)) {
        fs.unlinkSync(oldestBackup);
      }

      // 移动现有备份:.2.log → .3.log, .1.log → .2.log
      for (let i = maxBackups - 1; i >= 1; i--) {
        const src = `${options.logFilePath}.${i}.log`;
        const dst = `${options.logFilePath}.${i + 1}.log`;
        if (fs.existsSync(src)) {
          fs.renameSync(src, dst);
        }
      }

      // 移动当前日志:.log → .1.log
      if (fs.existsSync(options.logFilePath)) {
        fs.renameSync(options.logFilePath, `${options.logFilePath}.1.log`);
      }

      currentSize = 0;
      log.info(`日志轮转完成: ${path.basename(options.logFilePath)}`);
    } catch (error) {
      log.error(`日志轮转失败: ${error instanceof Error ? error.message : String(error)}`);
    }

    openLogFile();
  }

  openLogFile();

  return {
    close(): void {
      closed = true;
      closeLogFile();
    },

    write(data: string): void {
      if (closed) {
        return;
      }
      if (fd === null) {
        openLogFile();
      }

      if (fd === null) {
        return;
      }

      try {
        const buffer = Buffer.from(data, "utf8");
        fs.writeSync(fd, buffer);
        currentSize += buffer.length;

        // 检查是否需要轮转
        if (currentSize >= maxSize) {
          rotateLogFile();
        }
      } catch (error) {
        log.error(`写入日志失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}
