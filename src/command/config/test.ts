/**
 * Crab config test 命令 — 验证 Provider 连接可用性。
 *
 * 职责:
 *   - 测试指定 Provider 的 API 连接
 *   - 输出测试结果和延迟信息
 *   - 支持测试所有已配置的 Provider
 *
 * 使用场景:
 *   - 配置后验证 API Key 是否有效
 *   - 检查网络连通性
 *   - 诊断 Provider 配置问题
 */
import type { TestResult } from "../type";
import { loadConfig } from "@/config";
import { checkProviderHealth, checkAllProvidersHealth } from "@/api";
import { createCliError, writeCliError } from "@/cli";

function formatHealthResult(result: TestResult): string {
  const statusIcon = result.status === "healthy" ? "✓" : result.status === "unhealthy" ? "✗" : "?";
  const statusColor =
    result.status === "healthy" ? "\x1b[32m" : result.status === "unhealthy" ? "\x1b[31m" : "\x1b[33m";
  const reset = "\x1b[0m";

  let line = `  ${statusColor}${statusIcon}${reset} ${result.providerId}`;
  if (result.latencyMs !== undefined) {
    line += ` (${result.latencyMs}ms)`;
  }
  if (result.message) {
    line += ` - ${result.message}`;
  }
  return line;
}

export async function configTestCommand(providerId?: string): Promise<void> {
  const config = await loadConfig();

  if (providerId) {
    // 测试单个 Provider
    const providerCfg = config.providerConfig?.[providerId];
    if (!providerCfg) {
      writeCliError(
        createCliError({
          context: { providerId },
          kind: "resource-not-found",
          message: `未找到 Provider 配置: ${providerId}`,
        }),
      );
      process.exit(1);
    }

    console.log(`正在测试 Provider: ${providerId}...`);
    const startTime = Date.now();
    const health = await checkProviderHealth(config, providerId);
    const latencyMs = Date.now() - startTime;

    const result: TestResult = {
      providerId,
      status: health.status === "healthy" ? "healthy" : "unhealthy",
      latencyMs,
      message: health.error,
    };

    console.log(formatHealthResult(result));

    if (health.status !== "healthy") {
      console.log("\n  建议:");
      if (!providerCfg.apiKey) {
        console.log("    - 未配置 API Key，请运行 crab setup 或 crab config set provider.<id>.apiKey");
      } else if (providerCfg.baseURL) {
        console.log(`    - 检查 Base URL 是否正确: ${providerCfg.baseURL}`);
      }
      console.log("    - 检查网络连接是否正常");
      process.exit(1);
    }
  } else {
    // 测试所有 Provider
    console.log("正在测试所有已配置的 Provider...\n");
    const startTime = Date.now();
    const results = await checkAllProvidersHealth(config);
    const totalLatencyMs = Date.now() - startTime;

    const testResults: TestResult[] = results.map((r) => ({
      latencyMs: r.latencyMs,
      message: r.error,
      providerId: r.providerId,
      status: r.status === "healthy" ? "healthy" : r.status === "unhealthy" ? "unhealthy" : "unknown",
    }));

    for (const result of testResults) {
      console.log(formatHealthResult(result));
    }

    const healthyCount = testResults.filter((r) => r.status === "healthy").length;
    const totalCount = testResults.length;

    console.log(`\n  总计: ${healthyCount}/${totalCount} 可用 (总耗时: ${totalLatencyMs}ms)`);

    if (healthyCount === 0) {
      console.log("\n  所有 Provider 均不可用，请检查配置。");
      process.exit(1);
    } else if (healthyCount < totalCount) {
      console.log("\n  部分 Provider 不可用，请检查对应配置。");
      process.exit(0);
    }
  }
}
