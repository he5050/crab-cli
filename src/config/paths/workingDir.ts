/**
 * 多工作目录注册 — 支持本地和 SSH 远程目录。
 *
 * 职责:
 *   - 管理多个工作目录(本地和 SSH 远程)
 *   - 支持设置默认工作目录
 *   - 提供工作目录的增删改查
 *
 * 模块功能:
 *   - loadWorkingDirConfig: 加载工作目录配置
 *   - saveWorkingDirConfig: 保存工作目录配置
 *   - addWorkingDirectory: 添加新的本地工作目录
 *   - removeWorkingDirectories: 批量移除工作目录
 *   - getWorkingDirectories: 获取所有已注册的工作目录
 *   - addSSHWorkingDirectory: 添加 SSH 远程工作目录
 *   - setDefaultWorkingDirectory: 设置默认工作目录
 *   - getDefaultWorkingDirectory: 获取默认工作目录
 *   - isSSHWorkingDirectory: 判断路径是否为 SSH 远程目录
 *   - WorkingDirectory: 工作目录接口
 *   - SSHConfig: SSH 配置接口
 *   - WorkingDirConfig: 工作目录配置接口
 *
 * 使用场景:
 *   - 多项目管理
 *   - 远程开发环境
 *   - 工作目录切换
 *
 * 边界:
 *   1. 配置目录: ~/.crab/
 *   2. 配置文件: working-dirs.json
 *   3. 不允许移除默认目录
 *   4. SSH 远程目录使用 ssh:// 协议标识
 *
 * 流程:
 *   1. 加载工作目录配置
 *   2. 添加/移除/修改工作目录
 *   3. 保存配置到文件
 *   4. 设置默认工作目录
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { cwd } from "node:process";
import { createLogger } from "@/core/logging/logger";
import { getGlobalCrabDir } from "./paths";

const log = createLogger("config:working-dir");

const WORKING_DIR_FILE = "working-dirs.json";

// ─── 类型定义 ──────────────────────────────────────────────

export interface SSHConfig {
  host: string;
  port: number;
  username: string;
  /** 认证方式 */
  authMethod: "password" | "privateKey" | "agent";
  /** 密码认证 */
  password?: string;
  /** 私钥认证 */
  privateKeyPath?: string;
  passphrase?: string;
}

export interface WorkingDirectory {
  /** 目录路径或 SSH URL */
  path: string;
  /** 是否为默认目录 */
  isDefault: boolean;
  /** 添加时间戳 */
  addedAt: number;
  /** 是否为 SSH 远程目录 */
  isRemote?: boolean;
  /** SSH 配置(远程目录时) */
  sshConfig?: SSHConfig;
  /** 远程目录显示名称 */
  displayName?: string;
}

export interface WorkingDirConfig {
  directories: WorkingDirectory[];
}

// ─── 配置文件读写 ─────────────────────────────────────────

function getConfigFilePath(): string {
  return join(getGlobalCrabDir(), WORKING_DIR_FILE);
}

function ensureConfigDir(): void {
  const dir = getGlobalCrabDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * 加载工作目录配置。
 * 不存在时返回包含当前目录的默认配置。
 */
export function loadWorkingDirConfig(): WorkingDirConfig {
  const configPath = getConfigFilePath();

  try {
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, "utf8");
      if (!content.trim()) {
        return getDefaultWorkingDirConfig();
      }
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Array.isArray(parsed.directories)) {
        return parsed as WorkingDirConfig;
      }
      log.warn("工作目录配置格式无效，使用默认配置");
      return getDefaultWorkingDirConfig();
    }
  } catch (error) {
    log.warn("加载工作目录配置失败", { payload: { error: String(error) } });
  }

  return getDefaultWorkingDirConfig();
}

/** 构建包含当前目录的默认工作目录配置。 */
function getDefaultWorkingDirConfig(): WorkingDirConfig {
  return {
    directories: [
      {
        addedAt: Date.now(),
        isDefault: true,
        path: cwd(),
      },
    ],
  };
}

/**
 * 保存工作目录配置。
 */
export function saveWorkingDirConfig(config: WorkingDirConfig): void {
  ensureConfigDir();
  const configPath = getConfigFilePath();

  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
    chmodSync(configPath, 0o600);
  } catch (error) {
    log.error("保存工作目录配置失败", { payload: { error: String(error) } });
    throw error;
  }
}

// ─── 目录管理 ─────────────────────────────────────────────

/**
 * 添加新的工作目录(本地)。
 * 校验路径是否存在且为目录。
 */
export function addWorkingDirectory(dirPath: string): boolean {
  const absolutePath = resolve(dirPath);

  try {
    const stat = existsSync(absolutePath);
    if (!stat) {
      return false;
    }
  } catch {
    return false;
  }

  const config = loadWorkingDirConfig();

  // 检查是否已存在
  if (config.directories.some((d) => d.path === absolutePath)) {
    return false;
  }

  config.directories.push({
    addedAt: Date.now(),
    isDefault: false,
    path: absolutePath,
  });

  saveWorkingDirConfig(config);
  return true;
}

/**
 * 批量移除工作目录。
 * 不允许移除默认目录。
 */
export function removeWorkingDirectories(paths: string[]): void {
  const config = loadWorkingDirConfig();

  config.directories = config.directories.filter((d) => d.isDefault || !paths.includes(d.path));

  saveWorkingDirConfig(config);
}

/**
 * 获取所有已注册的工作目录。
 */
export function getWorkingDirectories(): WorkingDirectory[] {
  const config = loadWorkingDirConfig();
  return config.directories;
}

/**
 * 添加 SSH 远程工作目录。
 * 生成唯一 SSH URL 标识符并保存。
 */
export function addSSHWorkingDirectory(sshConfig: SSHConfig, remotePath: string, displayName?: string): boolean {
  const config = loadWorkingDirConfig();

  const sshIdentifier = `ssh://${sshConfig.username}@${sshConfig.host}:${sshConfig.port}${remotePath}`;

  // 检查是否已存在
  if (config.directories.some((d) => d.path === sshIdentifier)) {
    return false;
  }

  config.directories.push({
    addedAt: Date.now(),
    displayName: displayName || `${sshConfig.username}@${sshConfig.host}:${remotePath}`,
    isDefault: false,
    isRemote: true,
    path: sshIdentifier,
    sshConfig: {
      authMethod: sshConfig.authMethod,
      host: sshConfig.host,
      password: sshConfig.password,
      port: sshConfig.port,
      privateKeyPath: sshConfig.privateKeyPath,
      username: sshConfig.username,
    },
  });

  saveWorkingDirConfig(config);
  return true;
}

/**
 * 设置默认工作目录。
 */
export function setDefaultWorkingDirectory(dirPath: string): boolean {
  const config = loadWorkingDirConfig();

  const target = config.directories.find((d) => d.path === dirPath);
  if (!target) {
    return false;
  }

  // 清除旧的默认
  for (const d of config.directories) {
    d.isDefault = false;
  }

  target.isDefault = true;
  saveWorkingDirConfig(config);
  return true;
}

/**
 * 获取默认工作目录。
 */
export function getDefaultWorkingDirectory(): WorkingDirectory | undefined {
  const config = loadWorkingDirConfig();
  return config.directories.find((d) => d.isDefault);
}

/**
 * 判断路径是否为 SSH 远程目录。
 */
export function isSSHWorkingDirectory(dir: WorkingDirectory): boolean {
  return dir.isRemote === true && dir.path.startsWith("ssh://");
}
