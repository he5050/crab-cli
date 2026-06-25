/**
 * 命令使用频率统计 — 追踪命令使用次数，支持常用命令推荐。
 *
 * 职责:
 *   - 记录命令使用次数
 *   - 提供命令使用统计
 *   - 支持常用命令推荐
 *   - 数据持久化存储
 *
 * 模块功能:
 *   - recordUsage:记录一次命令使用
 *   - getUsageCount:获取命令使用次数
 *   - getAllUsage:获取所有使用记录
 *   - getTopCommands:获取最常用的 N 个命令
 *   - clearUsage:清空使用记录
 *   - dispose:清理资源，确保数据被保存
 *
 * 使用场景:
 *   - 追踪用户命令使用习惯
 *   - 推荐常用命令
 *   - 分析命令使用频率
 *
 * 边界:
 *   1. 数据存储在 ~/.crab/command-usage.json
 *   2. 使用内存缓存 + 延迟写入避免频繁 IO
 *   3. 延迟写入时间为 1 秒
 *   4. 进程退出前自动保存
 *
 * 流程:
 *   1. 调用 recordUsage 记录命令使用
 *   2. 数据先写入内存缓存
 *   3. 延迟 1 秒后写入文件
 *   4. 进程退出前调用 dispose 确保保存
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "@/config";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("session:command-usage");

// ─── 类型定义 ──────────────────────────────────────────────

export interface CommandUsageData {
  /** 命令使用次数映射 { commandName: count } */
  usage: Record<string, number>;
  /** 最后更新时间 */
  lastUpdated: number;
}

// ─── 命令使用频率管理器 ─────────────────────────────────────

class CommandUsageManager {
  private readonly usageFile: string;
  private usageData: CommandUsageData | null = null;
  private isDirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly saveDelay = 1000; // 1 秒延迟写入

  constructor() {
    this.usageFile = join(getDataDir(), "command-usage.json");
  }

  private ensureDir(): void {
    const dir = join(this.usageFile, "..");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private async loadUsage(): Promise<void> {
    if (this.usageData) {
      return;
    }

    try {
      this.ensureDir();
      const data = readFileSync(this.usageFile, "utf8");
      this.usageData = JSON.parse(data) as CommandUsageData;
    } catch {
      this.usageData = {
        lastUpdated: Date.now(),
        usage: {},
      };
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    this.saveTimer = setTimeout(() => {
      this.flushSave();
    }, this.saveDelay);
  }

  private flushSave(): void {
    if (!this.usageData || !this.isDirty) {
      return;
    }

    try {
      this.ensureDir();
      this.usageData.lastUpdated = Date.now();
      writeFileSync(this.usageFile, JSON.stringify(this.usageData, null, 2), "utf8");
      this.isDirty = false;
    } catch (error) {
      log.warn("保存命令使用数据失败", { payload: { error: String(error) } });
    }
  }

  /**
   * 记录一次命令使用。
   */
  async recordUsage(commandName: string): Promise<void> {
    await this.loadUsage();
    if (!this.usageData) {
      return;
    }

    this.usageData.usage[commandName] = (this.usageData.usage[commandName] || 0) + 1;

    this.isDirty = true;
    this.scheduleSave();
  }

  /**
   * 获取命令使用次数(异步)。
   */
  async getUsageCount(commandName: string): Promise<number> {
    await this.loadUsage();
    return this.usageData?.usage[commandName] || 0;
  }

  /**
   * 获取命令使用次数(同步，需先确保数据已加载)。
   */
  getUsageCountSync(commandName: string): number {
    return this.usageData?.usage[commandName] || 0;
  }

  /**
   * 确保数据已加载。
   */
  async ensureLoaded(): Promise<void> {
    await this.loadUsage();
  }

  /**
   * 获取所有使用记录。
   */
  async getAllUsage(): Promise<Record<string, number>> {
    await this.loadUsage();
    return { ...this.usageData?.usage };
  }

  /**
   * 获取最常用的 N 个命令(用于推荐)。
   */
  async getTopCommands(limit = 10): Promise<{ command: string; count: number }[]> {
    await this.loadUsage();

    if (!this.usageData) {
      return [];
    }

    return Object.entries(this.usageData.usage)
      .map(([command, count]) => ({ command, count }))
      .toSorted((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /**
   * 清空使用记录。
   */
  async clearUsage(): Promise<void> {
    this.usageData = {
      lastUpdated: Date.now(),
      usage: {},
    };
    this.isDirty = true;
    this.flushSave();
  }

  /**
   * 清理资源，确保数据被保存。
   * 应用退出前调用。
   */
  async dispose(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.isDirty) {
      this.flushSave();
    }
  }
}

/** 单例 */
export const commandUsageManager = new CommandUsageManager();

// 进程退出前保存
process.on("beforeExit", async () => {
  await commandUsageManager.dispose();
});
