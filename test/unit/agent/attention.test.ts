/**
 * Attention 系统测试。
 *
 * 覆盖导出:
 *   - addAttention
 *   - dismissAttention
 *   - clearDismissed
 *   - activePoints
 *   - highestLevel
 *   - formatAttentionPrompt
 *   - points / setPoints / enabled / setEnabled
 */
import { beforeEach, describe, expect, test } from "bun:test";
import {
  activePoints,
  addAttention,
  clearDismissed,
  dismissAttention,
  disableAttention,
  enableAttention,
  formatAttentionPrompt,
  getPoints,
  highestLevel,
  isEnabled,
  resetAttention,
} from "@/agent/runtime/attention";

describe("Attention 系统", () => {
  beforeEach(() => {
    resetAttention();
  });

  describe("addAttention", () => {
    test("添加一个默认 info 级别关注点", () => {
      const p = addAttention("测试关注");
      expect(p.label).toBe("测试关注");
      expect(p.level).toBe("info");
      expect(p.source).toBe("system");
      expect(p.dismissed).toBe(false);
      expect(p.id).toMatch(/^attn_/);
    });

    test("指定 level 和 source", () => {
      const p = addAttention("严重问题", {
        description: "内存溢出",
        level: "critical",
        source: "user",
      });
      expect(p.level).toBe("critical");
      expect(p.source).toBe("user");
      expect(p.description).toBe("内存溢出");
    });

    test("ID 自增", () => {
      const p1 = addAttention("a");
      const p2 = addAttention("b");
      // ID 格式不同(自增数字不同)
      expect(p1.id).not.toBe(p2.id);
    });
  });

  describe("dismissAttention", () => {
    test("解除关注点", () => {
      const p = addAttention("test");
      expect(p.dismissed).toBe(false);

      dismissAttention(p.id);

      const all = getPoints();
      expect(all[0]!.dismissed).toBe(true);
    });

    test("解除不存在的 ID 无副作用", () => {
      addAttention("test");
      dismissAttention("attn_99999");
      expect(getPoints()).toHaveLength(1);
      expect(getPoints()[0]!.dismissed).toBe(false);
    });
  });

  describe("clearDismissed", () => {
    test("清除已解除的关注点", () => {
      const p1 = addAttention("keep");
      const p2 = addAttention("remove");
      dismissAttention(p2.id);
      expect(getPoints()).toHaveLength(2);

      clearDismissed();
      expect(getPoints()).toHaveLength(1);
      expect(getPoints()[0]!.id).toBe(p1.id);
    });

    test("无已解除项时无变化", () => {
      addAttention("test");
      clearDismissed();
      expect(getPoints()).toHaveLength(1);
    });
  });

  describe("activePoints", () => {
    test("返回未解除的关注点", () => {
      addAttention("active");
      const p2 = addAttention("inactive");
      dismissAttention(p2.id);

      const active = activePoints();
      expect(active).toHaveLength(1);
      expect(active[0]!.label).toBe("active");
    });

    test("全部解除时返回空", () => {
      const p = addAttention("test");
      dismissAttention(p.id);
      expect(activePoints()).toHaveLength(0);
    });

    test("空列表返回空", () => {
      expect(activePoints()).toHaveLength(0);
    });
  });

  describe("highestLevel", () => {
    test("空列表返回 null", () => {
      expect(highestLevel()).toBeNull();
    });

    test("单个 info 返回 info", () => {
      addAttention("test", { level: "info" });
      expect(highestLevel()).toBe("info");
    });

    test("mixed 返回最高级别", () => {
      addAttention("a", { level: "info" });
      addAttention("b", { level: "warning" });
      addAttention("c", { level: "critical" });
      expect(highestLevel()).toBe("critical");
    });

    test("警告 > 信息", () => {
      addAttention("a", { level: "info" });
      addAttention("b", { level: "warning" });
      expect(highestLevel()).toBe("warning");
    });
  });

  describe("formatAttentionPrompt", () => {
    test("enabled=false 时返回空字符串", () => {
      disableAttention();
      addAttention("test");
      expect(formatAttentionPrompt()).toBe("");
    });

    test("无活跃关注点时返回空字符串", () => {
      expect(formatAttentionPrompt()).toBe("");
    });

    test("包含关注点标签", () => {
      addAttention("内存警告", { level: "warning" });
      const prompt = formatAttentionPrompt();
      expect(prompt).toContain("内存警告");
      expect(prompt).toContain("当前关注点");
    });

    test("包含描述信息", () => {
      addAttention("磁盘", { description: "空间不足", level: "critical" });
      const prompt = formatAttentionPrompt();
      expect(prompt).toContain("空间不足");
    });
  });
});
