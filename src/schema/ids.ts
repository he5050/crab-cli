/**
 * 品牌化 ID 的 Zod Schema
 *
 * 职责:
 *   - 提供 ID 验证 schema，确保类型安全
 *   - 支持多种 ID 类型(会话、消息、部分、工具调用)
 *   - 使用 ULID 格式保证 ID 的唯一性和可排序性
 *
 * 模块功能:
 *   - 定义会话 ID Schema(SessionID):ses_ 前缀 + 26 位 ULID
 *   - 定义消息 ID Schema(MessageID):msg_ 前缀 + 26 位 ULID
 *   - 定义消息部分 ID Schema(PartID):prt_ 前缀 + 26 位 ULID
 *   - 定义工具调用 ID Schema(ToolCallID):tool_ 前缀 + 26 位 ULID
 *   - 定义通用品牌化 ID Schema(BrandedId):任意前缀 + 26 位 ULID
 *
 * 使用场景:
 *   - 验证会话、消息、工具调用等 ID 格式
 *   - 确保 ID 类型安全，防止混用不同类型 ID
 *   - 解析和验证 ULID 格式的字符串
 *
 * 边界:
 *   1. 仅定义 schema，不生成 ID
 *   2. ID 生成由 @core/id 模块实现
 *   3. 使用 Zod 进行运行时类型验证
 *
 * 流程:
 *   1. 定义各类型 ID 的正则表达式模式
 *   2. 使用 z.string().regex() 创建验证 Schema
 *   3. 在业务逻辑中使用 Schema 验证 ID 格式
 *   4. 导出 Schema 供其他模块使用
 */
import { z } from "zod";

/** 会话 ID schema — ses_ 开头 */
export const SessionID = z.string().regex(/^ses_[0-9A-HJKMNP-TV-Z]{26}$/);

/** 消息 ID schema — msg_ 开头 */
export const MessageID = z.string().regex(/^msg_[0-9A-HJKMNP-TV-Z]{26}$/);

/** 消息部分 ID schema — prt_ 开头 */
export const PartID = z.string().regex(/^prt_[0-9A-HJKMNP-TV-Z]{26}$/);

/** 工具调用 ID schema — tool_ 开头 */
export const ToolCallID = z.string().regex(/^tool_[0-9A-HJKMNP-TV-Z]{26}$/);

/** 通用品牌化 ID schema — 任意前缀 */
export const BrandedId = z.string().regex(/^[a-z]+_[0-9A-HJKMNP-TV-Z]{26}$/);
