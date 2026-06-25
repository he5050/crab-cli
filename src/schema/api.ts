/**
 * API Provider Schema
 *
 * 职责:
 *   - 定义支持的 API Provider 枚举
 *   - 供配置校验使用
 *
 * 边界:
 *   1. 仅定义 Provider 枚举，不涉及 API 调用实现
 *   2. API 请求/响应/消息类型直接使用 Vercel AI SDK 原生类型
 *   3. 使用 Zod 进行运行时类型验证
 *
 * 历史变更:
 *   - v0.2: 移除已废弃的 ApiConfig/AiMessage/ApiRequest/ApiResponse，
 *           项目全面使用 AI SDK (@ai-sdk/*, ai) 的原生类型。
 */
import { z } from "zod";

/** API 提供商 */
export const ApiProvider = z.enum(["openai", "anthropic", "google", "ollama", "custom"]);
export type ApiProvider = z.infer<typeof ApiProvider>;
