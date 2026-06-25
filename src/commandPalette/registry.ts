/**
 * 命令注册表 — 管理所有可用命令。
 *
 * 职责:
 *   - 注册/注销命令
 *   - 按 name / slashName 查询
 *   - 按分类过滤
 *   - 执行命令
 *   - 维护命令使用统计
 *   - 支持 Frecency 排序(频率+最近使用)
 *
 * 模块功能:
 *   - CommandRegistryImpl: 命令注册表实现类
 *   - getCommandRegistry: 获取全局单例注册表实例
 *   - register: 注册单个命令
 *   - registerAll: 批量注册命令
 *   - unregister: 注销命令
 *   - get: 按名称获取命令
 *   - getBySlash: 按斜杠名获取命令
 *   - listByCategory: 按分类列出命令
 *   - listAll: 列出所有命令
 *   - listSlashCommands: 列出所有斜杠命令
 *   - execute: 执行命令
 *   - executeSlash: 执行斜杠命令
 *   - getUsageStats: 获取命令使用统计
 *   - sortByFrecency: 按 Frecency 排序命令
 *
 * 使用场景:
 *   - 应用启动时注册所有可用命令
 *   - 用户输入命令时查询和执行
 *   - 命令面板显示时按分类过滤
 *   - 推荐命令时基于使用统计排序
 *
 * 边界:
 *   1. 命令名称在注册表内必须唯一
 *   2. 使用全局单例模式管理注册表实例
 *   3. 使用内存存储，不持久化命令定义
 *   4. 使用统计在应用重启后重置
 *
 * 流程:
 *   1. 通过 getCommandRegistry() 获取注册表实例
 *   2. 调用 register() 或 registerAll() 注册命令
 *   3. 通过 get() 或 getBySlash() 查询命令
 *   4. 调用 execute() 或 executeSlash() 执行命令
 *   5. 自动更新命令使用统计
 */
import type { Command, CommandRegistry } from "@/commandPalette/types";
import { createLogger } from "@/core/logging/logger";
import { globalBus, type EventBus } from "@/bus";
import { AppEvent } from "@/bus";

const log = createLogger("commands:registry");

class CommandRegistryImpl implements CommandRegistry {
  private commands = new Map<string, Command>();
  private slashIndex = new Map<string, string>(); // SlashName/alias -> command name
  private usageStats = new Map<string, { count: number; lastUsed: number }>();
  private readonly eventBus: EventBus;

  constructor(eventBus: EventBus = globalBus) {
    this.eventBus = eventBus;
  }

  register(command: Command): void {
    const existing = this.commands.get(command.name);
    if (existing) {
      log.debug(`命令覆盖: ${command.name}`);
      this.removeSlashIndex(existing);
    }
    this.commands.set(command.name, command);
    this.addSlashIndex(command);
    if (!this.usageStats.has(command.name)) {
      this.usageStats.set(command.name, { count: 0, lastUsed: 0 });
    }
    log.debug(`命令已注册: ${command.name}${command.slashName ? ` (/${command.slashName})` : ""}`);
  }

  registerAll(commands: Command[]): void {
    for (const cmd of commands) {
      this.register(cmd);
    }
    log.info(`批量注册 ${commands.length} 个命令，共 ${this.commands.size} 个`);
  }

  unregister(name: string): void {
    const cmd = this.commands.get(name);
    if (!cmd) {
      return;
    }
    this.removeSlashIndex(cmd);
    this.commands.delete(name);
    log.debug(`命令已注销: ${name}`);
  }

  get(name: string): Command | undefined {
    return this.commands.get(name);
  }

  getBySlash(slash: string): Command | undefined {
    // 去掉前导 /
    const key = slash.startsWith("/") ? slash.slice(1) : slash;
    const cmdName = this.slashIndex.get(key);
    if (!cmdName) {
      return undefined;
    }
    return this.commands.get(cmdName);
  }

  listByCategory(category: string): Command[] {
    return [...this.commands.values()].filter((c) => c.category === category);
  }

  listAll(): Command[] {
    return [...this.commands.values()];
  }

  listSlashCommands(): Command[] {
    return [...this.commands.values()].filter((c) => c.slashName);
  }

  /** 清空所有已注册命令(测试和热重载用) */
  clear(): void {
    this.commands.clear();
    this.slashIndex.clear();
    this.usageStats.clear();
    log.debug("命令注册表已清空");
  }

  /** 获取命令使用统计 */
  getUsageStats(name: string): { count: number; lastUsed: number } | undefined {
    return this.usageStats.get(name);
  }

  /** Frecency 排序:结合使用频率和最近时间 */
  sortByFrecency(commands: Command[]): Command[] {
    const now = Date.now();
    const HOUR_MS = 3_600_000;
    const DAY_MS = 24 * HOUR_MS;

    return [...commands].toSorted((a, b) => {
      const aStats = this.usageStats.get(a.name);
      const bStats = this.usageStats.get(b.name);

      const aCount = aStats?.count ?? 0;
      const bCount = bStats?.count ?? 0;
      const aLastUsed = aStats?.lastUsed ?? 0;
      const bLastUsed = bStats?.lastUsed ?? 0;

      if (aCount === 0 && bCount === 0) {
        return 0;
      }

      const aRecency = aLastUsed > 0 ? Math.max(0, 1 - (now - aLastUsed) / (7 * DAY_MS)) : 0;
      const bRecency = bLastUsed > 0 ? Math.max(0, 1 - (now - bLastUsed) / (7 * DAY_MS)) : 0;

      const aScore = aCount * 0.6 + aRecency * 0.4;
      const bScore = bCount * 0.6 + bRecency * 0.4;

      return bScore - aScore;
    });
  }

  async execute(name: string): Promise<void> {
    const cmd = this.commands.get(name);
    if (!cmd) {
      log.warn(`命令不存在: ${name}`);
      return;
    }
    log.info(`执行命令: ${name}`);
    const stats = this.usageStats.get(name);
    if (stats) {
      stats.count++;
      stats.lastUsed = Date.now();
    }
    try {
      await cmd.run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`命令执行失败: ${name} — ${message}`);
      this.eventBus.publish(AppEvent.Toast, {
        message: `命令执行失败: ${name} — ${message}`,
        variant: "error",
      });
    }
  }

  async executeSlash(slash: string, args?: string): Promise<boolean> {
    const cmd = this.getBySlash(slash);
    if (!cmd) {
      return false;
    }
    const slashLabel = slash.startsWith("/") ? slash : `/${slash}`;
    let succeeded = false;
    try {
      await cmd.run(args);
      succeeded = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`斜杠命令执行失败: ${slashLabel} — ${message}`);
      this.eventBus.publish(AppEvent.Toast, {
        message: `命令执行失败: ${slashLabel} — ${message}`,
        variant: "error",
      });
    }
    return succeeded;
  }

  private addSlashIndex(cmd: Command): void {
    if (cmd.slashName) {
      this.slashIndex.set(cmd.slashName, cmd.name);
    }
    if (cmd.slashAliases) {
      for (const alias of cmd.slashAliases) {
        this.slashIndex.set(alias, cmd.name);
      }
    }
  }

  private removeSlashIndex(cmd: Command): void {
    if (cmd.slashName) {
      this.slashIndex.delete(cmd.slashName);
    }
    if (cmd.slashAliases) {
      for (const alias of cmd.slashAliases) {
        this.slashIndex.delete(alias);
      }
    }
  }
}

// 全局单例
let instance: CommandRegistryImpl | null = null;

export function getCommandRegistry(): CommandRegistry {
  if (!instance) {
    instance = new CommandRegistryImpl();
  }
  return instance;
}

/** 重置单例(仅用于测试隔离) */
export function _resetCommandRegistryForTesting(): void {
  instance = null;
}
