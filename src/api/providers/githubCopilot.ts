/**
 * GitHub Copilot Provider 适配器 — GitHub Copilot Chat API。
 *
 * 职责:
 *   - 提供 GitHub Copilot 的 OAuth 认证流程
 *   - 使用 Device Flow 获取 token
 *   - 通过 api.githubcopilot.com 调用模型
 *
 * 使用场景:
 *   - 通过 GitHub Copilot 访问多种 LLM
 *   - 配置向导中选择 GitHub Copilot 作为 Provider
 *
 * 边界:
 *   1. 认证方式: OAuth Device Flow
 *   2. Token 端点: https://github.com/login/oauth/access_token
 *   3. API 端点: https://api.githubcopilot.com
 *   4. 需要 client_id（GitHub Copilot 插件 ID）
 *   5. 协议兼容 OpenAI Chat API
 */
import type { SingleProviderConfig } from "@/schema/config";
import type { ProviderOAuthConfig } from "../auth/oauthStore";

/** GitHub Copilot OAuth 配置 */
export const COPILOT_OAUTH_CONFIG: ProviderOAuthConfig = {
  authorizeUrl: "https://github.com/login/oauth/authorize",
  clientId: "Iv1.b507a08c87ecfe98",
  scopes: ["read:user"],
  tokenUrl: "https://github.com/login/oauth/access_token",
};

/** GitHub Copilot 默认配置 */
export const COPILOT_DEFAULTS = {
  baseURL: "https://api.githubcopilot.com",
  defaultModel: "gpt-4o",
  requestMethod: "chat" as const,
};

/** GitHub Copilot 模型列表 */
export const COPILOT_MODELS = ["gpt-4o", "gpt-4o-mini", "claude-3.5-sonnet", "o1", "o1-mini", "gemini-2.0-flash"];

/**
 * GitHub Copilot Device Flow — 设备授权流程。
 *
 * 流程:
 *   1. 请求 device code
 *   2. 用户在浏览器中输入 user_code
 *   3. 轮询 token 端点获取 access_token
 *
 * @returns device code 信息
 */
export async function requestDeviceCode(): Promise<{
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}> {
  const response = await fetch("https://github.com/login/device/code", {
    body: new URLSearchParams({
      client_id: COPILOT_OAUTH_CONFIG.clientId,
      scope: COPILOT_OAUTH_CONFIG.scopes.join(" "),
    }),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`请求 device code 失败: ${response.status}`);
  }

  const data = (await response.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  };

  return {
    deviceCode: data.device_code,
    expiresIn: data.expires_in,
    interval: data.interval,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
  };
}

/**
 * 轮询获取 token。
 *
 * @param deviceCode - device code
 * @param interval - 轮询间隔（秒）
 * @param timeoutMs - 超时时间（毫秒）
 * @returns access token
 */
export async function pollForToken(
  deviceCode: string,
  interval: number,
  timeoutMs: number = 5 * 60 * 1000,
): Promise<{ accessToken: string; expiresAt?: number }> {
  const startTime = Date.now();

  for (;;) {
    if (Date.now() - startTime > timeoutMs) {
      throw new Error("Device flow 超时");
    }

    await new Promise((resolve) => setTimeout(resolve, interval * 1000));

    const response = await fetch(COPILOT_OAUTH_CONFIG.tokenUrl, {
      body: new URLSearchParams({
        client_id: COPILOT_OAUTH_CONFIG.clientId,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    });

    const data = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
      interval?: number;
    };

    if (data.access_token) {
      return {
        accessToken: data.access_token,
        expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      };
    }

    if (data.error === "authorization_pending") {
      continue;
    }

    if (data.error === "slow_down") {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      continue;
    }

    if (data.error === "expired_token") {
      throw new Error("Device code 已过期，请重新发起授权");
    }

    if (data.error === "access_denied") {
      throw new Error("用户拒绝了授权");
    }

    throw new Error(`Device flow 错误: ${data.error} — ${data.error_description ?? ""}`);
  }
}

/**
 * 获取 GitHub Copilot token（通过 device flow）。
 *
 * @returns access token
 */
export async function getCopilotToken(): Promise<{ accessToken: string; expiresAt?: number }> {
  const deviceCode = await requestDeviceCode();

  console.log(`\n  请在浏览器中访问: ${deviceCode.verificationUri}`);
  console.log(`  输入授权码: ${deviceCode.userCode}\n`);

  return pollForToken(deviceCode.deviceCode, deviceCode.interval);
}

/**
 * 构建 GitHub Copilot API 认证头。
 *
 * Copilot token 需要通过 /copilot_internal/v2/token 端点交换为 session token。
 *
 * @param githubToken - GitHub OAuth token
 * @returns Copilot session token
 */
export async function exchangeCopilotToken(githubToken: string): Promise<{
  token: string;
  expiresAt: number;
}> {
  const response = await fetch("https://api.github.com/copilot_internal/v2/token", {
    headers: {
      Authorization: `token ${githubToken}`,
      "Editor-Version": "vscode/1.85.0",
      "Editor-Plugin-Version": "copilot-chat/0.12.0",
    },
  });

  if (!response.ok) {
    throw new Error(`交换 Copilot token 失败: ${response.status}`);
  }

  const data = (await response.json()) as {
    token: string;
    expires_at: number;
  };

  return {
    expiresAt: data.expires_at * 1000,
    token: data.token,
  };
}

/** GitHub Copilot Provider 配置工厂 */
export function createCopilotConfig(accessToken: string, model?: string): Partial<SingleProviderConfig> {
  return {
    apiKey: accessToken,
    baseURL: COPILOT_DEFAULTS.baseURL,
    customHeaders: {
      "Editor-Version": "vscode/1.85.0",
      "Editor-Plugin-Version": "copilot-chat/0.12.0",
      "Copilot-Integration-Id": "vscode-chat",
    },
    defaultModel: model ?? COPILOT_DEFAULTS.defaultModel,
    modelList: COPILOT_MODELS,
    requestMethod: COPILOT_DEFAULTS.requestMethod,
  };
}
