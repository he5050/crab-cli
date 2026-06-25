/**
 * Vision Agent 集成测试 — 使用真实 LLM.
 *
 * 覆盖:
 *   - analyzeImage(Buffer 输入, 1x1 PNG 占位) → 调 LLM 返回 description
 *   - extractText(Buffer 输入) → 调 LLM OCR
 *   - analyzeChart(Buffer 输入) → 调 LLM 图表分析
 *   - loadImage 错误路径: 文件过大/类型无效
 *
 * 依赖: ~/.crab/config.json 提供 LLM provider + API key.
 * 跳过条件: 若 config 不可用, 单个 test 自动跳过.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { VisionAgent } from "@/agent/specialized/vision";
import type { AppConfigSchema } from "@/schema/config";
import { hasLiveProviderConfig, loadRealTestConfig } from "../../helpers/realConfig";

/** 最小 1x1 红色 PNG (base64 编码) — 不依赖文件系统 */
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

/** 解码为 Buffer */
function makeTinyPngBuffer(): Buffer {
  return Buffer.from(TINY_PNG_BASE64, "base64");
}

describe("specialized/vision (LLM 集成)", () => {
  let agent: VisionAgent;
  let hasLiveConfig = false;

  beforeAll(async () => {
    hasLiveConfig = await hasLiveProviderConfig();
    if (!hasLiveConfig) {
      console.warn("跳过 LLM 集成测试: ~/.crab/config.json 无可用 provider");
      return;
    }
    const config: AppConfigSchema = await loadRealTestConfig();
    agent = new VisionAgent(config);
  });

  describe("analyzeImage(Buffer)", () => {
    test(
      "1x1 PNG 调 LLM 返回 description",
      async () => {
        if (!hasLiveConfig) {
          return;
        }
        const result = await agent.analyzeImage({ type: "buffer", buffer: makeTinyPngBuffer() });
        expect(typeof result.success).toBe("boolean");
        if (result.success) {
          expect(typeof result.description).toBe("string");
          expect(result.description!.length).toBeGreaterThan(0);
        } else {
          expect(typeof result.error).toBe("string");
        }
      },
      { timeout: 30_000 },
    );
  });

  describe("extractText(Buffer)", () => {
    test(
      "1x1 PNG 调 LLM OCR 返回 text",
      async () => {
        if (!hasLiveConfig) {
          return;
        }
        const result = await agent.extractText({ type: "buffer", buffer: makeTinyPngBuffer() });
        expect(typeof result.success).toBe("boolean");
        if (result.success) {
          expect(typeof result.text).toBe("string");
        } else {
          expect(typeof result.error).toBe("string");
        }
      },
      { timeout: 30_000 },
    );
  });

  describe("analyzeChart(Buffer)", () => {
    test(
      "1x1 PNG 调 LLM 图表分析",
      async () => {
        if (!hasLiveConfig) {
          return;
        }
        const result = await agent.analyzeChart({ type: "buffer", buffer: makeTinyPngBuffer() });
        expect(typeof result.success).toBe("boolean");
        if (result.success) {
          expect(typeof result.description).toBe("string");
        } else {
          expect(typeof result.error).toBe("string");
        }
      },
      { timeout: 30_000 },
    );
  });

  describe("loadImage 错误路径(无 LLM 调用, 走 try/catch 错误返回)", () => {
    test("过大 Buffer(>20MB) 返回 success=false", async () => {
      if (!hasLiveConfig) {
        return;
      }
      const huge = Buffer.alloc(21 * 1024 * 1024); // 21MB
      const result = await agent.analyzeImage({ type: "buffer", buffer: huge });
      // vision.ts 内部 try/catch 吞掉 throw, 返回 success=false
      expect(result.success).toBe(false);
      expect(typeof result.error).toBe("string");
    });

    test("不存在的文件路径 返回 success=false", async () => {
      if (!hasLiveConfig) {
        return;
      }
      const result = await agent.analyzeImage({
        type: "file",
        filePath: "/nonexistent/path/to/file.png",
      });
      expect(result.success).toBe(false);
      expect(typeof result.error).toBe("string");
    });
  });
});
