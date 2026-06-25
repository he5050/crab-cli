/**
 * 版本信息。
 *
 * 职责:
 *   - 提供 crab-cli 版本号
 *   - 自动从 package.json 读取，避免手动更新
 *   - 提供应用名称常量
 *
 * 模块功能:
 *   - VERSION: 当前版本号
 *   - NAME: 应用名称
 *   - loadVersion: 加载版本号(内部函数)
 *
 * 使用场景:
 *   - 显示版本信息
 *   - 更新检查
 *   - 日志标识
 *
 * 边界:
 *   1. 从 package.json 读取版本
 *   2. 读取失败时返回 "0.0.0"
 *   3. 应用名称为固定常量
 *
 * 流程:
 *   1. 模块加载时读取 package.json
 *   2. 解析 version 字段
 *   3. 导出 VERSION 和 NAME 常量
 */
import { readFileSync } from "node:fs";

declare const __CRAB_CLI_VERSION__: string | undefined;

function loadVersion(): string {
  if (typeof __CRAB_CLI_VERSION__ !== "undefined" && __CRAB_CLI_VERSION__) {
    return __CRAB_CLI_VERSION__;
  }
  try {
    const pkgPath = new URL("../../package.json", import.meta.url);
    const content = readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(content);
    return pkg.version || "0.0.0";
  } catch (error) {
    console.debug(`[VERSION] 加载版本失败: ${error instanceof Error ? error.message : String(error)}`);
    return "0.0.0";
  }
}

export const VERSION = loadVersion();
export const NAME = "crab-cli";
