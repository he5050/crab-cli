/**
 * PluginManager 核心单元测试。
 *
 * 覆盖范围:
 *   - register 注册插件
 *   - register 重复 ID 跳过
 *   - unregister 注销运行中的插件
 *   - get / getAll / getLoaded / getByType 查询
 *   - 依赖检查（依赖缺失/未加载）
 *   - 冲突检查
 *   - loadAll 拓扑排序
 *   - createPluginManager 工厂函数
 */
import { describe, expect, test } from "bun:test";
import { createPluginManager, BasePlugin, type PluginMetadata } from "@/extension/plugin/pluginSystem";

// ─── 辅助 ──────────────────────────────────────────────────

class MockPlugin extends BasePlugin {
  constructor(metadata: PluginMetadata) {
    super(metadata);
  }
  async load(): Promise<void> {}
  async unload(): Promise<void> {}
}

function makeMeta(overrides: Partial<PluginMetadata> = {}): PluginMetadata {
  return {
    conflicts: [],
    dependencies: [],
    description: "测试插件",
    id: "test-plugin",
    main: "index.js",
    name: "Test Plugin",
    permissions: [],
    type: "custom",
    version: "1.0.0",
    ...overrides,
  };
}

// ─── 测试 ──────────────────────────────────────────────────

describe("PluginManager", () => {
  test("register 和 get 基本流程", async () => {
    const mgr = createPluginManager({ path: "/plugins" });
    const plugin = new MockPlugin(makeMeta());
    await mgr.register(plugin);

    const instance = mgr.get("test-plugin");
    expect(instance).toBeDefined();
    expect(instance!.metadata.name).toBe("Test Plugin");
    expect(instance!.status).toBe("discovered");
  });

  test("register 重复 ID 跳过", async () => {
    const mgr = createPluginManager();
    await mgr.register(new MockPlugin(makeMeta()));
    await mgr.register(new MockPlugin(makeMeta()));

    expect(mgr.getAll()).toHaveLength(1);
  });

  test("unregister 运行中的插件先 unload", async () => {
    const mgr = createPluginManager();
    const plugin = new MockPlugin(makeMeta());
    await mgr.register(plugin);
    await mgr.load("test-plugin");
    await mgr.unregister("test-plugin");

    expect(mgr.get("test-plugin")).toBeUndefined();
    expect(mgr.getAll()).toHaveLength(0);
  });

  test("unregister 不存在的插件静默处理", async () => {
    const mgr = createPluginManager();
    // 不应抛错
    await mgr.unregister("nonexistent");
    expect(mgr.getAll()).toHaveLength(0);
  });

  test("getAll / getLoaded / getByType 查询", async () => {
    const mgr = createPluginManager();
    await mgr.register(new MockPlugin(makeMeta({ type: "tool" })));
    await mgr.register(new MockPlugin(makeMeta({ id: "theme-plugin", type: "theme" })));
    await mgr.loadAll();

    expect(mgr.getAll()).toHaveLength(2);
    expect(mgr.getLoaded()).toHaveLength(2);
    expect(mgr.getByType("tool")).toHaveLength(1);
    expect(mgr.getByType("theme")).toHaveLength(1);
    expect(mgr.getByType("integration")).toHaveLength(0);
  });

  test("依赖检查：依赖缺失时抛错", async () => {
    const mgr = createPluginManager();
    const plugin = new MockPlugin(makeMeta({ dependencies: ["missing-dep"] }));
    await mgr.register(plugin);

    await expect(mgr.load("test-plugin")).rejects.toThrow("missing-dep");
  });

  test("依赖检查：依赖未加载时抛错", async () => {
    const mgr = createPluginManager();
    // 先注册依赖但不加载
    await mgr.register(new MockPlugin(makeMeta({ id: "dep-a" })));
    await mgr.register(new MockPlugin(makeMeta({ id: "dep-b", dependencies: ["dep-a"] })));

    await expect(mgr.load("dep-b")).rejects.toThrow("dep-a");
  });

  test("冲突检查：冲突插件已加载时抛错", async () => {
    const mgr = createPluginManager();
    await mgr.register(new MockPlugin(makeMeta({ id: "plugin-a" })));
    await mgr.register(new MockPlugin(makeMeta({ id: "plugin-b", conflicts: ["plugin-a"] })));
    await mgr.load("plugin-a");

    await expect(mgr.load("plugin-b")).rejects.toThrow("plugin-a");
  });

  test("loadAll 按依赖顺序加载", async () => {
    const mgr = createPluginManager();
    const loadOrder: string[] = [];

    // plugin-c 依赖 plugin-b，plugin-b 依赖 plugin-a
    class OrderTrackingPlugin extends BasePlugin {
      constructor(meta: PluginMetadata) {
        super(meta);
      }
      async load() {
        loadOrder.push(this.getMetadata().id);
      }
      async unload() {}
    }

    await mgr.register(new OrderTrackingPlugin(makeMeta({ id: "plugin-c", dependencies: ["plugin-b"] })));
    await mgr.register(new OrderTrackingPlugin(makeMeta({ id: "plugin-b", dependencies: ["plugin-a"] })));
    await mgr.register(new OrderTrackingPlugin(makeMeta({ id: "plugin-a" })));

    await mgr.loadAll();
    expect(loadOrder).toEqual(["plugin-a", "plugin-b", "plugin-c"]);
  });

  test("loadAll 部分失败不影响其他插件", async () => {
    const mgr = createPluginManager();
    const loaded: string[] = [];

    class SuccessPlugin extends BasePlugin {
      constructor(meta: PluginMetadata) {
        super(meta);
      }
      async load() {
        loaded.push(this.getMetadata().id);
      }
      async unload() {}
    }

    class FailPlugin extends BasePlugin {
      constructor(meta: PluginMetadata) {
        super(meta);
      }
      async load() {
        throw new Error("load failed");
      }
      async unload() {}
    }

    await mgr.register(new FailPlugin(makeMeta({ id: "fail-plugin" })));
    await mgr.register(new SuccessPlugin(makeMeta({ id: "ok-plugin" })));

    await mgr.loadAll();
    expect(loaded).toContain("ok-plugin");
    expect(mgr.get("fail-plugin")!.status).toBe("error");
    expect(mgr.get("ok-plugin")!.status).toBe("loaded");
  });

  test("createPluginManager 返回 PluginManager 实例", () => {
    const mgr = createPluginManager();
    expect(mgr).toBeDefined();
    expect(mgr.getAll()).toEqual([]);
  });

  test("默认选项", () => {
    const mgr = createPluginManager();
    expect(mgr.getAll()).toEqual([]);
    expect(mgr.getLoadOrder()).toEqual([]);
  });
});

describe("BasePlugin", () => {
  test("getMetadata 和 getStatus", () => {
    const meta = makeMeta({ description: "test" });
    const plugin = new MockPlugin(meta);

    expect(plugin.getMetadata()).toBe(meta);
    expect(plugin.getStatus()).toBe("discovered");
  });
});
