import { describe, expect, it } from "bun:test";
import { getModelCapabilities, listAllModels, searchModels } from "@/api";
import type { AppConfigSchema } from "@/schema/config";

const MOCK_CONFIG: AppConfigSchema = {
  defaultProvider: { provider: "openai", model: "gpt-4o" },
  providerConfig: {
    openai: {
      apiKey: "test",
      baseURL: "https://api.openai.com/v1",
      modelList: ["gpt-4o", "gpt-4o-mini", "o1-mini"],
    },
    anthropic: {
      apiKey: "test",
      baseURL: "https://api.anthropic.com",
      modelList: ["claude-3-5-sonnet-latest"],
    },
  },
} as any;

describe("ModelCapabilities", () => {
  it("gpt-4o has default capabilities", () => {
    const caps = getModelCapabilities("gpt-4o");
    expect(caps.vision).toBe(true);
    expect(caps.tools).toBe(true);
    expect(caps.reasoning).toBe(false);
    expect(caps.jsonMode).toBe(true);
  });

  it("o1-mini has reasoning only", () => {
    const caps = getModelCapabilities("o1-mini");
    expect(caps.vision).toBe(false);
    expect(caps.tools).toBe(false);
    expect(caps.reasoning).toBe(true);
    expect(caps.jsonMode).toBe(false);
  });

  it("claude-3-5-sonnet has full capabilities except reasoning", () => {
    const caps = getModelCapabilities("claude-3-5-sonnet-latest");
    expect(caps.vision).toBe(true);
    expect(caps.tools).toBe(true);
    expect(caps.reasoning).toBe(false);
    expect(caps.jsonMode).toBe(true);
  });

  it("unknown model gets default capabilities", () => {
    const caps = getModelCapabilities("some-unknown-model");
    expect(caps.vision).toBe(true);
    expect(caps.tools).toBe(true);
    expect(caps.reasoning).toBe(true);
    expect(caps.jsonMode).toBe(true);
  });
});

describe("listAllModels with capabilities", () => {
  it("includes capabilities for each model", () => {
    const models = listAllModels(MOCK_CONFIG);
    expect(models.length).toBe(4);

    const gpt4o = models.find((m) => m.id === "gpt-4o");
    expect(gpt4o).toBeDefined();
    expect(gpt4o?.isDefault).toBe(true);
    expect(gpt4o?.capabilities.vision).toBe(true);
  });

  it("marks correct default model", () => {
    const models = listAllModels(MOCK_CONFIG);
    const defaults = models.filter((m) => m.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.id).toBe("gpt-4o");
  });
});

describe("searchModels with capabilities", () => {
  it("searches and includes capabilities", () => {
    const results = searchModels(MOCK_CONFIG, "gpt");
    expect(results.length).toBe(2);
    expect(results[0]!.capabilities).toBeDefined();
  });
});
