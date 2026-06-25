/**
 * [Hook 注册表]
 *
 * 职责:
 *   - 注册/注销 Hook
 *   - 按事件类型查询 Hook
 *   - 按 priority 排序
 *   - 支持条件过滤(toolName 等)
 *   - 持久化到 .crab/hooks.json
 *
 * 模块功能:
 *   - HookRegistry: Hook 注册表类(全局单例)
 *   - register: 注册 Hook
 *   - unregister: 注销 Hook
 *   - get: 获取指定 Hook
 *   - getAll: 获取所有 Hook
 *   - getByEvent: 按事件获取 Hook(支持条件过滤)
 *   - setEnabled: 启用/禁用 Hook
 *   - loadFromConfig: 从配置文件加载 Hook
 *   - saveToConfig: 保存 Hook 到配置文件
 *
 * 使用场景:
 *   - 注册自定义 Hook
 *   - 查询特定事件的 Hook 列表
 *   - 持久化用户自定义 Hook 配置
 *   - 动态启用/禁用 Hook
 *
 * 边界:
 *   1. 同一 ID 的 Hook 注册会覆盖已有 Hook
 *   2. 仅返回 enabled=true 的 Hook
 *   3. 条件过滤仅支持 toolName 匹配
 *   4. 配置文件仅保存 shell 类型的 Hook
 *
 * 流程:
 *   1. 调用 register 方法注册 Hook
 *   2. 调用 getByEvent 获取事件匹配的 Hook
 *   3. 按 priority 排序并应用条件过滤
 *   4. 可选:调用 saveToConfig 持久化配置
 */
import { createLogger } from "@/core/logging/logger";
import type { HookContext, HookDefinition, HookEvent } from "@/hooks/types";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const log = createLogger("hooks:registry");

/** Hook 注册表(全局单例) */
class HookRegistry {
  private hooks = new Map<string, HookDefinition>();

  /** 注册 Hook */
  register(hook: HookDefinition): void {
    if (this.hooks.has(hook.id)) {
      log.warn(`Hook 已存在，将覆盖: ${hook.id}`);
    }
    this.hooks.set(hook.id, hook);
    log.debug(`注册 Hook: ${hook.id} [${hook.event}] (priority=${hook.priority})`);
  }

  /** 注销 Hook */
  unregister(hookId: string): boolean {
    const deleted = this.hooks.delete(hookId);
    if (deleted) {
      log.debug(`注销 Hook: ${hookId}`);
    }
    return deleted;
  }

  /** 获取指定 Hook */
  get(hookId: string): HookDefinition | undefined {
    return this.hooks.get(hookId);
  }

  /** 获取所有 Hook */
  getAll(): HookDefinition[] {
    return [...this.hooks.values()];
  }

  /** 获取指定事件的 Hook(按 priority 排序，仅启用的) */
  getByEvent(event: HookEvent, context?: HookContext): HookDefinition[] {
    const hooks = [...this.hooks.values()]
      .filter((h) => h.event === event && h.enabled)
      .toSorted((a, b) => a.priority - b.priority);

    if (!context) {
      return hooks;
    }

    // 条件过滤
    return hooks.filter((h) => {
      if (!h.condition) {
        return true;
      }

      // ToolName 过滤
      if (h.condition.toolName && context.toolName) {
        const allowed = Array.isArray(h.condition.toolName) ? h.condition.toolName : [h.condition.toolName];
        if (!allowed.includes(context.toolName)) {
          return false;
        }
      }

      return true;
    });
  }

  /** 启用/禁用 Hook */
  setEnabled(hookId: string, enabled: boolean): boolean {
    const hook = this.hooks.get(hookId);
    if (!hook) {
      return false;
    }
    hook.enabled = enabled;
    log.debug(`${enabled ? "启用" : "禁用"} Hook: ${hookId}`);
    return true;
  }

  /** 清空所有 Hook */
  clear(): void {
    this.hooks.clear();
    log.debug("清空所有 Hook");
  }

  /** 获取 Hook 数量 */
  get size(): number {
    return this.hooks.size;
  }

  /**
   * 从 .crab/hooks.json 加载用户自定义 Hook。
   */
  loadFromConfig(projectRoot: string): number {
    const configPath = join(projectRoot, ".crab", "hooks.json");
    if (!existsSync(configPath)) {
      return 0;
    }

    try {
      const content = readFileSync(configPath, "utf8");
      const config = JSON.parse(content);

      let count = 0;
      if (Array.isArray(config.hooks)) {
        for (const hookDef of config.hooks) {
          if (hookDef.id && hookDef.event && hookDef.command) {
            this.register({
              command: hookDef.command,
              condition: hookDef.condition,
              description: hookDef.description,
              enabled: hookDef.enabled !== false,
              event: hookDef.event as HookEvent,
              id: hookDef.id,
              name: hookDef.name ?? hookDef.id,
              priority: hookDef.priority ?? 100,
              timeout: hookDef.timeout ?? 30_000,
              type: "shell",
            });
            count++;
          }
        }
      }

      log.info(`从 ${configPath} 加载 ${count} 个 Hook`);
      return count;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.warn(`加载 Hook 配置失败: ${configPath}: ${msg}`);
      return 0;
    }
  }

  /**
   * 保存 Hook 配置到 .crab/hooks.json。
   */
  saveToConfig(projectRoot: string): void {
    const configDir = join(projectRoot, ".crab");
    const configPath = join(configDir, "hooks.json");

    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    const hooks = this.getAll()
      .filter((h) => h.type === "shell") // 只保存 shell 类型的 Hook
      .map((h) => ({
        command: h.command,
        condition: h.condition,
        description: h.description,
        enabled: h.enabled,
        event: h.event,
        id: h.id,
        name: h.name,
        priority: h.priority,
        timeout: h.timeout,
      }));

    writeFileSync(configPath, JSON.stringify({ hooks }, null, 2), "utf8");
    log.info(`保存 ${hooks.length} 个 Hook 到 ${configPath}`);
  }
}

/** 全局 Hook 注册表实例 */
export const hookRegistry = new HookRegistry();
