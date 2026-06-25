/**
 * Vision Agent 单元测试
 *
 * 测试覆盖:
 *   - Vision Agent 基本功能
 *   - 类型定义
 */

import { describe, expect, it } from "bun:test";
import { VisionAgent, registerVisionAgent } from "@/agent/specialized/vision";
import type { AppConfigSchema } from "@/schema/config";

describe("VisionAgent", () => {
  const mockConfig = {} as AppConfigSchema;

  describe("基本功能", () => {
    it("should create VisionAgent instance", () => {
      const agent = registerVisionAgent(mockConfig);
      expect(agent).toBeInstanceOf(VisionAgent);
    });

    it("should register agent via factory function", () => {
      const agent = registerVisionAgent(mockConfig);
      expect(agent).toBeInstanceOf(VisionAgent);
    });
  });

  describe("类型定义", () => {
    it("should export VisionAgent class", () => {
      expect(VisionAgent).toBeDefined();
    });

    it("should export registerVisionAgent function", () => {
      expect(typeof registerVisionAgent).toBe("function");
    });
  });
});
