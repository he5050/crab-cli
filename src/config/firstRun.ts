/**
 * 首次运行检测 — 判断是否需要启动配置向导。
 *
 * 职责:
 *   - 检查 ~/.crab/config.json 是否存在
 *   - 检查是否已有可用的 Provider 配置
 *   - 提供首次运行标记持久化
 *
 * 模块功能:
 *   - isFirstRun: 判断是否为首次运行
 *   - markFirstRunComplete: 标记首次运行已完成
 *   - hasValidProviderConfig: 检查是否有有效的 Provider 配置
 *
 * 使用场景:
 *   - CLI 入口启动时检查是否需要启动配置向导
 *   - TUI 启动时检查是否需要引导用户配置
 *
 * 边界:
 *   1. 仅做检测和标记，不启动向导
 *   2. 环境变量 CRAB_API_KEY 存在时视为已配置
 *   3. 标记文件: ~/.crab/.first-run-complete
 */
import fs from "node:fs";
import path from "node:path";
import { getGlobalConfigPath, getGlobalCrabDir } from "./paths/paths";
import { readJsonFile } from "@/core/utilities/fileUtils";
import type { AppConfigSchema } from "@/schema/config";

const FIRST_RUN_MARKER = ".first-run-complete";

/**
 * 判断是否为首次运行。
 * 首次运行的条件:
 *   1. ~/.crab/config.json 不存在，或
 *   2. config.json 存在但没有配置任何 Provider，且没有环境变量 CRAB_API_KEY
 *   3. 且未标记首次运行已完成
 */
export async function isFirstRun(): Promise<boolean> {
  // 如果环境变量已配置 API Key，则不是首次运行
  if (process.env.CRAB_API_KEY) {
    return false;
  }

  // 检查首次运行完成标记
  const markerPath = path.join(getGlobalCrabDir(), FIRST_RUN_MARKER);
  if (fs.existsSync(markerPath)) {
    return false;
  }

  // 检查配置文件是否存在且有有效 Provider
  const hasValidConfig = await hasValidProviderConfig();
  if (hasValidConfig) {
    return false;
  }

  return true;
}

/**
 * 检查配置文件是否有有效的 Provider 配置。
 * 有效配置 = 至少一个 Provider 有 apiKey 或 baseURL。
 */
export async function hasValidProviderConfig(): Promise<boolean> {
  try {
    const configPath = getGlobalConfigPath();
    if (!fs.existsSync(configPath)) {
      return false;
    }

    const raw = await readJsonFile(configPath);
    if (!raw) {
      return false;
    }

    const config = raw as Partial<AppConfigSchema>;
    const providerConfig = config.providerConfig;
    if (!providerConfig || typeof providerConfig !== "object") {
      return false;
    }

    // 检查是否有至少一个 Provider 配置了 apiKey
    for (const provider of Object.values(providerConfig)) {
      if (provider?.apiKey) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * 标记首次运行已完成。
 * 创建 ~/.crab/.first-run-complete 标记文件。
 */
export function markFirstRunComplete(): void {
  try {
    const dir = getGlobalCrabDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const markerPath = path.join(dir, FIRST_RUN_MARKER);
    fs.writeFileSync(markerPath, JSON.stringify({ completedAt: new Date().toISOString() }), "utf8");
  } catch {
    // 标记写入失败不影响主流程
  }
}
