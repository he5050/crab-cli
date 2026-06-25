/**
 * 配置管理器 — 提供高级配置操作接口。
 *
 * 职责:
 *   - Profile 管理(创建、删除、切换、列出)
 *   - 配置备份与恢复
 *   - 配置导入导出
 *
 * 模块功能:
 *   - listProfiles: 列出所有 Profiles
 *   - getCurrentProfile: 获取当前 Profile 名称
 *   - switchProfile: 切换到指定 Profile
 *   - createProfile: 创建新 Profile
 *   - deleteProfile: 删除 Profile
 *   - renameProfile: 重命名 Profile
 *   - copyProfile: 复制 Profile
 *   - exportProfile: 导出 Profile 到文件
 *   - importProfile: 从文件导入 Profile
 *   - backupConfig: 备份当前配置
 *   - resetConfig: 重置配置为默认
 *
 * 使用场景:
 *   - CLI 配置管理命令
 *   - Profile 切换和备份
 *   - 配置导入导出
 *
 * 边界:
 *   1. 基于 profile-manager 和 config 模块的封装
 *   2. 禁止创建名为 "default" 的 profile
 *   3. 切换 Profile 后自动重新加载配置
 *
 * 流程:
 *   1. 调用配置管理函数
 *   2. 操作 Profile 或配置
 *   3. 必要时清除配置缓存
 *   4. 记录操作日志
 */
import { type ProfileInfo, getProfileManager } from "./profileManager";
import { DEFAULT_CONFIG, loadConfig, resetConfigCache, saveConfig } from "../loader/config";
import { getGlobalConfigPath, getDataDir } from "../paths/paths";
import { readJsonFile, writeJsonFile } from "@/core/utilities/fileUtils";
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("config:manager");
type LooseObject = Record<string, unknown>;

/** 列出所有 Profiles */
export async function listProfiles(): Promise<(ProfileInfo & { active: boolean })[]> {
  const manager = getProfileManager();
  const profiles = await manager.listProfiles();
  return profiles.map((p) => ({
    ...p,
    active: p.isActive,
  }));
}

/** 获取当前 Profile 名称 */
export async function getCurrentProfile(): Promise<string> {
  const manager = getProfileManager();
  return manager.getCurrentProfile();
}

export async function getActiveProfile(): Promise<string> {
  return getCurrentProfile();
}

/** 切换到指定 Profile */
export async function switchProfile(name: string): Promise<boolean> {
  const manager = getProfileManager();

  // 1. 切换 Profile
  const success = await manager.switchProfile(name);
  if (!success) {
    return false;
  }

  // 2. 清除配置缓存，强制重新加载
  resetConfigCache();

  // 3. 重新加载配置以应用新的 Profile
  try {
    await loadConfig();
    log.info(`已切换到 Profile: ${name}，配置已重新加载`);
    return true;
  } catch (error) {
    log.error(`切换 Profile 后重新加载配置失败: ${(error as Error).message}`);
    return false;
  }
}

/** 创建新 Profile */
export async function createProfile(name: string, description?: string): Promise<boolean> {
  // 禁止创建名为 "default" 的 profile
  if (name === "default") {
    return false;
  }

  const manager = getProfileManager();

  // 获取当前配置作为基础
  const currentConfig = await loadConfig();

  // 创建 Profile(如果已存在，则直接更新配置)
  const success = await manager.createProfile(name, description);
  if (!success) {
    return false;
  }

  // 保存当前配置到新 Profile
  const profileConfig = {
    agents: currentConfig.agents,
    defaultProvider: currentConfig.defaultProvider,
    description,
    maxSpawnDepth: currentConfig.maxSpawnDepth,
    permissions: currentConfig.permissions,
    providerConfig: currentConfig.providerConfig,
    proxy: currentConfig.proxy,
    theme: currentConfig.theme,
  };

  await manager.saveProfileConfig(name, profileConfig);
  log.info(`已创建 Profile: ${name}`);
  return true;
}

/** 删除 Profile */
export async function deleteProfile(name: string): Promise<boolean> {
  const manager = getProfileManager();
  return manager.deleteProfile(name);
}

/** 重命名 Profile */
export async function renameProfile(oldName: string, newName: string): Promise<boolean> {
  const manager = getProfileManager();
  return manager.renameProfile(oldName, newName);
}

/** 复制 Profile */
export async function copyProfile(sourceName: string, targetName: string, description?: string): Promise<boolean> {
  const manager = getProfileManager();

  // 获取源 Profile 配置
  const sourceConfig = await manager.getProfileConfig(sourceName);
  if (!sourceConfig) {
    log.error(`源 Profile 不存在: ${sourceName}`);
    return false;
  }

  // 创建新 Profile
  const success = await manager.createProfile(targetName, description);
  if (!success) {
    return false;
  }

  // 复制配置
  const newConfig = {
    ...sourceConfig,
    description: description || sourceConfig.description,
    profile: targetName,
  };

  await manager.saveProfileConfig(targetName, newConfig);
  log.info(`已复制 Profile: ${sourceName} -> ${targetName}`);
  return true;
}

/** 导出 Profile 到文件 */
export async function exportProfile(name: string, filePath: string): Promise<boolean> {
  const manager = getProfileManager();

  const config = await manager.getProfileConfig(name);
  if (!config) {
    log.error(`Profile 不存在: ${name}`);
    return false;
  }

  try {
    await writeJsonFile(filePath, config);
    log.info(`已导出 Profile: ${name} -> ${filePath}`);
    return true;
  } catch (error) {
    log.error(`导出 Profile 失败: ${(error as Error).message}`);
    return false;
  }
}

/** 从文件导入 Profile */
export async function importProfile(filePath: string, name?: string): Promise<boolean> {
  const manager = getProfileManager();

  try {
    const config = (await readJsonFile(filePath)) as LooseObject | null;
    if (!config) {
      log.error(`无法读取文件: ${filePath}`);
      return false;
    }

    // 使用文件中的 profile 名称或指定的名称
    const profileName = name || (typeof config.profile === "string" ? config.profile : "imported");

    // 创建 Profile
    const success = await manager.createProfile(
      profileName,
      typeof config.description === "string" ? config.description : undefined,
    );
    if (!success) {
      return false;
    }

    // 保存配置
    await manager.saveProfileConfig(profileName, config as Record<string, unknown>);
    log.info(`已导入 Profile: ${profileName} <- ${filePath}`);
    return true;
  } catch (error) {
    log.error(`导入 Profile 失败: ${(error as Error).message}`);
    return false;
  }
}

/** 备份当前配置到专用备份目录 */
export async function backupConfig(label?: string): Promise<string | null> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupName = label ? `${label}-${timestamp}` : `backup-${timestamp}`;
  const backupFileName = `${backupName}.json`;

  try {
    const globalPath = getGlobalConfigPath();
    const backupsDir = join(getDataDir(), "backups");

    if (!existsSync(backupsDir)) {
      mkdirSync(backupsDir, { recursive: true });
    }

    const backupPath = join(backupsDir, backupFileName);
    copyFileSync(globalPath, backupPath);
    log.info(`已备份配置: ${backupPath}`);
    return backupPath;
  } catch (error) {
    log.error(`备份配置失败: ${(error as Error).message}`);
    return null;
  }
}

/** 重置配置为默认 */
export async function resetConfig(): Promise<boolean> {
  try {
    await saveConfig(DEFAULT_CONFIG);
    resetConfigCache();
    log.info("配置已重置为默认值");
    return true;
  } catch (error) {
    log.error(`重置配置失败: ${(error as Error).message}`);
    return false;
  }
}
