/**
 * 插槽系统测试。
 *
 * 测试用例:
 *   - 插槽注册和获取
 *   - 插槽注销
 *   - 优先级竞争模式
 *   - cleanup 函数注销
 */
import { describe, expect, test } from "bun:test";

describe("Plugin Slot 系统", () => {
  // 动态导入以获取干净状态
  async function importSlots() {
    const mod = await import("@/ui/plugins/slots.tsx");
    // 清理上次测试的注册
    mod.clearSlots();
    return mod;
  }

  test("registerSlot + getPluginSlot 基本注册", async () => {
    const { registerSlot, getPluginSlot, clearSlots } = await importSlots();
    const renderer = () => "plugin-content";
    registerSlot("home_logo", renderer);
    expect(getPluginSlot("home_logo")).toBe(renderer);
    clearSlots();
  });

  test("unregisterSlot 清除注册", async () => {
    const { registerSlot, unregisterSlot, getPluginSlot, clearSlots } = await importSlots();
    registerSlot("home_logo", () => "content");
    unregisterSlot("home_logo");
    expect(getPluginSlot("home_logo")).toBeUndefined();
    clearSlots();
  });

  test("竞争模式:高优先级胜出", async () => {
    const { registerSlot, getPluginSlot, clearSlots } = await importSlots();
    const low = () => "low";
    const high = () => "high";
    registerSlot("home_logo", low, { id: "low", priority: 1 });
    registerSlot("home_logo", high, { id: "high", priority: 10 });
    const winner = getPluginSlot("home_logo");
    expect(winner).toBe(high);
    clearSlots();
  });

  test("cleanup 函数注销注册", async () => {
    const { registerSlot, getPluginSlot, clearSlots } = await importSlots();
    const cleanup = registerSlot("home_logo", () => "content", { id: "test" });
    expect(getPluginSlot("home_logo")).toBeDefined();
    cleanup();
    expect(getPluginSlot("home_logo")).toBeUndefined();
    clearSlots();
  });
});
