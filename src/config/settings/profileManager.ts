/**
 * Profile 管理器 — 管理多配置文件切换。
 *
 * 职责:
 *   - 列出所有可用 Profiles
 *   - 创建/删除/切换 Profile
 *   - Profile 配置隔离
 *   - Profile 配置验证
 *
 * 模块功能:
 *   - ProfileManager: Profile 管理器类
 *   - listProfiles: 列出所有 Profiles
 *   - getCurrentProfile: 获取当前 Profile 名称
 *   - switchProfile: 切换到指定 Profile
 *   - createProfile: 创建新 Profile
 *   - deleteProfile: 删除 Profile
 *   - renameProfile: 重命名 Profile
 *   - getProfileConfig: 获取 Profile 配置
 *   - saveProfileConfig: 保存 Profile 配置
 *   - getProfileManager: 获取 ProfileManager 单例
 *
 * 使用场景:
 *   - 多环境配置管理
 *   - 配置切换和隔离
 *   - Profile 备份和恢复
 *
 * 边界:
 *   1. 仅管理 Profile 文件，不处理配置加载逻辑(由 config.ts 处理)
 *   2. Profile 存储在 ~/.crab/profiles/ 目录
 *   3. 默认 Profile 名为 "default"
 *
 * 流程:
 *   1. 创建 ProfileManager 实例
 *   2. 调用管理方法操作 Profile
 *   3. 切换 Profile 时更新当前配置
 *   4. 保存配置到对应 Profile 文件
 */
import { createLogger } from "@/core/logging/logger";
import { getGlobalConfigPath, getGlobalTmpDir, getProfilesDir } from "../paths/paths";
import { readJsonFile, writeJsonFile } from "@/core/utilities/fileUtils";
import type { AppConfigSchema as AppConfigType } from "@/schema/config";
import fs from "node:fs";
import path from "node:path";

const log = createLogger("config:profile");
type LooseObject = Record<string, unknown>;

/** Profile 信息 */
export interface ProfileInfo {
  name: string;
  description?: string;
  isActive: boolean;
  createdAt?: number;
  modifiedAt?: number;
}

/** Profile 管理器 */
export class ProfileManager {
  private profilesDir: string;

  constructor() {
    this.profilesDir = getProfilesDir();
    this.ensureProfilesDir();
  }

  /** 获取 Profiles 目录路径 */
  getProfilesDir(): string {
    return this.profilesDir;
  }

  /** 确保 Profiles 目录存在 */
  private ensureProfilesDir(): void {
    if (!fs.existsSync(this.profilesDir)) {
      fs.mkdirSync(this.profilesDir, { recursive: true });
      log.debug(`创建 Profiles 目录: ${this.profilesDir}`);
    }
  }

  /** 获取 Profile 文件路径 */
  private getProfilePath(name: string): string {
    return path.join(this.profilesDir, `${name}.json`);
  }

  /** 列出所有 Profiles */
  async listProfiles(): Promise<ProfileInfo[]> {
    this.ensureProfilesDir();

    const currentProfile = await this.getCurrentProfile();
    const profiles: ProfileInfo[] = [];
    const profileNames = new Set<string>();

    try {
      const files = fs.readdirSync(this.profilesDir);

      for (const file of files) {
        if (!file.endsWith(".json")) {
          continue;
        }

        const name = file.slice(0, -5); // 去掉 .json
        if (name === "default") {
          continue;
        } // 跳过 default.json

        const profilePath = this.getProfilePath(name);

        try {
          const stats = fs.statSync(profilePath);
          const content = (await readJsonFile(profilePath)) as LooseObject | null;

          profiles.push({
            createdAt: stats.birthtimeMs,
            description: typeof content?.description === "string" ? content.description : undefined,
            isActive: name === currentProfile,
            modifiedAt: stats.mtimeMs,
            name,
          });
          profileNames.add(name);
        } catch (error) {
          log.warn(`读取 Profile 失败 (${name}): ${(error as Error).message}`);
        }
      }
    } catch (error) {
      log.error(`列出 Profiles 失败: ${(error as Error).message}`);
    }

    // 总是添加 default profile
    profiles.push({
      isActive: currentProfile === "default" || !profileNames.has(currentProfile),
      name: "default",
    });

    // 按名称排序，当前激活的排在最前面
    return profiles.toSorted((a, b) => {
      if (a.isActive) {
        return -1;
      }
      if (b.isActive) {
        return 1;
      }
      return a.name.localeCompare(b.name);
    });
  }

  /** 获取当前 Profile 名称 */
  async getCurrentProfile(): Promise<string> {
    try {
      const globalConfig = (await readJsonFile(getGlobalConfigPath())) as LooseObject | null;
      return typeof globalConfig?.profile === "string" ? globalConfig.profile : "default";
    } catch {
      return "default";
    }
  }

  /** 创建新 Profile */
  async createProfile(name: string, description?: string, baseProfile?: string): Promise<boolean> {
    // 禁止创建名为 "default" 的 profile
    if (name === "default") {
      log.error("不能创建名为 'default' 的 Profile");
      return false;
    }

    if (!this.isValidProfileName(name)) {
      log.error(`无效的 Profile 名称: ${name}`);
      return false;
    }

    const profilePath = this.getProfilePath(name);
    const isUpdate = fs.existsSync(profilePath);

    try {
      let profileConfig: Partial<AppConfigType> = {
        description,
        profile: name,
      };

      // 如果指定了基础 Profile，复制其配置
      if (baseProfile && baseProfile !== "default") {
        const basePath = this.getProfilePath(baseProfile);
        if (fs.existsSync(basePath)) {
          const baseConfig = (await readJsonFile(basePath)) as Partial<AppConfigType> | null;
          profileConfig = {
            ...baseConfig,
            ...profileConfig,
          };
        }
      }

      await writeJsonFile(profilePath, profileConfig);
      if (isUpdate) {
        log.info(`更新 Profile 成功: ${name}`);
      } else {
        log.info(`创建 Profile 成功: ${name}`);
      }
      return true;
    } catch (error) {
      log.error(`创建 Profile 失败 (${name}): ${(error as Error).message}`);
      return false;
    }
  }

  /** 删除 Profile */
  async deleteProfile(name: string): Promise<boolean> {
    if (name === "default") {
      log.error("不能删除 default Profile");
      return false;
    }

    const profilePath = this.getProfilePath(name);

    if (!fs.existsSync(profilePath)) {
      log.error(`Profile 不存在: ${name}`);
      return false;
    }

    try {
      fs.unlinkSync(profilePath);
      log.info(`删除 Profile 成功: ${name}`);

      // 如果删除的是当前激活的 profile，切换回 default
      const current = await this.getCurrentProfile();
      if (current === name) {
        await this.switchProfile("default");
      }

      return true;
    } catch (error) {
      log.error(`删除 Profile 失败 (${name}): ${(error as Error).message}`);
      return false;
    }
  }

  /** 切换到指定 Profile（原子写入：tmpfile + rename） */
  async switchProfile(name: string): Promise<boolean> {
    // 检查 profile 是否存在
    const profilePath = this.getProfilePath(name);

    // Default profile 特殊处理(可以不存在文件)
    if (name !== "default" && !fs.existsSync(profilePath)) {
      log.error(`Profile 不存在: ${name}`);
      return false;
    }

    try {
      const globalConfigPath = getGlobalConfigPath();
      const globalConfig = ((await readJsonFile(globalConfigPath)) as LooseObject | null) ?? {};

      // 更新 profile 字段
      globalConfig.profile = name;

      // 原子写入：先写临时文件，再 rename 替换
      const tmpDir = fs.mkdtempSync(path.join(getGlobalTmpDir(), "profile-switch-"));
      const tmpPath = path.join(tmpDir, "config.json");
      try {
        await writeJsonFile(tmpPath, globalConfig);
        fs.mkdirSync(path.dirname(globalConfigPath), { recursive: true });
        fs.renameSync(tmpPath, globalConfigPath);
        log.info(`切换到 Profile: ${name}`);
        return true;
      } catch (writeError) {
        // 清理临时文件
        try {
          if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        } catch {
          /* ignore cleanup failure */
        }
        throw writeError;
      } finally {
        try {
          fs.rmSync(tmpDir, { force: true, recursive: true });
        } catch {
          /* ignore */
        }
      }
    } catch (error) {
      log.error(`切换 Profile 失败 (${name}): ${(error as Error).message}`);
      return false;
    }
  }

  /** 重命名 Profile */
  async renameProfile(oldName: string, newName: string): Promise<boolean> {
    if (oldName === "default") {
      log.error("不能重命名 default Profile");
      return false;
    }

    if (!this.isValidProfileName(newName)) {
      log.error(`无效的 Profile 名称: ${newName}`);
      return false;
    }

    const oldPath = this.getProfilePath(oldName);
    const newPath = this.getProfilePath(newName);

    if (!fs.existsSync(oldPath)) {
      log.error(`Profile 不存在: ${oldName}`);
      return false;
    }

    if (fs.existsSync(newPath)) {
      log.error(`Profile 已存在: ${newName}`);
      return false;
    }

    try {
      fs.renameSync(oldPath, newPath);

      // 更新 profile 文件内的 name 字段
      const config = (await readJsonFile(newPath)) as LooseObject | null;
      if (config) {
        config.profile = newName;
        await writeJsonFile(newPath, config);
      }

      // 如果重命名的是当前激活的 profile，更新全局配置
      const current = await this.getCurrentProfile();
      if (current === oldName) {
        await this.switchProfile(newName);
      }

      log.info(`重命名 Profile: ${oldName} -> ${newName}`);
      return true;
    } catch (error) {
      log.error(`重命名 Profile 失败 (${oldName} -> ${newName}): ${(error as Error).message}`);
      return false;
    }
  }

  /** 验证 Profile 名称是否有效 */
  private isValidProfileName(name: string): boolean {
    // 只允许字母、数字、下划线、连字符
    return /^[a-zA-Z0-9_-]+$/.test(name) && name.length > 0 && name.length <= 50;
  }

  /** 获取 Profile 配置 */
  async getProfileConfig(name: string): Promise<Partial<AppConfigType> | null> {
    const profilePath = this.getProfilePath(name);

    if (!fs.existsSync(profilePath)) {
      return null;
    }

    try {
      return await readJsonFile(profilePath);
    } catch (error) {
      log.error(`读取 Profile 配置失败 (${name}): ${(error as Error).message}`);
      return null;
    }
  }

  /** 保存 Profile 配置 */
  async saveProfileConfig(name: string, config: Partial<AppConfigType>): Promise<boolean> {
    const profilePath = this.getProfilePath(name);

    try {
      // 确保 profile 字段正确
      config.profile = name;

      await writeJsonFile(profilePath, config);
      log.debug(`保存 Profile 配置: ${name}`);
      return true;
    } catch (error) {
      log.error(`保存 Profile 配置失败 (${name}): ${(error as Error).message}`);
      return false;
    }
  }
}

/** 全局 Profile 管理器实例 */
let profileManagerInstance: ProfileManager | null = null;

export function getProfileManager(): ProfileManager {
  if (!profileManagerInstance) {
    profileManagerInstance = new ProfileManager();
  }
  return profileManagerInstance;
}

/** 重置 Profile 管理器实例(测试用) */
export function resetProfileManager(): void {
  profileManagerInstance = null;
}
