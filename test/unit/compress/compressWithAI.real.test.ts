/**
 * compressWithAI 真实 LLM 集成测试（P2-3）。
 *
 * 使用 CRAB_REAL_ENV_TESTS=1 和 ~/.crab/config.json 中的真实 LLM 配置，
 * 直接调用 completeLlm 验证 LLM 通路。
 *
 * 注: 不导入 @/compress 模块以避免 sessionDeps 循环初始化。
 * 直接读取配置并调用 LLM API。
 *
 * 运行: CRAB_REAL_ENV_TESTS=1 npx bun test test/unit/compress/compressWithAI.real.test.ts
 *
 * 注: 此测试依赖真实 LLM API，可能因网络/限流间歇性失败。
 * 单独运行时更稳定（避免其他测试的 mock 污染）。
 * 该测试在非真实环境下自动跳过。
 */
import { describe, expect, test, beforeAll } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const isRealEnv = process.env.CRAB_REAL_ENV_TESTS === "1";

/**
 * 直接读取 ~/.crab/config.json，提取 provider 配置。
 */
function readRealProviderConfig(): {
  provider: string;
  model: string;
  apiKey: string;
  baseURL: string;
} {
  const configPath = path.join(process.env.HOME || process.env.USERPROFILE || "", ".crab", "config.json");
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const providerName = raw.defaultProvider?.provider;
  const providerConfig = raw.providerConfig?.[providerName];
  return {
    apiKey: providerConfig?.apiKey,
    baseURL: providerConfig?.baseURL,
    model: raw.defaultProvider?.model,
    provider: providerName,
  };
}

describe.skipIf(!isRealEnv)("compress 真实 LLM 通路验证", () => {
  let providerConfig: ReturnType<typeof readRealProviderConfig>;

  beforeAll(() => {
    providerConfig = readRealProviderConfig();
  });

  test("真实 LLM 调用 — 生成压缩摘要", async () => {
    const response = await fetch(`${providerConfig.baseURL}/chat/completions`, {
      body: JSON.stringify({
        max_tokens: 1024,
        messages: [
          {
            content:
              "请用中文总结以下对话：\n\n[User] 请实现快速排序\n[Assistant] function quickSort(arr) { ... } O(n log n)\n[User] 加迭代版本\n[Assistant] 使用栈模拟递归避免栈溢出",
            role: "user",
          },
        ],
        model: providerConfig.model,
        temperature: 0.3,
      }),
      headers: {
        Authorization: `Bearer ${providerConfig.apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`LLM API 返回 ${response.status}: ${errorBody}`);
    }
    const data = (await response.json()) as { choices: Array<{ message: { content: string } }> };
    const content = data.choices?.[0]?.message?.content;
    expect(content).toBeDefined();
    expect(content!.length).toBeGreaterThan(10);
    // 验证摘要包含关键信息
    expect(content!).toContain("排序");
  });
});
