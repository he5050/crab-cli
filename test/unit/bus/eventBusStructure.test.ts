import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../..");

describe("EventBus 结构守卫", () => {
  test("核心子模块文件存在于 core/ 目录", () => {
    for (const file of [
      "src/bus/core/dispatch.ts",
      "src/bus/core/history.ts",
      "src/bus/core/throttle.ts",
      "src/bus/core/subscriptions.ts",
      "src/bus/core/queueRuntime.ts",
      "src/bus/core/types.ts",
      "src/bus/core/constants.ts",
      "src/bus/core/utils.ts",
      "src/bus/core/eventBus.ts",
      "src/bus/core/lifecycle.ts",
      "src/bus/core/index.ts",
    ]) {
      expect(existsSync(join(ROOT, file)), `${file} should exist`).toBe(true);
    }
  });

  test("core/eventBus.ts 使用相对路径引用核心子模块", () => {
    const source = readFileSync(join(ROOT, "src/bus/core/eventBus.ts"), "utf8");

    expect(source).toContain('from "./dispatch"');
    expect(source).toContain('from "./history"');
    expect(source).toContain('from "./subscriptions"');
    expect(source).toContain('from "./throttle"');
    expect(source).toContain('from "./queueRuntime"');
    expect(source).toContain('from "./constants"');
    expect(source).toContain('from "./types"');
    expect(source).toContain('from "./utils"');

    expect(source).not.toContain("private cleanupExpiredHistory(): void");
    expect(source).toContain("dispatchEventThroughHandlers(");
    expect(source).toContain("new EventBusHistoryManager(");
    expect(source).toContain("new EventBusSubscriptionsManager(");
    expect(source).toContain("new EventBusThrottleManager(");
    expect(source).toContain("return this.subscriptionsManager.subscribe(");
    expect(source).toContain("return this.subscriptionsManager.subscribeOnce(");
    expect(source).toContain("return this.subscriptionsManager.subscribeForSession(");
    expect(source).toContain("return this.subscriptionsManager.subscribePrefix(");
    expect(source).toContain("return this.subscriptionsManager.subscribeAll(");
  });

  test("bus/index.ts 根级 Barrel 仅做重导出", () => {
    const source = readFileSync(join(ROOT, "src/bus/index.ts"), "utf8");

    expect(source).toContain('from "./core"');
    expect(source).toContain('from "./events"');
    expect(source).not.toContain("class EventBus");
    expect(source).not.toContain("private handlers");
  });
});
