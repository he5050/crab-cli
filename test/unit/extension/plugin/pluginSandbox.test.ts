/**
 * 插件沙箱与签名校验单元测试。
 *
 * 覆盖:
 *   - PluginSandbox 路径白名单(filesystemIsolation)
 *   - PluginSandbox 权限白名单
 *   - PluginSandbox 关闭时直通
 *   - PluginManager.load() 在 sandbox 开启时拦截越权插件
 *   - PluginLoader.validatePlugin() 在 verifySignature=true 时拒绝缺签名/坏签名
 *   - 失败用例(Step 1 Bug 修复复现):当前 sdbx: true 也会放行越权插件 → 修复后必须拒绝
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BasePlugin,
  type PluginInterface,
  type PluginMetadata,
  createPluginLoader,
  createPluginManager,
  createPluginSandbox,
} from "@/extension/plugin/index";

class FakePlugin extends BasePlugin {
  constructor(metadata: PluginMetadata) {
    super(metadata);
  }
  async load(): Promise<void> {
    this.setStatus("loaded");
  }
  async unload(): Promise<void> {
    this.setStatus("unloaded");
  }
}

function makePlugin(perms: string[] = []): PluginInterface {
  return new FakePlugin({
    id: "fake",
    main: "index.js",
    name: "Fake",
    permissions: perms,
    type: "tool",
    version: "0.0.1",
  });
}

function writePluginPackage(dir: string, content: Record<string, unknown>): void {
  mkdirSync(dir, { recursive: true });
  // PluginLoader 从 carbonConfig.type 读取插件类型，默认 "custom"
  // 强制设为 "tool" 以匹配测试的 allowedTypes=["tool"]
  const pkg = {
    carbonConfig: { type: "tool" },
    ...content,
  };
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
  // 写入一个最小的可被 import 的入口文件
  writeFileSync(join(dir, (content.main as string) ?? "index.js"), "export default {};\n");
}

describe("PluginSandbox", () => {
  describe("filesystemIsolation", () => {
    it("条目路径外 allowedPaths 是已拒绝", () => {
      const sb = createPluginSandbox({
        allowedPaths: ["/var/lib/crab/plugins"],
        filesystemIsolation: true,
      });
      const result = sb.assertCanLoad({
        entryPath: "/etc/passwd",
        metadata: makePlugin().getMetadata(),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("path");
      }
    });

    it("条目路径内 allowedPaths 是已允许", () => {
      const sb = createPluginSandbox({
        allowedPaths: ["/var/lib/crab/plugins"],
        filesystemIsolation: true,
      });
      const result = sb.assertCanLoad({
        entryPath: "/var/lib/crab/plugins/foo/index.js",
        metadata: makePlugin().getMetadata(),
      });
      expect(result.ok).toBe(true);
    });

    it("sandbox off → path isolation skipped", () => {
      const sb = createPluginSandbox({});
      const result = sb.assertCanLoad({
        entryPath: "/etc/passwd",
        metadata: makePlugin().getMetadata(),
      });
      expect(result.ok).toBe(true);
    });
  });

  describe("权限白名单", () => {
    it("plugin requesting permission outside whitelist is rejected", () => {
      const sb = createPluginSandbox({
        permissions: ["read:files"],
      });
      const result = sb.assertCanLoad({
        entryPath: "/safe/index.js",
        metadata: makePlugin(["read:files", "exec:shell"]).getMetadata(),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("exec:shell");
      }
    });

    it("plugin requesting only whitelisted permissions is allowed", () => {
      const sb = createPluginSandbox({
        permissions: ["read:files", "write:files"],
      });
      const result = sb.assertCanLoad({
        entryPath: "/safe/index.js",
        metadata: makePlugin(["read:files"]).getMetadata(),
      });
      expect(result.ok).toBe(true);
    });

    it("空白名单拒绝全部权限", () => {
      const sb = createPluginSandbox({});
      const result = sb.assertCanLoad({
        entryPath: "/x",
        metadata: makePlugin(["read:files"]).getMetadata(),
      });
      expect(result.ok).toBe(false);
    });
  });
});

describe("PluginManager sandbox enforcement", () => {
  it("Bug 修复复现:sandbox:true + 越权插件当前会放行(实现后必须 reject)", async () => {
    const mgr = createPluginManager({ sandbox: true });
    const plugin = makePlugin(["exec:shell"]);
    await mgr.register(plugin);
    // 越权请求应被拦截，状态应为 error(当前 dead-code 会让它变 loaded)
    await expect(mgr.load("fake")).rejects.toThrow();
    const inst = mgr.get("fake");
    expect(inst?.status).toBe("error");
  });

  it("sandbox:true + 合规插件正常加载", async () => {
    const mgr = createPluginManager({ sandbox: true });
    const plugin = makePlugin([]);
    await mgr.register(plugin);
    await mgr.load("fake");
    expect(mgr.get("fake")?.status).toBe("loaded");
  });

  it("重复注册同 ID 插件时保留第一个实例", async () => {
    const mgr = createPluginManager({ sandbox: false });
    const first = makePlugin([]);
    const second = makePlugin([]);

    await mgr.register(first, 10);
    await mgr.register(second, 20);

    expect(mgr.getAll().length).toBe(1);
    expect(mgr.get("fake")?.plugin).toBe(first);
    expect(mgr.get("fake")?.priority).toBe(10);
  });

  it("依赖未注册或未加载时拒绝加载插件", async () => {
    const mgr = createPluginManager({ sandbox: false });
    await mgr.register(
      new FakePlugin({
        dependencies: ["missing"],
        id: "dependent",
        main: "index.js",
        name: "Dependent",
        type: "tool",
        version: "0.0.1",
      }),
    );

    await expect(mgr.load("dependent")).rejects.toThrow("缺少依赖");
    expect(mgr.get("dependent")?.status).toBe("error");
  });

  it("loadAll 按依赖顺序加载，getLoaded/getByType 可查询结果", async () => {
    const mgr = createPluginManager({ sandbox: false });
    await mgr.register(new FakePlugin({ id: "dep", main: "dep.js", name: "Dep", type: "tool", version: "0.0.1" }));
    await mgr.register(
      new FakePlugin({
        dependencies: ["dep"],
        id: "app",
        main: "app.js",
        name: "App",
        type: "integration",
        version: "0.0.1",
      }),
    );

    await mgr.loadAll();

    expect(mgr.getLoadOrder()).toEqual(["dep", "app"]);
    expect(mgr.getLoaded().map((p) => p.id)).toEqual(["dep", "app"]);
    expect(mgr.getByType("tool").map((p) => p.id)).toEqual(["dep"]);
  });

  it("冲突插件已加载时拒绝后续冲突插件", async () => {
    const mgr = createPluginManager({ sandbox: false });
    await mgr.register(new FakePlugin({ id: "a", main: "a.js", name: "A", type: "tool", version: "0.0.1" }));
    await mgr.register(
      new FakePlugin({
        conflicts: ["a"],
        id: "b",
        main: "b.js",
        name: "B",
        type: "tool",
        version: "0.0.1",
      }),
    );

    await mgr.load("a");
    await expect(mgr.load("b")).rejects.toThrow("冲突");
    expect(mgr.get("b")?.status).toBe("error");
  });

  it("unload/unregister 覆盖不存在、已加载和卸载路径", async () => {
    const mgr = createPluginManager({ sandbox: false });
    const plugin = makePlugin([]);
    await mgr.unregister("missing");
    await mgr.unload("missing");
    await mgr.register(plugin);
    await mgr.load("fake");

    await mgr.unload("fake");
    expect(mgr.get("fake")?.status).toBe("unloaded");
    await mgr.unregister("fake");
    expect(mgr.get("fake")).toBeUndefined();
  });
});

describe("PluginLoader verifySignature", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "crab-sig-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { force: true, recursive: true });
  });

  it("verifySignature:false 旁路签名检查(仅警告)", async () => {
    const pluginDir = join(tmpDir, "p1");
    writePluginPackage(pluginDir, { main: "index.js", name: "p1", version: "0.0.1" });
    const loader = createPluginLoader({
      allowedTypes: ["tool"],
      pluginDir: tmpDir,
      verifySignature: false,
    });
    const result = await loader.load(pluginDir);
    expect(result.success).toBe(true);
  });

  it("verifySignature:true 缺签名必须拒绝", async () => {
    const pluginDir = join(tmpDir, "p2");
    writePluginPackage(pluginDir, { main: "index.js", name: "p2", version: "0.0.1" });
    const loader = createPluginLoader({
      allowedTypes: ["tool"],
      pluginDir: tmpDir,
      verifySignature: true,
    });
    const result = await loader.load(pluginDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain("signature");
  });

  it("verifySignature:true 短签名/格式不合法必须拒绝", async () => {
    const pluginDir = join(tmpDir, "p3");
    writePluginPackage(pluginDir, { main: "index.js", name: "p3", version: "0.0.1" });
    // 短于 16 字符 → isPlausibleSignature 判定为不合法
    writeFileSync(join(pluginDir, "index.js.sig"), "bad");
    const loader = createPluginLoader({
      allowedTypes: ["tool"],
      pluginDir: tmpDir,
      verifySignature: true,
    });
    const result = await loader.load(pluginDir);
    expect(result.success).toBe(false);
  });

  it("allowedTypes 拒绝不支持的插件类型并在 discover 中过滤", async () => {
    const pluginDir = join(tmpDir, "theme");
    writePluginPackage(pluginDir, {
      carbonConfig: { type: "theme" },
      main: "index.js",
      name: "theme",
      version: "0.0.1",
    });
    const loader = createPluginLoader({
      allowedTypes: ["tool"],
      pluginDir: tmpDir,
    });

    const loaded = await loader.load(pluginDir);
    const discovered = await loader.discover();

    expect(loaded.success).toBe(false);
    expect(loaded.error).toContain("插件类型不支持");
    expect(discovered).toEqual([]);
  });

  it("discover 忽略无 package.json 目录并返回合法插件", async () => {
    mkdirSync(join(tmpDir, "empty"), { recursive: true });
    writePluginPackage(join(tmpDir, "valid"), { main: "index.js", name: "valid", version: "0.0.1" });
    const loader = createPluginLoader({
      allowedTypes: ["tool"],
      pluginDir: tmpDir,
    });

    const discovered = await loader.discover();

    expect(discovered.map((pkg) => pkg.metadata.id)).toEqual(["valid"]);
  });

  it("缓存命中、单插件清理和全量清理", async () => {
    const pluginDir = join(tmpDir, "cached");
    writePluginPackage(pluginDir, { main: "index.js", name: "cached", version: "0.0.1" });
    const loader = createPluginLoader({
      allowedTypes: ["tool"],
      enableCache: true,
      pluginDir: tmpDir,
    });

    const first = await loader.load(pluginDir);
    const second = await loader.load(pluginDir);
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(loader.getCached(pluginDir)).toBeDefined();

    loader.clearCacheFor(pluginDir);
    expect(loader.getCached(pluginDir)).toBeUndefined();
    await loader.load(pluginDir);
    expect(loader.getCached(pluginDir)).toBeDefined();

    loader.clearCache();
    expect(loader.getCached(pluginDir)).toBeUndefined();
  });

  it("缺入口文件与错误 JSON 返回失败原因", async () => {
    const missingEntry = join(tmpDir, "missing-entry");
    mkdirSync(missingEntry, { recursive: true });
    writeFileSync(
      join(missingEntry, "package.json"),
      JSON.stringify({
        carbonConfig: { type: "tool" },
        main: "missing.js",
        name: "missing-entry",
        version: "0.0.1",
      }),
    );

    const badJson = join(tmpDir, "bad-json");
    mkdirSync(badJson, { recursive: true });
    writeFileSync(join(badJson, "package.json"), "{bad");

    const loader = createPluginLoader({
      allowedTypes: ["tool"],
      pluginDir: tmpDir,
    });

    const missing = await loader.load(missingEntry);
    const bad = await loader.load(badJson);
    expect(missing.success).toBe(false);
    expect(missing.error).toContain("插件入口文件不存在");
    expect(bad.success).toBe(false);
    expect(bad.error).toContain("无法读取插件元信息");
  });
});
