/**
 * 禁用内置服务管理 — 管理系统内置工具的启用/禁用状态。
 *
 * 职责:
 *   - 管理系统内置工具的启用/禁用状态
 *   - 支持项目配置和全局配置合并
 *   - 持久化到 settings.json
 *
 * 模块功能:
 *   - getDisabledBuiltInServices: 读取被禁用的内置服务列表
 *   - isBuiltInServiceEnabled: 检查某个内置服务是否启用
 *   - toggleBuiltInService: 切换内置服务的启用/禁用状态
 *
 * 使用场景:
 *   - 内置服务管理界面
 *   - 服务启用/禁用切换
 *   - 服务状态检查
 *
 * 边界:
 *   1. 持久化到 settings.json 的 disabledBuiltInServices 字段
 *   2. 优先级:项目配置 > 全局配置 > 默认配置
 *   3. 切换时写入项目级 settings.json
 *
 * 流程:
 *   1. 读取合并后的配置
 *   2. 获取/修改 disabledBuiltInServices 列表
 *   3. 保存回 settings.json
 */

import { readMergedSettings, updateSettings } from "../settings/unifiedSettings";

/** 默认禁用的内置服务列表 */
const DEFAULT_DISABLED_SERVICES: string[] = [];

/**
 * 读取被禁用的内置服务列表。
 * 优先级:项目配置 > 全局配置 > 默认配置。
 */
export function getDisabledBuiltInServices(): string[] {
  try {
    const merged = readMergedSettings();
    if (Array.isArray(merged.disabledBuiltInServices)) {
      return merged.disabledBuiltInServices;
    }

    return [...DEFAULT_DISABLED_SERVICES];
  } catch {
    return [...DEFAULT_DISABLED_SERVICES];
  }
}

/**
 * 检查某个内置服务是否启用。
 */
export function isBuiltInServiceEnabled(serviceName: string): boolean {
  return !getDisabledBuiltInServices().includes(serviceName);
}

/**
 * 切换内置服务的启用/禁用状态(写入项目级 settings.json)。
 * @returns 切换后的状态(true = 启用)
 */
export function toggleBuiltInService(serviceName: string): boolean {
  const disabled = getDisabledBuiltInServices();
  const index = disabled.indexOf(serviceName);
  let newEnabled: boolean;

  if (index !== -1) {
    disabled.splice(index, 1);
    newEnabled = true;
  } else {
    disabled.push(serviceName);
    newEnabled = false;
  }

  updateSettings("project", (settings) => {
    settings.disabledBuiltInServices = disabled;
  });

  return newEnabled;
}
