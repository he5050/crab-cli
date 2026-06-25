/**
 * 工作空间管理器 — 管理远程工作空间的持久化和 CRUD 操作
 *
 * 职责:
 *   - 管理远程工作空间的增删改查
 *   - 工作空间配置的持久化存储
 *   - 提供单例访问接口
 *
 * 模块功能:
 *   - WorkspaceManager:工作空间管理器单例类
 *   - getInstance:获取单例实例
 *   - init:初始化管理器，加载已保存的工作空间
 *   - addWorkspace:添加新工作空间
 *   - getWorkspace:获取工作空间
 *   - getAllWorkspaces:获取所有工作空间
 *   - updateWorkspace:更新工作空间
 *   - removeWorkspace:移除工作空间
 *   - hasWorkspace:检查工作空间是否存在
 *   - getWorkspaceManager:便捷获取单例函数
 *
 * 使用场景:
 *   - CLI 命令行工具管理多个远程工作空间
 *   - 工作空间配置的持久化存储
 *   - 工作空间列表的展示和管理
 *
 * 边界:
 * 1. 单例模式，确保全局唯一实例
 * 2. 数据持久化到 ~/.crab/remote-workspaces.json
 * 3. 必须在使用前调用 init() 初始化
 *
 * 流程:
 * 1. getInstance() 获取单例实例
 * 2. init() 从存储文件加载已保存的工作空间
 * 3. CRUD 操作自动同步到存储文件
 * 4. 文件不存在时初始化为空列表
 */
import fs from "node:fs";
import path from "node:path";
import type { RemoteWorkspaceConfig } from "./workspace";
import { RemoteWorkspace } from "./workspace";
import { createLogger } from "@/core/logging/logger";
import { getConfigDir } from "@/config";
import { InternalError, SystemError, UserError } from "@/core/errors/appError";
import { ERROR_CODES } from "@/core/errors/errorCodes";

const log = createLogger("ssh:workspace-manager");

/** 工作空间存储文件路径 */
const WORKSPACES_FILE = "remote-workspaces.json";

/**
 * 工作空间管理器类(单例模式)
 *
 * 提供远程工作空间的增删改查和持久化功能
 */
export class WorkspaceManager {
  private static instance: WorkspaceManager | null = null;
  private workspaces = new Map<string, RemoteWorkspace>();
  private initialized = false;
  private storagePath: string;

  private constructor() {
    this.storagePath = path.join(getConfigDir(), WORKSPACES_FILE);
  }

  /**
   * 获取 WorkspaceManager 单例实例
   */
  static getInstance(): WorkspaceManager {
    if (!WorkspaceManager.instance) {
      WorkspaceManager.instance = new WorkspaceManager();
    }
    return WorkspaceManager.instance;
  }

  /**
   * 重置单例实例(主要用于测试)
   */
  static resetInstance(): void {
    WorkspaceManager.instance = null;
  }

  /**
   * 初始化管理器，加载已保存的工作空间
   */
  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      await this.loadWorkspaces();
      this.initialized = true;
      log.info(`工作空间管理器初始化完成，加载了 ${this.workspaces.size} 个工作空间`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error("工作空间管理器初始化失败", { error: msg });
      throw new SystemError(ERROR_CODES.SYSTEM.FS_READ_ERROR.code, `初始化工作空间管理器失败: ${msg}`, {
        cause: error,
      });
    }
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * 添加工作空间
   */
  async addWorkspace(config: RemoteWorkspaceConfig): Promise<RemoteWorkspace> {
    this.ensureInitialized();

    if (this.workspaces.has(config.id)) {
      throw new UserError(ERROR_CODES.USER.RESOURCE_EXISTS.code, `工作空间 ID 已存在: ${config.id}`, {
        context: { workspaceId: config.id },
      });
    }

    const workspace = new RemoteWorkspace(config);
    this.workspaces.set(config.id, workspace);
    await this.saveWorkspaces();

    log.info(`添加工作空间: ${config.name} (${config.id})`);
    return workspace;
  }

  /**
   * 获取工作空间
   */
  getWorkspace(id: string): RemoteWorkspace | undefined {
    this.ensureInitialized();
    return this.workspaces.get(id);
  }

  /**
   * 获取所有工作空间
   */
  getAllWorkspaces(): RemoteWorkspace[] {
    this.ensureInitialized();
    return [...this.workspaces.values()];
  }

  /**
   * 更新工作空间
   */
  async updateWorkspace(id: string, updates: Partial<Omit<RemoteWorkspaceConfig, "id">>): Promise<RemoteWorkspace> {
    this.ensureInitialized();

    const workspace = this.workspaces.get(id);
    if (!workspace) {
      throw new UserError(ERROR_CODES.USER.RESOURCE_NOT_FOUND.code, `工作空间不存在: ${id}`, {
        context: { workspaceId: id },
      });
    }

    const config = workspace.toConfig();
    const updatedConfig: RemoteWorkspaceConfig = {
      ...config,
      ...updates,
      id, // 确保 ID 不变
    };

    const updatedWorkspace = new RemoteWorkspace(updatedConfig);
    this.workspaces.set(id, updatedWorkspace);
    await this.saveWorkspaces();

    log.info(`更新工作空间: ${updatedConfig.name} (${id})`);
    return updatedWorkspace;
  }

  /**
   * 移除工作空间
   */
  async removeWorkspace(id: string): Promise<boolean> {
    this.ensureInitialized();

    const workspace = this.workspaces.get(id);
    if (!workspace) {
      return false;
    }

    this.workspaces.delete(id);
    await this.saveWorkspaces();

    log.info(`移除工作空间: ${workspace.name} (${id})`);
    return true;
  }

  /**
   * 检查工作空间是否存在
   */
  hasWorkspace(id: string): boolean {
    this.ensureInitialized();
    return this.workspaces.has(id);
  }

  /**
   * 获取工作空间数量
   */
  getWorkspaceCount(): number {
    this.ensureInitialized();
    return this.workspaces.size;
  }

  /**
   * 从存储文件加载工作空间
   */
  private async loadWorkspaces(): Promise<void> {
    try {
      const data = await fs.promises.readFile(this.storagePath, "utf8");
      const configs: RemoteWorkspaceConfig[] = JSON.parse(data);

      this.workspaces.clear();
      for (const config of configs) {
        this.workspaces.set(config.id, new RemoteWorkspace(config));
      }

      log.debug(`从 ${this.storagePath} 加载了 ${configs.length} 个工作空间配置`);
    } catch (error) {
      // 文件不存在时视为空列表
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        log.debug("工作空间配置文件不存在，初始化为空");
        this.workspaces.clear();
        return;
      }
      throw error;
    }
  }

  /**
   * 保存工作空间到存储文件
   */
  private async saveWorkspaces(): Promise<void> {
    const configs = this.getAllWorkspaces().map((w) => w.toConfig());
    const data = JSON.stringify(configs, null, 2);

    // 确保目录存在
    const dir = path.dirname(this.storagePath);
    await fs.promises.mkdir(dir, { recursive: true });

    await fs.promises.writeFile(this.storagePath, data, "utf8");
    log.debug(`保存了 ${configs.length} 个工作空间配置到 ${this.storagePath}`);
  }

  /**
   * 确保管理器已初始化
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new InternalError(
        ERROR_CODES.INTERNAL.STATE_INCONSISTENT.code,
        "WorkspaceManager 未初始化，请先调用 init()",
      );
    }
  }

  /**
   * 获取存储路径(主要用于测试)
   */
  getStoragePath(): string {
    return this.storagePath;
  }
}

/**
 * 获取 WorkspaceManager 单例实例的便捷函数
 */
export function getWorkspaceManager(): WorkspaceManager {
  return WorkspaceManager.getInstance();
}
