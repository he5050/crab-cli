/**
 * Crab CLI 健康诊断 — /doctor 命令
 *
 * 20+ 项检查，输出彩色 ANSI 结果，按严重度排序。
 * 用法: runDoctor() 返回检查结果数组（供命令层渲染）。
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, accessSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// ─── 类型 ──────────────────────────────────────────────────

export type DoctorStatus = "ok" | "warn" | "fail" | "info";

export interface DoctorCheck {
  status: DoctorStatus;
  label: string;
  message: string;
  details?: string[];
}

export interface DoctorResult {
  checks: DoctorCheck[];
  summary: { ok: number; warn: number; fail: number; info: number };
}

// ─── ANSI ──────────────────────────────────────────────────

const R = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";

function colorize(text: string, color: string): string {
  return `${color}${text}${R}`;
}

// ─── 辅助函数 ──────────────────────────────────────────────

function runCommand(command: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5000,
  });
  return {
    ok: !result.error && result.status === 0,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
  };
}

function readJsonFile(filePath: string): { exists: boolean; value?: unknown; error?: string } {
  if (!existsSync(filePath)) return { exists: false };
  try {
    const content = readFileSync(filePath, "utf8");
    if (!content.trim()) return { exists: true, value: {} };
    return { exists: true, value: JSON.parse(content) };
  } catch (e) {
    return { exists: true, error: e instanceof Error ? e.message : String(e) };
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function countMcpServers(settings: unknown): number {
  if (!isRecord(settings) || !isRecord(settings.mcpServers)) return 0;
  return Object.keys(settings.mcpServers).length;
}

function hasProviderConfig(profileOrSettings: unknown): boolean {
  if (!isRecord(profileOrSettings)) return false;
  // crab-cli 使用 providers 配置
  if (isRecord(profileOrSettings.providers) && Object.keys(profileOrSettings.providers).length > 0) return true;
  // 或 apiKeys
  if (isRecord(profileOrSettings.apiKeys) && Object.keys(profileOrSettings.apiKeys).length > 0) return true;
  // 或 apiKey
  if (typeof profileOrSettings.apiKey === "string" && profileOrSettings.apiKey.trim()) return true;
  return false;
}

// ─── 检查构建 ──────────────────────────────────────────────

function addCommandCheck(checks: DoctorCheck[], command: string, args: string[], label: string): void {
  const result = runCommand(command, args);
  if (result.ok) {
    checks.push({ status: "ok", label, message: result.stdout || "可用" });
  } else {
    checks.push({
      status: "warn",
      label,
      message: "不可用或执行失败",
      details: [result.stderr].filter(Boolean) as string[],
    });
  }
}

// ─── 核心诊断 ──────────────────────────────────────────────

export function runDoctor(currentVersion?: string): DoctorResult {
  const checks: DoctorCheck[] = [];
  const crabDir = join(homedir(), ".crab");
  const projectCrabDir = join(process.cwd(), ".crab");
  const globalSettingsPath = join(crabDir, "settings.json");
  const projectSettingsPath = join(projectCrabDir, "settings.json");

  // 1. Crab CLI 版本
  checks.push({
    status: "info",
    label: "Crab CLI",
    message: `v${currentVersion || "unknown"}`,
  });

  // 2. Bun 版本
  const bunResult = runCommand("bun", ["--version"]);
  checks.push({
    status: bunResult.ok ? "ok" : "warn",
    label: "Bun",
    message: bunResult.ok ? bunResult.stdout : "未安装或不可用",
    details: bunResult.ok ? undefined : [bunResult.stderr],
  });

  // 3. Git
  addCommandCheck(checks, "git", ["--version"], "Git");

  // 4. ripgrep
  const rgResult = runCommand("rg", ["--version"]);
  if (rgResult.ok) {
    checks.push({
      status: "ok",
      label: "ripgrep",
      message: rgResult.stdout.split(/\r?\n/)[0] || "可用",
    });
  } else {
    checks.push({ status: "warn", label: "ripgrep", message: "未安装（推荐安装 rg 提升搜索性能）" });
  }

  // 5. 工作目录
  checks.push({
    status: existsSync(process.cwd()) ? "ok" : "fail",
    label: "工作目录",
    message: process.cwd(),
  });

  // 6. package.json
  const pkgPath = join(process.cwd(), "package.json");
  const pkg = readJsonFile(pkgPath);
  checks.push({
    status: pkg.exists ? (pkg.error ? "warn" : "ok") : "info",
    label: "package.json",
    message: pkg.exists ? (pkg.error ? "JSON 解析失败" : "已找到") : "当前目录无 package.json",
    details: pkg.error ? [pkgPath, pkg.error] : undefined,
  });

  // 7. 用户配置目录
  if (existsSync(crabDir)) {
    try {
      accessSync(crabDir, 5); // R_OK | W_OK
      checks.push({ status: "ok", label: "用户配置目录", message: crabDir });
    } catch {
      checks.push({ status: "fail", label: "用户配置目录", message: "无读写权限", details: [crabDir] });
    }
  } else {
    checks.push({
      status: "warn",
      label: "用户配置目录",
      message: "不存在（首次使用时会自动创建）",
      details: [crabDir],
    });
  }

  // 8. 全局 settings.json
  const globalSettings = readJsonFile(globalSettingsPath);
  checks.push({
    status: globalSettings.exists ? (globalSettings.error ? "fail" : "ok") : "warn",
    label: "全局 settings.json",
    message: globalSettings.exists ? (globalSettings.error ? "JSON 解析失败" : "可读") : "未创建",
    details: globalSettings.error ? [globalSettingsPath, globalSettings.error] : [globalSettingsPath],
  });

  // 9. 项目 settings.json
  const projectSettings = readJsonFile(projectSettingsPath);
  checks.push({
    status: projectSettings.exists ? (projectSettings.error ? "fail" : "ok") : "info",
    label: "项目 settings.json",
    message: projectSettings.exists ? (projectSettings.error ? "JSON 解析失败" : "可读") : "未配置",
    details: [projectSettingsPath],
  });

  // 10. Provider/API 配置
  const mergedSettings = globalSettings.value;
  checks.push({
    status: hasProviderConfig(mergedSettings) ? "ok" : "warn",
    label: "API Provider",
    message: hasProviderConfig(mergedSettings) ? "已配置" : "未配置 API Provider（需通过 /config 设置）",
  });

  // 11. MCP 服务
  const globalMcp = countMcpServers(globalSettings.value);
  const projectMcp = countMcpServers(projectSettings.value);
  checks.push({
    status: globalMcp + projectMcp > 0 ? "ok" : "info",
    label: "MCP 服务",
    message: `全局 ${globalMcp} 个 | 项目 ${projectMcp} 个`,
  });

  // 12. 数据库
  const dbPath = join(crabDir, "crab.db");
  checks.push({
    status: existsSync(dbPath) ? "ok" : "info",
    label: "本地数据库",
    message: existsSync(dbPath) ? `已存在 (${dbPath})` : "未创建（首次对话时自动初始化）",
  });

  // 13. 导出目录
  const exportDir = join(crabDir, "exports");
  checks.push({
    status: existsSync(exportDir) ? "ok" : "info",
    label: "导出目录",
    message: existsSync(exportDir) ? exportDir : `未创建 (${exportDir})`,
  });

  // 14. NODE_OPTIONS
  const nodeOptions = process.env.NODE_OPTIONS;
  checks.push({
    status: nodeOptions ? "warn" : "ok",
    label: "NODE_OPTIONS",
    message: nodeOptions ? "已设置（可能影响运行时行为）" : "未设置",
    details: nodeOptions ? [nodeOptions] : undefined,
  });

  // 15. 代理环境变量
  const proxyValues = [
    process.env.HTTPS_PROXY || process.env.https_proxy,
    process.env.HTTP_PROXY || process.env.http_proxy,
  ].filter((v): v is string => Boolean(v));
  checks.push({
    status: proxyValues.length > 0 ? "info" : "ok",
    label: "代理环境变量",
    message: proxyValues.length > 0 ? `已设置 ${proxyValues.length} 个` : "未设置",
    details: proxyValues.length > 0 ? proxyValues : undefined,
  });

  // 16. 临时目录
  checks.push({
    status: existsSync(tmpdir()) ? "ok" : "warn",
    label: "临时目录",
    message: tmpdir(),
  });

  // 17. 内存状态
  const memMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  checks.push({
    status: memMB > 500 ? "warn" : "ok",
    label: "内存使用",
    message: `堆内存 ${memMB} MB`,
  });

  // 排序: fail > warn > ok > info
  const order: Record<DoctorStatus, number> = { fail: 0, warn: 1, ok: 2, info: 3 };
  checks.sort((a, b) => order[a.status] - order[b.status]);

  const summary = {
    ok: checks.filter((c) => c.status === "ok").length,
    warn: checks.filter((c) => c.status === "warn").length,
    fail: checks.filter((c) => c.status === "fail").length,
    info: checks.filter((c) => c.status === "info").length,
  };

  return { checks, summary };
}

// ─── ANSI 渲染 ──────────────────────────────────────────────

function statusIcon(status: DoctorStatus): string {
  switch (status) {
    case "ok":
      return colorize("[OK]", GREEN);
    case "warn":
      return colorize("[!]", YELLOW);
    case "fail":
      return colorize("[x]", RED);
    case "info":
      return colorize("[i]", CYAN);
  }
}

/** 渲染诊断结果为 ANSI 字符串（用于 headless 输出） */
export function renderDoctorResult(result: DoctorResult): string {
  const lines: string[] = [];
  lines.push(colorize("═══ Crab CLI 诊断报告 ═══", `${BOLD}${CYAN}`));
  lines.push("");

  for (const check of result.checks) {
    lines.push(`${statusIcon(check.status)} ${check.label}: ${check.message}`);
    for (const detail of check.details ?? []) {
      lines.push(colorize(`  > ${detail}`, DIM));
    }
  }

  const { ok, warn, fail: failed, info } = result.summary;
  lines.push("");
  lines.push(
    `${colorize("总结", `${BOLD}${CYAN}`)}: ` +
      `${colorize(`✓ ${ok} 通过`, GREEN)}, ` +
      `${colorize(`⚠ ${warn} 警告`, YELLOW)}, ` +
      `${colorize(`✗ ${failed} 失败`, RED)}, ` +
      `${colorize(`ℹ ${info} 信息`, CYAN)}`,
  );

  if (failed > 0) {
    lines.push(colorize("存在阻塞性问题，请修复后再使用。", RED));
  } else if (warn > 0) {
    lines.push(colorize("存在警告，建议排查但不影响使用。", YELLOW));
  } else {
    lines.push(colorize("一切正常！ 🦀", GREEN));
  }

  return lines.join("\n");
}
