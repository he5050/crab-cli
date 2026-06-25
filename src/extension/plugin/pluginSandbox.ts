/**
 * 插件沙箱 — 强制 PluginManager 在加载前执行越权拦截。
 *
 * 校验维度:
 *   1. 路径白名单(filesystemIsolation: true 时)— 入口路径必须在 allowedPaths 之一
 *   2. 权限白名单 — metadata.permissions 必须是 permissions 数组的子集
 *
 * 关闭策略:
 *   - filesystemIsolation=false → 路径白名单跳过
 *   - permissions 未设置 / 空数组 → 拒绝任何声明了 permissions 的插件
 *   - 沙箱配置全空 → 仅做权限校验(默认最小约束)
 *
 * 与 PluginManager 协作:
 *   - PluginManager.load() 在调用 plugin.load() 之前调用 assertCanLoad
 *   - 不通过时抛 SandboxViolationError，PluginManager 将 status 标记为 "error"
 *
 * 与 PluginLoader 协作:
 *   - validatePlugin 在 verifySignature=true 时同样调用 assertCanLoad
 *   - 文件系统白名单同时校验入口路径与 pluginDir 自身
 */
import type { PluginMetadata, SandboxConfig } from "./pluginSystem";

export interface SandboxCheckInput {
  metadata: PluginMetadata;
  entryPath: string;
}

export type SandboxCheckResult = { ok: true } | { ok: false; error: string };

/**
 * 沙箱校验器。
 *
 * 注意:本类不直接执行 OS 级别隔离(network/memory/cpu)，
 * 仅做"加载前越权拦截"——拒绝任何不符合白名单的插件进入运行时。
 * OS 级别隔离(seccomp/cgroup)属于后续阶段。
 */
export class PluginSandbox {
  private config: SandboxConfig;

  constructor(config: SandboxConfig = {}) {
    this.config = config;
  }

  /**
   * 校验一个插件是否允许加载。
   * 不通过时返回 { ok: false, error }，调用方应抛错或返回 false。
   */
  assertCanLoad(input: SandboxCheckInput): SandboxCheckResult {
    // 1. 路径白名单
    if (this.config.filesystemIsolation) {
      const allowed = this.config.allowedPaths ?? [];
      if (allowed.length === 0) {
        return { error: "sandbox.filesystemIsolation=true 但未配置 allowedPaths", ok: false };
      }
      const normalized = this.normalize(input.entryPath);
      const hit = allowed.some((p) => normalized.startsWith(this.normalize(p)));
      if (!hit) {
        return { error: `entry path '${input.entryPath}' 不在 allowedPaths 白名单内`, ok: false };
      }
    }

    // 2. 权限白名单
    const requested = input.metadata.permissions ?? [];
    const granted = new Set(this.config.permissions ?? []);
    if (requested.length > 0 && granted.size === 0) {
      return {
        error: `插件 ${input.metadata.id} 请求权限 [${requested.join(", ")}] 但沙箱未授予任何权限`,
        ok: false,
      };
    }
    for (const perm of requested) {
      if (!granted.has(perm)) {
        return {
          error: `插件 ${input.metadata.id} 请求未授权权限 '${perm}'`,
          ok: false,
        };
      }
    }

    return { ok: true };
  }

  /**
   * 用于 PluginLoader 暴露白名单信息。
   */
  describe(): SandboxConfig {
    return { ...this.config };
  }

  private normalize(p: string): string {
    return p.replace(/\\/g, "/").replace(/\/+$/, "");
  }
}

/**
 * 创建沙箱实例。
 */
export function createPluginSandbox(config: SandboxConfig = {}): PluginSandbox {
  return new PluginSandbox(config);
}
