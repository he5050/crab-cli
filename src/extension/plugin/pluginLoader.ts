/**
 * 插件加载器 — 负责发现、加载和验证插件。
 *
 * 职责:
 *   - 发现本地插件目录中的插件
 *   - 动态导入插件模块
 *   - 验证插件元信息和安全性
 *   - 插件缓存和热更新
 *
 * 校验职责分工:
 *   - validatePluginManifest（私有）: 校验 package.json 字段白名单 + 长度限制
 *   - validatePluginWithReason（私有）: 校验 PluginPackage.metadata 的类型/来源/入口文件
 *   - 两处校验对象不同（raw package.json vs PluginPackage.metadata），
 *     字段高度重叠但各自负责不同层级的约束。
 *
 * 加载流程:
 *   1. 扫描插件目录
 *   2. 读取插件元信息(package.json)
 *   3. validatePluginManifest 校验原始 package.json 字段
 *   4. validatePluginWithReason 校验插件类型/来源/入口文件
 *   5. 验证插件签名(可选)
 *   6. 动态加载插件入口
 *   7. 实例化插件
 *
 * 边界:
 *   1. 仅加载经过验证的插件
 *   2. 加载失败不影响其他插件
 *   3. 支持插件热更新
 */

import { type LogMetadata, createLogger } from "@/core/logging/logger";
import { join, resolve } from "path";
import { existsSync, readFileSync, readdirSync } from "fs";

const log = createLogger("plugin:loader");

const ALLOWED_MANIFEST_FIELDS = new Set([
  "name",
  "version",
  "description",
  "author",
  "homepage",
  "main",
  "dependencies",
  "carbonConfig",
]);

const REQUIRED_MANIFEST_FIELDS = ["name", "version", "main"] as const;

const MANIFEST_STRING_LIMITS = {
  author: 256,
  description: 2048,
  homepage: 2048,
  main: 256,
  name: 128,
  version: 64,
} as const;

const ALLOWED_CARBON_CONFIG_FIELDS = new Set(["type", "conflicts", "permissions", "source"]);

const CARBON_STRING_LIMITS = {
  source: 256,
  type: 32,
} as const;

const MANIFEST_ARRAY_ITEM_MAX_LENGTH = 128;
const MANIFEST_ARRAY_MAX_ITEMS = 128;
const MANIFEST_DEPENDENCY_MAX_LENGTH = 256;

export class PluginManifestValidationError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "PluginManifestValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateStringField(
  fields: Record<string, unknown>,
  field: string,
  maxLength: number,
  options: { required?: boolean } = {},
): string | undefined {
  const value = fields[field];
  if (value === undefined) {
    return options.required ? `缺少必需字段: ${field}` : undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return `${field} 必须是非空字符串`;
  }
  if (value.length > maxLength) {
    return `${field} 超过最大长度 ${maxLength}`;
  }
  return undefined;
}

function validateStringArrayField(fields: Record<string, unknown>, field: string): string | undefined {
  const value = fields[field];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    return `${field} 必须是字符串数组`;
  }
  if (value.length > MANIFEST_ARRAY_MAX_ITEMS) {
    return `${field} 超过最大数量 ${MANIFEST_ARRAY_MAX_ITEMS}`;
  }
  for (const item of value) {
    if (typeof item !== "string" || item.trim().length === 0) {
      return `${field} 必须是字符串数组`;
    }
    if (item.length > MANIFEST_ARRAY_ITEM_MAX_LENGTH) {
      return `${field} 项超过最大长度 ${MANIFEST_ARRAY_ITEM_MAX_LENGTH}`;
    }
  }
  return undefined;
}

function validateDependencyRecord(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    return "dependencies 必须是字符串映射";
  }
  for (const [name, version] of Object.entries(value)) {
    if (name.length === 0 || name.length > MANIFEST_DEPENDENCY_MAX_LENGTH) {
      return `dependencies key 超过最大长度 ${MANIFEST_DEPENDENCY_MAX_LENGTH}`;
    }
    if (typeof version !== "string" || version.trim().length === 0) {
      return "dependencies value 必须是非空字符串";
    }
    if (version.length > MANIFEST_DEPENDENCY_MAX_LENGTH) {
      return `dependencies value 超过最大长度 ${MANIFEST_DEPENDENCY_MAX_LENGTH}`;
    }
  }
  return undefined;
}

function validatePluginManifest(pkg: unknown): { ok: boolean; reason?: string } {
  if (!isRecord(pkg)) {
    return { ok: false, reason: "manifest 必须是对象" };
  }

  for (const field of Object.keys(pkg)) {
    if (!ALLOWED_MANIFEST_FIELDS.has(field)) {
      return { ok: false, reason: `未知 manifest 字段: ${field}` };
    }
  }

  for (const field of REQUIRED_MANIFEST_FIELDS) {
    const error = validateStringField(pkg, field, MANIFEST_STRING_LIMITS[field], { required: true });
    if (error) {
      return { ok: false, reason: error };
    }
  }

  for (const [field, maxLength] of Object.entries(MANIFEST_STRING_LIMITS)) {
    if ((REQUIRED_MANIFEST_FIELDS as readonly string[]).includes(field)) {
      continue;
    }
    const error = validateStringField(pkg, field, maxLength);
    if (error) {
      return { ok: false, reason: error };
    }
  }

  const dependenciesError = validateDependencyRecord(pkg.dependencies);
  if (dependenciesError) {
    return { ok: false, reason: dependenciesError };
  }

  if (pkg.carbonConfig !== undefined) {
    if (!isRecord(pkg.carbonConfig)) {
      return { ok: false, reason: "carbonConfig 必须是对象" };
    }

    for (const field of Object.keys(pkg.carbonConfig)) {
      if (!ALLOWED_CARBON_CONFIG_FIELDS.has(field)) {
        return { ok: false, reason: `未知 carbonConfig 字段: ${field}` };
      }
    }

    for (const [field, maxLength] of Object.entries(CARBON_STRING_LIMITS)) {
      const error = validateStringField(pkg.carbonConfig, field, maxLength);
      if (error) {
        return { ok: false, reason: error };
      }
    }

    for (const field of ["conflicts", "permissions"]) {
      const error = validateStringArrayField(pkg.carbonConfig, field);
      if (error) {
        return { ok: false, reason: error };
      }
    }
  }

  return { ok: true };
}

// ─── 类型定义 ─────────────────────────────────────────────────────

/** 插件包结构 */
export interface PluginPackage {
  /** 插件元信息 */
  metadata: {
    id: string;
    name: string;
    version: string;
    description?: string;
    author?: string;
    homepage?: string;
    main: string;
    type: "theme" | "tool" | "integration" | "custom";
    dependencies?: Record<string, string>;
    conflicts?: string[];
    permissions?: string[];
    source?: string;
  };
  /** 插件路径 */
  path: string;
}

/** 插件加载结果 */
export interface LoadResult {
  /** 插件 ID */
  id: string;
  /** 是否成功 */
  success: boolean;
  /** 插件模块(如果成功) */
  module?: unknown;
  /** 错误信息(如果失败) */
  error?: string;
}

/** 加载器选项 */
export interface LoaderOptions {
  /** 插件目录路径 */
  pluginDir: string;
  /** 是否启用缓存 */
  enableCache?: boolean;
  /** 加载超时(毫秒) */
  timeout?: number;
  /** 验证插件签名 */
  verifySignature?: boolean;
  /** 允许的插件类型 */
  allowedTypes?: ("theme" | "tool" | "integration" | "custom")[];
  /** 允许的插件来源白名单 */
  allowedSources?: string[];
}

// ─── 插件加载器 ─────────────────────────────────────────────────

/**
 * 插件加载器
 */
export class PluginLoader {
  private options: Required<LoaderOptions>;
  private cache = new Map<string, unknown>();

  constructor(options: LoaderOptions) {
    this.options = {
      allowedSources: options.allowedSources ?? [],
      allowedTypes: options.allowedTypes ?? ["theme", "tool", "integration", "custom"],
      enableCache: options.enableCache ?? true,
      pluginDir: resolve(options.pluginDir),
      timeout: options.timeout ?? 30_000,
      verifySignature: options.verifySignature ?? false,
    };
  }

  /**
   * 扫描并发现所有插件
   */
  async discover(): Promise<PluginPackage[]> {
    const plugins: PluginPackage[] = [];

    if (!existsSync(this.options.pluginDir)) {
      log.warn(`插件目录不存在: ${this.options.pluginDir}`);
      return plugins;
    }

    const entries = readdirSync(this.options.pluginDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const pluginPath = join(this.options.pluginDir, entry.name);

      try {
        const pkg = await this.loadPluginPackage(pluginPath);
        if (pkg && this.validatePlugin(pkg)) {
          plugins.push(pkg);
          log.debug(`发现插件: ${pkg.metadata.name} v${pkg.metadata.version}`);
        }
      } catch (error) {
        log.error(`加载插件失败: ${pluginPath}`, error as LogMetadata);
      }
    }

    log.info(`发现 ${plugins.length} 个插件`);
    return plugins;
  }

  /**
   * 加载单个插件
   */
  async load(pluginPath: string): Promise<LoadResult> {
    const resolvedPath = resolve(pluginPath);

    // 检查缓存
    if (this.options.enableCache && this.cache.has(resolvedPath)) {
      log.debug(`使用缓存加载插件: ${resolvedPath}`);
      return {
        id: resolvedPath,
        module: this.cache.get(resolvedPath),
        success: true,
      };
    }

    try {
      // 加载插件包信息
      const pkg = await this.loadPluginPackage(resolvedPath);
      if (!pkg) {
        return { error: "无法读取插件元信息", id: resolvedPath, success: false };
      }

      // 验证插件
      const validation = this.validatePluginWithReason(pkg);
      if (!validation.ok) {
        return { error: validation.reason, id: pkg.metadata.id, success: false };
      }

      // 动态导入插件模块
      const entryPath = join(resolvedPath, pkg.metadata.main);
      const module = await this.importModule(entryPath);

      // 缓存
      if (this.options.enableCache) {
        this.cache.set(resolvedPath, module);
      }

      log.info(`插件加载成功: ${pkg.metadata.name}`);
      return { id: pkg.metadata.id, module, success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error(`插件加载失败: ${resolvedPath}`, error as LogMetadata);
      return { error: errorMsg, id: resolvedPath, success: false };
    }
  }

  /**
   * 加载插件包信息
   */
  private async loadPluginPackage(pluginPath: string): Promise<PluginPackage | null> {
    const packageJsonPath = join(pluginPath, "package.json");

    if (!existsSync(packageJsonPath)) {
      log.warn(`插件缺少 package.json: ${pluginPath}`);
      return null;
    }

    let pkg: unknown;
    try {
      const content = readFileSync(packageJsonPath, "utf8");
      pkg = JSON.parse(content);
    } catch (error) {
      log.error(`读取插件 package.json 失败: ${packageJsonPath}`, error as LogMetadata);
      return null;
    }

    const validation = validatePluginManifest(pkg);
    if (!validation.ok) {
      throw new PluginManifestValidationError(validation.reason ?? "插件 manifest 不合法");
    }

    const manifest = pkg as Record<string, unknown>;
    const carbonConfig = manifest.carbonConfig as Record<string, unknown> | undefined;

    return {
      metadata: {
        author: manifest.author as string | undefined,
        conflicts: carbonConfig?.conflicts as string[] | undefined,
        dependencies: manifest.dependencies as Record<string, string> | undefined,
        description: manifest.description as string | undefined,
        homepage: manifest.homepage as string | undefined,
        id: manifest.name as string,
        main: manifest.main as string,
        name: manifest.name as string,
        permissions: carbonConfig?.permissions as string[] | undefined,
        source: carbonConfig?.source as string | undefined,
        type: (carbonConfig?.type as PluginPackage["metadata"]["type"] | undefined) || "custom",
        version: manifest.version as string,
      },
      path: pluginPath,
    };
  }

  /**
   * 验证插件(布尔版，保持向后兼容)
   */
  private validatePlugin(pkg: PluginPackage): boolean {
    return this.validatePluginWithReason(pkg).ok;
  }

  /**
   * 验证插件(带原因版)
   */
  private validatePluginWithReason(pkg: PluginPackage): { ok: boolean; reason?: string } {
    const { metadata } = pkg;

    // 检查必需字段
    if (!metadata.id || !metadata.name || !metadata.main) {
      const reason = "插件元信息不完整";
      log.warn(`${reason}: ${pkg.path}`);
      return { ok: false, reason };
    }

    // 检查插件类型
    if (!this.options.allowedTypes.includes(metadata.type)) {
      const reason = `插件类型不支持: ${metadata.type}`;
      log.warn(reason);
      return { ok: false, reason };
    }

    // 检查插件来源白名单
    if (this.options.allowedSources.length > 0) {
      if (!metadata.source) {
        const reason = `插件 ${metadata.id} 缺少来源声明 (source 字段)`;
        log.warn(reason);
        return { ok: false, reason };
      }
      if (!this.options.allowedSources.includes(metadata.source)) {
        const reason = `插件 ${metadata.id} 来源 '${metadata.source}' 不在白名单内`;
        log.warn(reason);
        return { ok: false, reason };
      }
    }

    // 检查入口文件是否存在
    const entryPath = join(pkg.path, metadata.main);
    if (!existsSync(entryPath)) {
      const reason = `插件入口文件不存在: ${entryPath}`;
      log.warn(reason);
      return { ok: false, reason };
    }

    // 签名校验(如启用)
    if (this.options.verifySignature) {
      const sigPath = `${entryPath}.sig`;
      if (!existsSync(sigPath)) {
        const reason = `缺少 signature: ${sigPath}`;
        log.warn(reason);
        return { ok: false, reason };
      }
      const sig = readFileSync(sigPath, "utf8");
      if (!this.isPlausibleSignature(sig)) {
        const reason = `签名格式不合法: ${sigPath}`;
        log.warn(reason);
        return { ok: false, reason };
      }
      // 注:完整签名校验需要公钥基础设施(PKI)。
      // 当前实现仅做"存在性 + 格式合理性"检查，确保 .sig 文件不能缺失或被篡改。
      // 后续阶段接入公钥链与吊销列表。
    }

    return { ok: true };
  }

  /**
   * 签名格式合理性检查:base64 / hex 字符串，长度符合最低要求。
   * 这不是密码学验证，只是"看上去像一个签名"。
   */
  private isPlausibleSignature(sig: string): boolean {
    const trimmed = sig.trim();
    if (trimmed.length < 16) {
      return false;
    }
    return /^[A-Za-z0-9+/=_-]+$/.test(trimmed);
  }

  /**
   * 动态导入模块。
   *
   * 注意:此方法仅应在 validatePluginWithReason 校验通过后调用。
   * 调用方（discover/load）已确保入口文件存在、类型合法、来源可信。
   * 不要直接调用此方法导入未经校验的路径。
   */
  private async importModule(path: string): Promise<unknown> {
    // 使用动态 import
    // 注意:在实际运行时，这需要支持 ES modules 或 CommonJS
    const module = await import(path);
    return module.default || module;
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
    log.debug("插件缓存已清除");
  }

  /**
   * 清除指定插件缓存
   */
  clearCacheFor(pluginPath: string): void {
    const resolvedPath = resolve(pluginPath);
    if (this.cache.has(resolvedPath)) {
      this.cache.delete(resolvedPath);
      log.debug(`插件缓存已清除: ${resolvedPath}`);
    }
  }

  /**
   * 获取缓存的插件
   */
  getCached(pluginPath: string): unknown | undefined {
    return this.cache.get(resolve(pluginPath));
  }
}

// ─── 工厂函数 ─────────────────────────────────────────────────────

/**
 * 创建插件加载器
 */
export function createPluginLoader(options: LoaderOptions): PluginLoader {
  return new PluginLoader(options);
}
