/**
 * Command 类型 — 模块类型统一出入口。
 *
 * 所有外部模块应通过 `@command/type` 引入 command 模块的类型定义。
 * 值导出请使用 `@command`（index.ts）。
 */

import type { RequestMethod, SingleProviderConfig } from "@/schema/config";

// ─── 配置导入 ──────────────────────────────────────────
export interface ImportOptions {
  /** 是否强制覆盖（跳过确认提示） */
  force?: boolean;
  /** 是否与现有配置合并（否则覆盖） */
  merge?: boolean;
}

// ─── 配置导出 ──────────────────────────────────────────
export interface ExportOptions {
  /** 输出文件路径，不传则输出到 stdout */
  output?: string;
  /** 是否脱敏（移除 API Key 等敏感字段） */
  sanitize?: boolean;
  /** JSON 格式: "pretty"（美化）或 "json"（紧凑） */
  format?: "json" | "pretty";
}

// ─── Provider 测试 ─────────────────────────────────────
export interface TestResult {
  providerId: string;
  status: "healthy" | "unhealthy" | "unknown";
  latencyMs?: number;
  message?: string;
}

// ─── Provider 描述 ─────────────────────────────────────
/** setup 命令中的 Provider 选项描述 */
export interface ProviderOption {
  /** Provider 唯一标识 */
  id: string;
  /** Provider 显示名称 */
  name: string;
  /** 默认模型 ID */
  defaultModel: string;
  /** API 请求方法 */
  method: RequestMethod;
  /** 模型配置（apiKey / baseURL 等）— 预留扩展，当前未使用 */
  config?: Partial<SingleProviderConfig>;
}
