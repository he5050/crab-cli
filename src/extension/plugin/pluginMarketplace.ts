/**
 * 插件市场模块 — 维护可安装插件清单与可信源验证。
 *
 * 职责:
 *   - 定义可信插件源白名单
 *   - 描述市场插件条目与安装状态
 *   - 对下载的插件做沙箱安全检查
 *
 * 模块功能:
 *   - TRUSTED_PLUGIN_SOURCES: 可信来源枚举
 *   - MarketplacePluginEntry: 市场插件条目类型
 *   - MarketplacePluginStatus: 状态枚举
 *   - 沙箱校验联动 PluginSandbox
 */
import { PluginSandbox, type SandboxCheckResult } from "./pluginSandbox";
import type { PluginMetadata, SandboxConfig } from "./pluginSystem";

export const TRUSTED_PLUGIN_SOURCES = ["official", "verified"] as const;

export type TrustedPluginSource = (typeof TRUSTED_PLUGIN_SOURCES)[number];
export type MarketplacePluginStatus = "installable" | "review-required" | "blocked";

export interface MarketplacePluginEntry {
  id: string;
  name: string;
  version: string;
  description?: string;
  type: PluginMetadata["type"];
  main: string;
  source?: string;
  downloadUrl?: string;
  checksum?: string;
  signature?: string;
  permissions?: string[];
  capabilities?: string[];
}

export interface PluginMarketplacePolicy {
  allowedSources?: string[];
  requireTrustedSource?: boolean;
  requireChecksum?: boolean;
  requireSignature?: boolean;
  sandbox?: SandboxConfig;
}

export interface MarketplacePluginEvaluation {
  entry: MarketplacePluginEntry;
  status: MarketplacePluginStatus;
  reasons: string[];
  sandbox: SandboxCheckResult;
}

export type PluginInstallPlan =
  | {
      ok: true;
      pluginId: string;
      installMode: "sandboxed";
      sandbox: SandboxConfig;
      steps: string[];
      warnings: string[];
    }
  | {
      ok: false;
      pluginId: string;
      reasons: string[];
    };

export type PluginInstallLockResult =
  | { ok: true; lock: PluginInstallLock }
  | { ok: false; pluginId: string; reasons: string[] };

export interface PluginInstallLock {
  pluginId: string;
  version: string;
  source?: string;
  checksum?: string;
  signature?: string;
  permissions: string[];
  sandbox: SandboxConfig;
  installedAt: string;
  installMode: "sandboxed";
  evaluationStatus: Exclude<MarketplacePluginStatus, "blocked">;
  warnings: string[];
}

export function evaluateMarketplacePlugin(
  entry: MarketplacePluginEntry,
  policy: PluginMarketplacePolicy = {},
): MarketplacePluginEvaluation {
  const reasons: string[] = [];
  const trusted = isTrustedSource(entry.source, policy.allowedSources);

  if (policy.requireTrustedSource && !trusted) {
    reasons.push(`插件来源不可信: ${entry.source ?? "unknown"}`);
  }
  if (policy.requireChecksum && !entry.checksum) {
    reasons.push("缺少 checksum，不能进入自动安装路径");
  }
  if (policy.requireSignature && !entry.signature) {
    reasons.push("缺少 signature，不能进入自动安装路径");
  }

  const sandbox = new PluginSandbox(policy.sandbox ?? {}).assertCanLoad({
    entryPath: `/marketplace/${entry.id}/${entry.main}`,
    metadata: toPluginMetadata(entry),
  });
  if (!sandbox.ok) {
    reasons.push(sandbox.error);
  }

  const status: MarketplacePluginStatus =
    reasons.length > 0 ? "blocked" : trusted && entry.checksum && entry.signature ? "installable" : "review-required";

  return { entry, reasons, sandbox, status };
}

export function buildPluginMarketplaceCatalog(
  entries: MarketplacePluginEntry[],
  policy: PluginMarketplacePolicy = {},
): MarketplacePluginEvaluation[] {
  return entries
    .map((entry) => evaluateMarketplacePlugin(entry, policy))
    .toSorted((a, b) => statusRank(a.status) - statusRank(b.status) || a.entry.name.localeCompare(b.entry.name));
}

export function buildPluginInstallPlan(
  entry: MarketplacePluginEntry,
  policy: PluginMarketplacePolicy = {},
): PluginInstallPlan {
  const evaluation = evaluateMarketplacePlugin(entry, policy);
  if (evaluation.status === "blocked") {
    return { ok: false, pluginId: entry.id, reasons: evaluation.reasons };
  }

  const sandbox = policy.sandbox ?? {};
  const warnings = evaluation.status === "review-required" ? ["插件需要人工复核后才能安装。"] : [];

  return {
    installMode: "sandboxed",
    ok: true,
    pluginId: entry.id,
    sandbox,
    steps: [
      `download ${entry.downloadUrl ?? entry.id}`,
      entry.checksum ? "verify checksum" : "manual checksum review",
      entry.signature ? "verify signature" : "manual signature review",
      "apply sandbox policy",
      "register plugin",
    ],
    warnings,
  };
}

export function createPluginInstallLock(
  entry: MarketplacePluginEntry,
  policy: PluginMarketplacePolicy = {},
  installedAt = new Date().toISOString(),
): PluginInstallLockResult {
  const plan = buildPluginInstallPlan(entry, policy);
  if (!plan.ok) {
    return { ok: false, pluginId: entry.id, reasons: plan.reasons };
  }

  const evaluation = evaluateMarketplacePlugin(entry, policy);
  if (evaluation.status === "blocked") {
    return { ok: false, pluginId: entry.id, reasons: evaluation.reasons };
  }

  return {
    lock: {
      pluginId: entry.id,
      version: entry.version,
      ...(entry.source ? { source: entry.source } : {}),
      ...(entry.checksum ? { checksum: entry.checksum } : {}),
      ...(entry.signature ? { signature: entry.signature } : {}),
      permissions: entry.permissions ?? [],
      sandbox: plan.sandbox,
      installedAt,
      installMode: "sandboxed",
      evaluationStatus: evaluation.status,
      warnings: plan.warnings,
    },
    ok: true,
  };
}

function toPluginMetadata(entry: MarketplacePluginEntry): PluginMetadata {
  return {
    description: entry.description,
    id: entry.id,
    main: entry.main,
    name: entry.name,
    permissions: entry.permissions,
    source: entry.source,
    type: entry.type,
    version: entry.version,
  };
}

function isTrustedSource(source: string | undefined, allowedSources?: string[]): boolean {
  if (!source) {
    return false;
  }
  const allowed = allowedSources && allowedSources.length > 0 ? allowedSources : [...TRUSTED_PLUGIN_SOURCES];
  return allowed.includes(source);
}

function statusRank(status: MarketplacePluginStatus): number {
  if (status === "installable") {
    return 0;
  }
  if (status === "review-required") {
    return 1;
  }
  return 2;
}
