/**
 * 插件系统架构 — 核心插件管理接口和加载机制。
 *
 * 职责:
 *   - 定义插件接口和生命周期
 *   - 管理插件注册和加载
 *   - 提供插件沙箱隔离
 *   - 插件优先级和依赖管理
 *
 * 架构层次:
 *   - PluginInterface: 插件必须实现的接口
 *   - PluginLoader: 插件加载器，负责发现和实例化
 *   - PluginSandbox: 插件沙箱，隔离插件运行环境
 *   - PluginManager: 插件管理器，协调各组件
 *
 * 使用场景:
 *   - 加载第三方插件扩展功能
 *   - 主题插件加载
 *   - 工具插件扩展
 *
 * 边界:
 *   1. 插件崩溃不影响主应用
 *   2. 插件间资源隔离
 *   3. 插件必须通过审核才能加载
 */

import { type LogMetadata, createLogger } from "@/core/logging/logger";
import { createSecurityError, createUserError } from "@/core/errors/appError";

const log = createLogger("plugin:system");

// ─── 类型定义 ─────────────────────────────────────────────────────

/** 插件状态 */
export type PluginStatus =
  | "discovered" // 已发现
  | "loading" // 加载中
  | "loaded" // 已加载
  | "initialized" // 已初始化
  | "running" // 运行中
  | "stopped" // 已停止
  | "error" // 错误
  | "unloaded"; // 已卸载

/** 插件元信息 */
export interface PluginMetadata {
  /** 插件唯一标识 */
  id: string;
  /** 插件名称 */
  name: string;
  /** 插件版本 */
  version: string;
  /** 插件描述 */
  description?: string;
  /** 作者 */
  author?: string;
  /** 插件主页 */
  homepage?: string;
  /** 依赖插件列表 */
  dependencies?: string[];
  /** 冲突插件列表 */
  conflicts?: string[];
  /** 入口文件 */
  main: string;
  /** 插件类型 */
  type: "theme" | "tool" | "integration" | "custom";
  /** 权限要求 */
  permissions?: string[];
  /** 插件来源 */
  source?: string;
}

/** 插件接口 */
export interface PluginInterface {
  /** 获取插件元信息 */
  getMetadata(): PluginMetadata;

  /** 加载插件 */
  load(): Promise<void>;

  /** 卸载插件 */
  unload(): Promise<void>;

  /** 暂停插件 */
  pause?(): Promise<void>;

  /** 恢复插件 */
  resume?(): Promise<void>;

  /** 获取插件状态 */
  getStatus(): PluginStatus;
}

/** 插件实例 */
export interface PluginInstance {
  /** 插件 ID */
  id: string;
  /** 插件实例 */
  plugin: PluginInterface;
  /** 插件元信息 */
  metadata: PluginMetadata;
  /** 当前状态 */
  status: PluginStatus;
  /** 加载时间 */
  loadedAt?: number;
  /** 错误信息 */
  error?: Error;
  /** 优先级(数值越大优先级越高) */
  priority: number;
}

/** 插件加载选项 */
export interface PluginLoadOptions {
  /** 插件路径 */
  path: string;
  /**
   * 沙箱控制。
   *   - true  → 启用默认沙箱(拒绝任何声明了 permissions 的插件 + 路径越界)
   *   - false → 不启用沙箱
   *   - SandboxConfig 对象 → 启用沙箱并按配置约束
   */
  sandbox?: boolean | SandboxConfig;
  /** 优先级 */
  priority?: number;
  /** 加载超时(毫秒) */
  timeout?: number;
}

/** 插件沙箱配置 */
export interface SandboxConfig {
  /** 是否启用网络隔离 */
  networkIsolation?: boolean;
  /** 是否启用文件系统隔离 */
  filesystemIsolation?: boolean;
  /** 允许访问的目录 */
  allowedPaths?: string[];
  /** 允许的环境变量 */
  allowedEnv?: string[];
  /** 内存限制(MB) */
  memoryLimit?: number;
  /** CPU 时间限制(毫秒) */
  cpuTimeLimit?: number;
  /** 允许的权限白名单(与 metadata.permissions 配合校验) */
  permissions?: string[];
}

// ─── 插件管理器 ─────────────────────────────────────────────────

import { PluginSandbox } from "./pluginSandbox";

/**
 * 插件管理器
 */
export class PluginManager {
  private plugins = new Map<string, PluginInstance>();
  private loadOrder: string[] = [];
  private options: Required<PluginLoadOptions>;
  private sandbox: PluginSandbox | null;

  constructor(options: Partial<PluginLoadOptions> = {}) {
    this.options = {
      path: options.path ?? "./plugins",
      priority: options.priority ?? 0,
      sandbox: options.sandbox ?? true,
      timeout: options.timeout ?? 30_000,
    };
    this.sandbox = this.buildSandbox(this.options.sandbox);
  }

  private buildSandbox(cfg: PluginLoadOptions["sandbox"]): PluginSandbox | null {
    if (cfg === false) {
      return null;
    }
    if (cfg === true) {
      return new PluginSandbox({});
    }
    return new PluginSandbox(cfg);
  }

  /**
   * 注册插件
   */
  async register(plugin: PluginInterface, priority?: number): Promise<void> {
    const metadata = plugin.getMetadata();

    if (this.plugins.has(metadata.id)) {
      log.warn(`插件 ${metadata.id} 已存在，跳过注册`);
      return;
    }

    const instance: PluginInstance = {
      id: metadata.id,
      metadata,
      plugin,
      priority: priority ?? this.options.priority,
      status: "discovered",
    };

    this.plugins.set(metadata.id, instance);
    log.info(`插件已注册: ${metadata.name} v${metadata.version}`);
  }

  /**
   * 注销插件
   */
  async unregister(pluginId: string): Promise<void> {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      log.warn(`插件 ${pluginId} 不存在`);
      return;
    }

    if (instance.status === "loaded" || instance.status === "running" || instance.status === "initialized") {
      await instance.plugin.unload();
    }

    this.plugins.delete(pluginId);
    this.loadOrder = this.loadOrder.filter((id) => id !== pluginId);

    log.info(`插件已注销: ${pluginId}`);
  }

  /**
   * 加载插件
   */
  async load(pluginId: string): Promise<void> {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      throw createUserError("RESOURCE_NOT_FOUND", `插件 ${pluginId} 不存在`);
    }

    if (instance.status === "loaded" || instance.status === "running") {
      log.debug(`插件 ${pluginId} 已加载`);
      return;
    }

    instance.status = "loading";

    try {
      // 沙箱校验(在依赖/冲突检查之前，避免加载越权插件)
      if (this.sandbox) {
        const entryPath = instance.metadata.main ?? "";
        const check = this.sandbox.assertCanLoad({
          entryPath,
          metadata: instance.metadata,
        });
        if (!check.ok) {
          throw createSecurityError("AUTHZ_FAILED", `沙箱拒绝加载插件 ${instance.id}: ${check.error}`);
        }
      }

      // 检查依赖
      await this.checkDependencies(instance);

      // 检查冲突
      this.checkConflicts(instance);

      // 加载插件
      await Promise.race([instance.plugin.load(), this.createTimeout(this.options.timeout)]);

      instance.status = "loaded";
      instance.loadedAt = Date.now();

      log.info(`插件已加载: ${pluginId}`);
    } catch (error) {
      instance.status = "error";
      instance.error = error instanceof Error ? error : new Error(String(error));
      log.error(`插件加载失败: ${pluginId}`, error as LogMetadata);
      throw error;
    }
  }

  /**
   * 批量加载插件(按依赖顺序)
   */
  async loadAll(): Promise<void> {
    // 计算加载顺序
    this.loadOrder = this.resolveLoadOrder();

    // 按顺序加载
    for (const pluginId of this.loadOrder) {
      try {
        await this.load(pluginId);
      } catch (error) {
        log.error(`批量加载插件失败: ${pluginId}`, error as Parameters<typeof log.error>[1]);
        // 继续加载其他插件
      }
    }
  }

  /**
   * 卸载插件
   */
  async unload(pluginId: string): Promise<void> {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      return;
    }

    if (instance.status === "loaded" || instance.status === "running" || instance.status === "initialized") {
      await instance.plugin.unload();
    }

    instance.status = "unloaded";
    log.info(`插件已卸载: ${pluginId}`);
  }

  /**
   * 卸载所有插件
   */
  async unloadAll(): Promise<void> {
    for (const pluginId of this.plugins.keys()) {
      await this.unload(pluginId);
    }
  }

  /**
   * 获取插件实例
   */
  get(pluginId: string): PluginInstance | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * 获取所有插件
   */
  getAll(): PluginInstance[] {
    return [...this.plugins.values()];
  }

  /**
   * 获取已加载的插件
   */
  getLoaded(): PluginInstance[] {
    return this.getAll().filter((p) => p.status === "loaded" || p.status === "running");
  }

  /**
   * 按类型获取插件
   */
  getByType(type: PluginMetadata["type"]): PluginInstance[] {
    return this.getAll().filter((p) => p.metadata.type === type);
  }

  /**
   * 获取加载顺序
   */
  getLoadOrder(): string[] {
    return [...this.loadOrder];
  }

  /**
   * 检查依赖是否满足
   */
  private async checkDependencies(instance: PluginInstance): Promise<void> {
    const deps = instance.metadata.dependencies;
    if (!deps || deps.length === 0) {
      return;
    }

    for (const depId of deps) {
      const dep = this.plugins.get(depId);
      if (!dep) {
        throw createUserError("RESOURCE_NOT_FOUND", `插件 ${instance.id} 缺少依赖: ${depId}`);
      }
      if (dep.status !== "loaded" && dep.status !== "running") {
        throw createUserError("INVALID_INPUT", `插件 ${instance.id} 的依赖 ${depId} 未加载`);
      }
    }
  }

  /**
   * 检查冲突插件
   */
  private checkConflicts(instance: PluginInstance): void {
    const { conflicts } = instance.metadata;
    if (!conflicts || conflicts.length === 0) {
      return;
    }

    for (const conflictId of conflicts) {
      const conflict = this.plugins.get(conflictId);
      if (conflict && (conflict.status === "loaded" || conflict.status === "running")) {
        throw createUserError("RESOURCE_EXISTS", `插件 ${instance.id} 与 ${conflictId} 冲突`);
      }
    }
  }

  /**
   * 解析加载顺序(拓扑排序)
   */
  private resolveLoadOrder(): string[] {
    const visited = new Set<string>();
    const order: string[] = [];

    const visit = (pluginId: string) => {
      if (visited.has(pluginId)) {
        return;
      }
      visited.add(pluginId);

      const instance = this.plugins.get(pluginId);
      if (!instance) {
        return;
      }

      // 先访问依赖
      const deps = instance.metadata.dependencies ?? [];
      for (const depId of deps) {
        visit(depId);
      }

      order.push(pluginId);
    };

    for (const pluginId of this.plugins.keys()) {
      visit(pluginId);
    }

    return order;
  }

  /**
   * 创建超时 Promise
   */
  private createTimeout(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`插件加载超时: ${ms}ms`)), ms);
    });
  }
}

// ─── 工厂函数 ─────────────────────────────────────────────────────

/**
 * 创建插件管理器
 */
export function createPluginManager(options?: Partial<PluginLoadOptions>): PluginManager {
  return new PluginManager(options);
}

// ─── 基础插件类 ─────────────────────────────────────────────────

/**
 * 基础插件类，提供通用实现
 */
export abstract class BasePlugin implements PluginInterface {
  protected metadata: PluginMetadata;
  protected status: PluginStatus = "discovered";

  constructor(metadata: PluginMetadata) {
    this.metadata = metadata;
  }

  getMetadata(): PluginMetadata {
    return this.metadata;
  }

  getStatus(): PluginStatus {
    return this.status;
  }

  /**
   * 供子类在 load/unload 等生命周期中更新状态。
   */
  protected setStatus(status: PluginStatus): void {
    this.status = status;
  }

  abstract load(): Promise<void>;
  abstract unload(): Promise<void>;
}
