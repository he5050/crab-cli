/**
 * 禁用技能管理 — 管理技能的启用/禁用状态。
 *
 * 职责:
 *   - 管理技能的启用/禁用状态
 *   - 持久化到 settings.json
 *   - 提供技能状态查询和切换
 *
 * 模块功能:
 *   - getDisabledSkills: 读取被禁用的技能列表
 *   - isSkillEnabled: 检查某个技能是否启用
 *   - toggleSkill: 切换技能的启用/禁用状态
 *
 * 使用场景:
 *   - 技能管理界面
 *   - 技能启用/禁用切换
 *   - 技能状态检查
 *
 * 边界:
 *   1. 持久化到 settings.json 的 disabledSkills 字段
 *   2. 使用 project 作用域
 *   3. 返回 true 表示启用，false 表示禁用
 *
 * 流程:
 *   1. 读取 settings.json
 *   2. 获取/修改 disabledSkills 列表
 *   3. 保存回 settings.json
 */

import { readSettings, updateSettings } from "../settings/unifiedSettings";

/**
 * 读取被禁用的技能列表。
 */
export function getDisabledSkills(): string[] {
  try {
    const settings = readSettings("project");
    if (Array.isArray(settings.disabledSkills)) {
      return settings.disabledSkills;
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * 检查某个技能是否启用。
 */
export function isSkillEnabled(skillId: string): boolean {
  return !getDisabledSkills().includes(skillId);
}

/**
 * 切换技能的启用/禁用状态。
 * @returns 切换后的状态(true = 启用)
 */
export function toggleSkill(skillId: string): boolean {
  const disabled = getDisabledSkills();
  const index = disabled.indexOf(skillId);
  let newEnabled: boolean;

  if (index !== -1) {
    disabled.splice(index, 1);
    newEnabled = true;
  } else {
    disabled.push(skillId);
    newEnabled = false;
  }

  updateSettings("project", (settings) => {
    settings.disabledSkills = disabled;
  });

  return newEnabled;
}
