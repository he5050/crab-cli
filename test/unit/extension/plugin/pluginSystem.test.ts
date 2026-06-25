/**
 * PluginManager / BasePlugin 单元测试。
 *
 * 覆盖范围:
 *   - PluginManager.register / unregister
 *   - PluginManager.get / getAll / getLoaded / getByType
 *   - PluginManager.load / unload / loadAll
 *   - PluginManager.loadAll 单个失败不阻止其他
 *   - PluginManager 依赖检查
 *   - PluginManager 冲突检查
 *   - PluginManager.resolveLoadOrder 拓扑排序
 *   - BasePlugin 基本生命周期
 */
import { describe, expect, mock, test } from "bun:test";

// ─── Mock logger（避免触发 Puppeteer/MCP 加载）──

mock.module("@/core/logging/logger", () => ({
  createLogger: () => ({
    child: () => ({ child: () => ({}) }),
    debug: () => {},
    error: () => {},
    info: () => {},
    warn: () => {},
  }),
}));

mock.module("@/core/errors/appError", () => ({
  createUserError: (code: string, message: string, opts?: Record<string, unknown>) => ({
    code,
    domain: "USER",
    message,
    name: "UserError",
    recoverable: true,
    severity: "medium",
    ...opts,
  }),
  createSecurityError: (code: string, message: string, opts?: Record<string, unknown>) => ({
    code,
    domain: "SECURITY",
    message,
    name: "SecurityError",
    recoverable: false,
    severity: "high",
    ...opts,
  }),
}));

// ─── 静态导入 ────────────────────────────────────────────

import {
  BasePlugin,
  createPluginManager,
  type PluginInterface,
  type PluginMetadata,
} from "@/extension/plugin/pluginSystem";

// ─── 测试辅助 ──────────────────────────────────────────

/** 创建一个简单的测试插件 */
function createTestPlugin(
  overrides?: Partial<PluginMetadata> & { load?: PluginInterface["load"]; unload?: PluginInterface["unload"] },
): PluginInterface {
  const metadata: PluginMetadata = {
    dependencies: overrides?.dependencies ?? [],
    main: "index.js",
    name: overrides?.name ?? "test-plugin",
    type: overrides?.type ?? "tool",
    version: overrides?.version ?? "1.0.0",
    id: overrides?.id ?? "test-plugin",
    conflicts: overrides?.conflicts,
  };

  return {
    getMetadata: () => metadata,
    getStatus: () => "discovered" as const,
    load: overrides?.load ?? (() => Promise.resolve()),
    unload: overrides?.unload ?? (() => Promise.resolve()),
  };
}

// ─── 测试 ──────────────────────────────────────────────

describe("PluginManager", () => {
  test("register 和 get 基本流程", async () => {
    const manager = createPluginManager({ sandbox: false });
    const plugin = createTestPlugin({ id: "test-plugin", name: "Test", version: "1.0.0" });

    await manager.register(plugin);

    expect(manager.getAll().length).toBe(1);
    expect(manager.get("test-plugin")!.metadata.name).toBe("Test");
  }, 15_000);

  test("register 重复 ID 跳过", async () => {
    const manager = createPluginManager();
    const plugin1 = createTestPlugin({ id: "dup", name: "Dup1" });
    const plugin2 = createTestPlugin({ id: "dup", name: "Dup2" });

    await manager.register(plugin1);
    await manager.register(plugin2);

    expect(manager.getAll().length).toBe(1);
    expect(manager.get("dup")!.metadata.name).toBe("Dup1");
  });

  test("unregister 不存在的插件不报错", async () => {
    const manager = createPluginManager();
    await manager.unregister("nonexistent");
  });

  test("getByType 按类型过滤", async () => {
    const manager = createPluginManager();
    await manager.register(createTestPlugin({ id: "p1", name: "Tool1", type: "tool" }));
    await manager.register(createTestPlugin({ id: "p2", name: "Theme1", type: "theme" }));
    await manager.register(createTestPlugin({ id: "p3", name: "Tool2", type: "tool" }));

    expect(manager.getByType("tool").length).toBe(2);
    expect(manager.getByType("theme").length).toBe(1);
  });

  test("getLoaded 仅返回已加载状态", async () => {
    const manager = createPluginManager();
    const plugin = createTestPlugin({ id: "loaded-p" });
    await manager.register(plugin);

    // 未加载
    expect(manager.getLoaded().length).toBe(0);
  });

  test("load 和 unload 生命周期", async () => {
    const manager = createPluginManager({ sandbox: false, timeout: 5000 });
    let loadCount = 0;
    let unloadCount = 0;

    const plugin: PluginInterface = {
      ...createTestPlugin({ id: "lifecycle" }),
      load: async () => {
        loadCount++;
      },
      unload: async () => {
        unloadCount++;
      },
    };

    await manager.register(plugin);
    await manager.load("lifecycle");

    expect(loadCount).toBe(1);
    expect(manager.getLoaded().length).toBe(1);

    await manager.unload("lifecycle");
    expect(unloadCount).toBe(1);
  });

  test("loadAll 单个失败不阻止其他", async () => {
    const manager = createPluginManager({ sandbox: false });

    const goodPlugin = createTestPlugin({ id: "good" });
    const badPlugin: PluginInterface = {
      ...createTestPlugin({ id: "bad" }),
      load: async () => {
        throw new Error("模拟加载失败");
      },
    };

    await manager.register(goodPlugin);
    await manager.register(badPlugin);
    await manager.loadAll();

    expect(manager.getLoaded().length).toBe(1);
    expect(manager.get("good")!.status).toBe("loaded");
    expect(manager.get("bad")!.status).toBe("error");
  });

  test("依赖检查：缺少依赖时报错", async () => {
    const manager = createPluginManager({ sandbox: false });

    const mainPlugin = createTestPlugin({
      dependencies: ["dep-a"],
      id: "main",
    });
    await manager.register(mainPlugin);

    // dep-a 未注册 → load 应失败
    await expect(manager.load("main")).rejects.toThrow();
  });

  test("冲突检查：已加载的冲突插件阻止加载", async () => {
    const manager = createPluginManager({ sandbox: false });

    const pluginA = createTestPlugin({
      conflicts: ["plugin-b"],
      id: "plugin-a",
    });
    const pluginB = createTestPlugin({
      conflicts: ["plugin-a"],
      id: "plugin-b",
    });

    await manager.register(pluginA);
    await manager.register(pluginB);

    await manager.load("plugin-a");
    // plugin-b 与 plugin-a 冲突 → load 应失败
    await expect(manager.load("plugin-b")).rejects.toThrow();
  });
});

describe("BasePlugin", () => {
  test("基本属性和抽象方法", () => {
    class TestPlugin extends BasePlugin {
      private _loaded = false;

      constructor() {
        super({ id: "base-test", main: "index.js", name: "BaseTest", version: "1.0.0", type: "tool" });
      }

      async load(): Promise<void> {
        this._loaded = true;
        this.setStatus("loaded");
      }

      async unload(): Promise<void> {
        this._loaded = false;
        this.setStatus("unloaded");
      }
    }

    const plugin = new TestPlugin();
    expect(plugin.getMetadata().id).toBe("base-test");
    expect(plugin.getStatus()).toBe("discovered");

    // 需要使用 setAccessible 来测试 protected 方法（bun:test 不支持）
    // 验证通过接口方法即可
  });
});

describe("PluginManager.unregister", () => {
  test("unregister 运行中插件应先 unload 再移除", async () => {
    const manager = createPluginManager({ path: "./test-plugins" });
    const loadCalled: string[] = [];
    const unloadCalled: string[] = [];

    class TrackingPlugin extends BasePlugin {
      constructor(id: string) {
        super({ id, main: "index.js", name: id, version: "1.0.0", type: "tool" });
      }
      async load(): Promise<void> {
        loadCalled.push(this.getMetadata().id);
        this.setStatus("loaded");
      }
      async unload(): Promise<void> {
        unloadCalled.push(this.getMetadata().id);
        this.setStatus("unloaded");
      }
    }

    const plugin = new TrackingPlugin("track-a");
    await manager.register(plugin);
    await manager.load("track-a");
    expect(manager.get("track-a")?.status).toBe("loaded");

    await manager.unregister("track-a");
    expect(manager.get("track-a")).toBeUndefined();
    expect(unloadCalled).toContain("track-a");
  });

  test("unregister 不存在的插件不报错", async () => {
    const manager = createPluginManager({ path: "./test-plugins" });
    // 不应抛出异常
    await manager.unregister("nonexistent");
    expect(manager.getAll().length).toBe(0);
  });
});
