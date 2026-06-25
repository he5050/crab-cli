/**
 * CLI 命令注册表 — 提供可扩展的命令注册和执行机制。
 *
 * 设计目标:
 *   - 解耦命令定义与执行逻辑
 *   - 支持插件化扩展新命令
 *   - 每个命令自带验证和执行逻辑
 */

import type { ParsedCliArgs, CliMode } from "../type";
import type { CliOrchestratorDeps } from "../type";

/**
 * CLI 命令接口
 */
export interface CliCommand {
  /** 命令对应的模式（与 CliMode 联合类型对齐，保证注册表与路由的编译期一致性） */
  mode: CliMode;

  /** 命令描述（用于帮助文本生成） */
  description: string;

  /** 命令用法行（用于 help 动态生成），可选 */
  usage?: string;

  /** 执行函数 */
  execute: (parsed: ParsedCliArgs, deps: CliOrchestratorDeps) => Promise<void>;

  /** 可选的参数验证函数，在执行前调用 */
  validate?: (parsed: ParsedCliArgs) => void;
}

/**
 * 命令注册表管理器
 */
class CommandRegistry {
  private commands = new Map<CliMode, CliCommand>();

  /**
   * 注册命令
   */
  register(command: CliCommand): void {
    if (this.has(command.mode)) {
      throw new Error(`命令已存在: ${command.mode}`);
    }
    this.commands.set(command.mode, command);
  }

  /**
   * 获取命令
   */
  get(mode: CliMode): CliCommand | undefined {
    return this.commands.get(mode);
  }

  /**
   * 检查命令是否存在（内部使用）
   * @internal
   */
  private has(mode: CliMode): boolean {
    return this.commands.has(mode);
  }

  /**
   * 获取所有已注册的命令
   */
  getAll(): CliCommand[] {
    return Array.from(this.commands.values());
  }

  /**
   * 清空所有命令（用于测试）
   */
  clear(): void {
    this.commands.clear();
  }
}

// 单例实例
const registry = new CommandRegistry();

/**
 * 注册命令到全局注册表
 */
export function registerCommand(command: CliCommand): void {
  registry.register(command);
}

/**
 * 获取命令
 */
export function getCommand(mode: CliMode): CliCommand | undefined {
  return registry.get(mode);
}

/**
 * 获取所有命令
 */
export function getAllCommands(): CliCommand[] {
  return registry.getAll();
}

/**
 * 清空注册表（仅用于测试）
 */
export function __clearCommandRegistry(): void {
  registry.clear();
}
