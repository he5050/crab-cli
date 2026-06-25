/**
 * AWS Bedrock Provider 适配器 — AWS 托管的 LLM 服务。
 *
 * 职责:
 *   - 提供 AWS Bedrock 的认证（SigV4 签名）
 *   - 支持 Anthropic Claude / Meta Llama / Mistral 等
 *   - 手动 SigV4 签名（不依赖 aws-sdk）
 *
 * 使用场景:
 *   - 通过 AWS Bedrock 访问 Claude / Llama 等模型
 *   - 配置向导中选择 Bedrock 作为 Provider
 *
 * 边界:
 *   1. 认证方式: AWS SigV4 签名
 *   2. 服务名称: bedrock（InvokeModel）或 bedrock-runtime
 *   3. 需要 AWS region / accessKeyId / secretAccessKey
 *   4. 通过手动 SigV4 签名，不依赖 @aws-sdk
 */
import crypto from "node:crypto";
import type { SingleProviderConfig } from "@/schema/config";

/** Bedrock 默认配置 */
export const BEDROCK_DEFAULTS = {
  defaultModel: "anthropic.claude-3-5-sonnet-20241022-v2:0",
  requestMethod: "chat" as const,
  service: "bedrock",
};

/** Bedrock 模型列表 */
export const BEDROCK_MODELS = [
  "anthropic.claude-3-5-sonnet-20241022-v2:0",
  "anthropic.claude-3-5-haiku-20241022-v1:0",
  "anthropic.claude-3-opus-20240229-v1:0",
  "meta.llama3-3-70b-instruct-v1:0",
  "meta.llama3-1-405b-instruct-v1:0",
  "mistral.mistral-large-2407-v1:0",
  "amazon.nova-pro-v1:0",
  "amazon.nova-lite-v1:0",
];

/** AWS 凭证 */
export interface AwsCredentials {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

/**
 * 构建 AWS SigV4 签名。
 *
 * @param credentials - AWS 凭证
 * @param method - HTTP 方法
 * @param url - 完整 URL
 * @param body - 请求体
 * @param headers - 额外请求头
 * @returns 签名后的请求头
 */
export function signSigV4(
  credentials: AwsCredentials,
  method: string,
  url: string,
  body: string,
  headers: Record<string, string> = {},
): Record<string, string> {
  const { region, accessKeyId, secretAccessKey, sessionToken } = credentials;
  const parsedUrl = new URL(url);
  const host = parsedUrl.hostname;
  const path = parsedUrl.pathname;
  const query = parsedUrl.search.slice(1);

  const service = BEDROCK_DEFAULTS.service;
  const timestamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = timestamp.slice(0, 8);

  // 规范请求
  const canonicalHeaders = Object.entries({
    host,
    "x-amz-date": timestamp,
    ...(sessionToken ? { "x-amz-security-token": sessionToken } : {}),
    ...headers,
  })
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v.trim()}\n`)
    .join("");

  const signedHeaders = Object.entries({
    host,
    "x-amz-date": timestamp,
    ...(sessionToken ? { "x-amz-security-token": sessionToken } : {}),
    ...headers,
  })
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k]) => k)
    .join(";");

  const payloadHash = crypto.createHash("sha256").update(body).digest("hex");

  const canonicalRequest = [method.toUpperCase(), path, query, canonicalHeaders, signedHeaders, payloadHash].join("\n");

  // 待签字符串
  const credentialScope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    timestamp,
    credentialScope,
    crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  // 计算签名
  const kDate = hmac(`AWS4${secretAccessKey}`, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = hmac(kSigning, stringToSign).toString("hex");

  // 构建授权头
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    Authorization: authorization,
    "x-amz-date": timestamp,
    ...(sessionToken ? { "x-amz-security-token": sessionToken } : {}),
    ...headers,
  };
}

/** HMAC-SHA256 辅助函数 */
function hmac(key: string | Buffer, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

/**
 * 构建 Bedrock InvokeModel URL。
 *
 * @param region - AWS 区域
 * @param modelId - 模型 ID
 * @returns 完整 URL
 */
export function buildBedrockUrl(region: string, modelId: string): string {
  const encodedModelId = encodeURIComponent(modelId);
  return `https://bedrock-runtime.${region}.amazonaws.com/model/${encodedModelId}/invoke`;
}

/** Bedrock Provider 配置工厂 */
export function createBedrockConfig(
  region: string,
  accessKeyId: string,
  secretAccessKey: string,
  model?: string,
): Partial<SingleProviderConfig> {
  const selectedModel = model ?? BEDROCK_DEFAULTS.defaultModel;
  return {
    apiKey: accessKeyId, // 复用 apiKey 字段存储 accessKeyId
    baseURL: `https://bedrock-runtime.${region}.amazonaws.com`,
    customHeaders: {
      "x-amz-region": region,
    },
    defaultModel: selectedModel,
    modelList: BEDROCK_MODELS,
    requestMethod: BEDROCK_DEFAULTS.requestMethod,
  };
}
