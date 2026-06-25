/**
 * Crab setup 交互式配置命令
 *
 * 职责:
 *   - 引导用户完成首次配置
 *   - Provider 选择、API Key 输入、模型配置
 *   - 配置验证与持久化
 *
 * 流程:
 *   1. 检测已有配置，确认是否覆盖
 *   2. 选择 AI Provider(openai / anthropic / google / custom)
 *   3. 输入 API Key
 *   4. 输入模型名称
 *   5. 验证并写入 ~/.crab/config.json
 */
import { createInterface } from "node:readline/promises";
import { saveConfig, getGlobalConfigPath } from "@/config";
import fs from "node:fs";
import path from "node:path";
import { AppConfigSchema } from "@/schema/config";
import type { SingleProviderConfig } from "@/schema/config";
import { createCliError, writeCliError } from "@/cli";
import type { ProviderOption } from "../type";
import {
  createOpenRouterConfig,
  createAzureConfig,
  createBedrockConfig,
  createXaiConfig,
  createCopilotConfig,
  createCloudflareConfig,
  getCopilotToken,
  exchangeCopilotToken,
  EXTENDED_PROVIDERS,
} from "@/api/providers";

export const PROVIDERS: ProviderOption[] = [
  { defaultModel: "gpt-4o", id: "openai", method: "chat", name: "OpenAI" },
  { defaultModel: "claude-sonnet-4-20250514", id: "anthropic", method: "claude", name: "Anthropic Claude" },
  { defaultModel: "gemini-2.5-pro", id: "google", method: "gemini", name: "Google Gemini" },
  { defaultModel: "deepseek-chat", id: "deepseek", method: "chat", name: "DeepSeek" },
  { defaultModel: "anthropic/claude-sonnet-4", id: "openrouter", method: "chat", name: "OpenRouter" },
  { defaultModel: "gpt-4o", id: "azure", method: "chat", name: "Azure OpenAI" },
  { defaultModel: "anthropic.claude-3-5-sonnet-20241022-v2:0", id: "bedrock", method: "chat", name: "AWS Bedrock" },
  { defaultModel: "grok-3", id: "xai", method: "chat", name: "xAI Grok" },
  { defaultModel: "gpt-4o", id: "github-copilot", method: "chat", name: "GitHub Copilot" },
  {
    defaultModel: "@cf/meta/llama-3.1-8b-instruct",
    id: "cloudflare",
    method: "chat",
    name: "Cloudflare Workers AI",
  },
  { defaultModel: "gpt-4o", id: "custom", method: "chat", name: "Custom (OpenAI-compatible)" },
];

function createReadline() {
  return createInterface({ input: process.stdin, output: process.stdout });
}

/** 校验 API Key 格式，返回 null 表示通过，否则返回错误提示 */
export function validateApiKeyFormat(providerId: string, key: string): string | null {
  const patterns: Record<string, RegExp> = {
    anthropic: /^sk-ant-[A-Za-z0-9]{20,}$/,
    google: /^AIza[0-9A-Za-z_-]{10,}$/,
    openai: /^sk-(proj-)?[A-Za-z0-9]{20,}$/,
  };
  const pattern = patterns[providerId];
  if (pattern && !pattern.test(key)) {
    const hints: Record<string, string> = {
      anthropic: "Anthropic API Key 应以 'sk-ant-' 开头",
      google: "Google API Key 应以 'AIza' 开头",
      openai: "OpenAI API Key 应以 'sk-' 开头",
    };
    return hints[providerId] || "API Key 格式异常，请检查";
  }
  return null;
}

/** 校验菜单选项编号，无效时返回 fallback */
export function validateChoice(input: string, min: number, max: number, fallback: number): number {
  const n = parseInt(input, 10);
  if (isNaN(n) || n < min || n > max) {
    return fallback;
  }
  return n;
}

export async function setupCommand(): Promise<void> {
  const rl = createReadline();

  try {
    console.log("\n  \x1b[1m╭──────────────────────────────────╮\x1b[0m");
    console.log("  \x1b[1m│   Crab CLI 交互式配置向导          │\x1b[0m");
    console.log("  \x1b[1m╰──────────────────────────────────╯\x1b[0m\n");

    const configPath = getGlobalConfigPath();

    // 已有配置检测
    if (fs.existsSync(configPath)) {
      console.log(`  检测到已有配置: ${configPath}`);
      const overwrite = await rl.question("  是否覆盖配置？(y/N): ");
      if (overwrite.toLowerCase() !== "y") {
        console.log("\n  配置已取消。\n");
        process.exit(0);
      }
    }

    // Provider 选择
    console.log("\n  选择 AI Provider:\n");
    for (let i = 0; i < PROVIDERS.length; i++) {
      const p = PROVIDERS[i]!;
      console.log(`    ${i + 1}. ${p.name} (\x1b[2m${p.id}\x1b[0m)`);
    }
    console.log();

    const choice = validateChoice(
      (await rl.question(`  请输入选项编号 (1-${PROVIDERS.length}) [1]: `)).trim(),
      1,
      PROVIDERS.length,
      1,
    );
    const selected = PROVIDERS[choice - 1]!;

    // 根据不同 Provider 类型收集配置
    let apiKey = "";
    let baseURL: string | undefined;
    let providerConfig: Record<string, Partial<SingleProviderConfig>>;

    // 查找扩展 Provider 元信息
    const extMeta = EXTENDED_PROVIDERS.find((p) => p.id === selected.id);

    if (selected.id === "github-copilot") {
      // GitHub Copilot: OAuth Device Flow
      console.log("\n  \x1b[36mℹ\x1b[0m GitHub Copilot 使用 OAuth Device Flow 认证。\n");
      console.log("  正在发起授权请求...");
      try {
        const { accessToken, expiresAt } = await getCopilotToken();
        console.log("  \x1b[32m✓\x1b[0m GitHub 授权成功!");

        // 交换 Copilot session token
        console.log("  正在获取 Copilot session token...");
        const sessionToken = await exchangeCopilotToken(accessToken);
        console.log("  \x1b[32m✓\x1b[0m Copilot token 获取成功!");

        apiKey = sessionToken.token;
        const copilotConfig = createCopilotConfig(sessionToken.token, selected.defaultModel);
        providerConfig = { [selected.id]: copilotConfig };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.log(`  \x1b[31m✗\x1b[0m GitHub Copilot 授权失败: ${msg}`);
        console.log("  配置已取消。");
        process.exit(1);
      }
    } else if (selected.id === "bedrock") {
      // AWS Bedrock: AWS 凭证
      console.log();
      const region = (await rl.question("  AWS Region [us-east-1]: ")).trim() || "us-east-1";
      const accessKeyId = (await rl.question("  AWS Access Key ID: ")).trim();
      const secretAccessKey = (await rl.question("  AWS Secret Access Key: ")).trim();

      if (!accessKeyId || !secretAccessKey) {
        console.log("\n  \x1b[31m✗\x1b[0m AWS 凭证不能为空。配置已取消。\n");
        process.exit(1);
      }

      apiKey = accessKeyId;
      const bedrockConfig = createBedrockConfig(region, accessKeyId, secretAccessKey, selected.defaultModel);
      providerConfig = {
        [selected.id]: { ...bedrockConfig, authType: "aws", aws: { region, accessKeyId, secretAccessKey } },
      };
    } else if (selected.id === "azure") {
      // Azure OpenAI: resourceName + apiKey
      console.log();
      const resourceName = (await rl.question("  Azure Resource Name: ")).trim();
      const azureApiKey = (await rl.question("  Azure API Key: ")).trim();
      const deployment =
        (await rl.question(`  Deployment Name [${selected.defaultModel}]: `)).trim() || selected.defaultModel;

      if (!resourceName || !azureApiKey) {
        console.log("\n  \x1b[31m✗\x1b[0m Resource Name 和 API Key 不能为空。配置已取消。\n");
        process.exit(1);
      }

      apiKey = azureApiKey;
      const azureConfig = createAzureConfig(resourceName, azureApiKey, deployment);
      providerConfig = { [selected.id]: azureConfig };
    } else if (selected.id === "cloudflare") {
      // Cloudflare Workers AI: accountId + API Key
      console.log();
      const accountId = (await rl.question("  Cloudflare Account ID: ")).trim();
      apiKey = (await rl.question("  Cloudflare API Key: ")).trim();

      if (!accountId || !apiKey) {
        console.log("\n  \x1b[31m✗\x1b[0m Account ID 和 API Key 不能为空。配置已取消。\n");
        process.exit(1);
      }

      providerConfig = { [selected.id]: createCloudflareConfig(accountId, apiKey, selected.defaultModel) };
    } else if (selected.id === "openrouter" || selected.id === "xai") {
      // OpenRouter / xAI: API Key
      console.log();
      apiKey = (await rl.question(`  ${selected.name} API Key: `)).trim();
      if (!apiKey) {
        const skip = (await rl.question("  未填写 API Key，继续保存不可用配置？(y/N): ")).trim().toLowerCase();
        if (skip !== "y") {
          console.log("\n  配置已取消。请准备 API Key 后重新运行 crab setup。\n");
          process.exit(1);
        }
      }

      if (selected.id === "openrouter") {
        providerConfig = { [selected.id]: createOpenRouterConfig(apiKey, selected.defaultModel) };
      } else {
        providerConfig = { [selected.id]: createXaiConfig(apiKey, selected.defaultModel) };
      }
    } else {
      // 标准 Provider（OpenAI / Anthropic / Google / DeepSeek / Custom）
      console.log();
      apiKey = (await rl.question(`  ${selected.name} API Key: `)).trim();
      if (apiKey) {
        const validationError = validateApiKeyFormat(selected.id, apiKey);
        if (validationError) {
          console.log(`  \x1b[33m⚠\x1b[0m ${validationError}`);
          const force = (await rl.question("  是否仍然使用此值？(y/N): ")).trim().toLowerCase();
          if (force !== "y") {
            console.log("\n  配置已取消。请准备有效的 API Key 后重新运行 crab setup。\n");
            process.exit(1);
          }
        }
      } else {
        const skip = (await rl.question("  未填写 API Key，继续保存不可用配置？(y/N): ")).trim().toLowerCase();
        if (skip !== "y") {
          console.log("\n  配置已取消。请准备 API Key 后重新运行 crab setup。\n");
          process.exit(1);
        }
      }

      // Base URL(custom provider)
      if (selected.id === "custom") {
        const url = (await rl.question("  Base URL [https://api.openai.com/v1]: ")).trim();
        baseURL = url || "https://api.openai.com/v1";
      }

      providerConfig = {
        [selected.id]: {
          requestMethod: selected.method,
          ...(apiKey ? { apiKey } : {}),
          ...(baseURL ? { baseURL } : {}),
        },
      };
    }

    // 模型
    console.log();
    const model = (await rl.question(`  模型名称 [${selected.defaultModel}]: `)).trim() || selected.defaultModel;

    // 更新 providerConfig 中的 defaultModel
    if (providerConfig[selected.id]) {
      providerConfig[selected.id]!.defaultModel = model;
    }

    const config = AppConfigSchema.parse({
      defaultProvider: { model, provider: selected.id },
      providerConfig,
    });

    // 确保目录存在
    const configDir = path.dirname(configPath);
    try {
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
    } catch (error) {
      writeCliError(
        createCliError({
          cause: error,
          context: { configDir },
          kind: "write-failed",
          message: `无法创建配置目录: ${configDir}`,
        }),
        { includeCause: true },
      );
      process.exit(1);
    }

    // 保存
    console.log("\n  正在保存配置...");
    const success = await saveConfig(config);

    if (success) {
      console.log("\n  \x1b[32m✓\x1b[0m 配置已保存!");
      console.log(`    Provider: \x1b[1m${selected.name}\x1b[0m`);
      console.log(`    Model:    \x1b[1m${model}\x1b[0m`);
      if (!apiKey && !baseURL) {
        console.log("    状态:     未配置真实连接信息，AI 调用前仍需补充 API Key 或 Base URL");
      }
      console.log(`    配置文件: ${configPath}`);
      console.log("\n  运行 \x1b[1mcrab\x1b[0m 即可启动 TUI 界面。\n");
    } else {
      writeCliError(
        createCliError({
          context: { configPath, operation: "setup.saveConfig" },
          kind: "write-failed",
          message: "\n  \x1b[31m✗\x1b[0m 配置保存失败，请检查日志。",
        }),
      );
      process.exit(1);
    }
  } finally {
    rl.close();
  }
}
