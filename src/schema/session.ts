/**
 * 会话相关 Zod Schema
 *
 * 职责:
 *   - 定义会话和消息的结构验证
 *   - 支持消息角色、类型和内容验证
 *   - 提供会话状态和元数据管理
 *
 * 模块功能:
 *   - 定义消息角色枚举(MessageRole):system、user、assistant、tool
 *   - 定义消息部分类型枚举(PartType):text、tool_use、tool_result
 *   - 定义消息部分 Schema(MessagePart):类型、内容、工具调用信息
 *   - 定义消息 Schema(Message):ID、角色、部分数组、创建时间
 *   - 定义会话状态枚举(SessionStatus):active、paused、completed、error
 *   - 定义会话 Schema(Session):完整会话信息包含消息列表
 *   - 定义会话列表项 Schema(SessionListItem):轻量版不含消息内容
 *
 * 使用场景:
 *   - 验证会话数据存储格式
 *   - 验证消息结构和内容
 *   - 会话列表展示(使用轻量版)
 *   - 会话状态管理和切换
 *
 * 边界:
 *   1. 仅定义 schema，不涉及持久化操作
 *   2. 消息 ID 必须符合 ULID 格式(ses_/msg_ 前缀)
 *   3. 使用 Zod 进行运行时类型验证
 *   4. 不处理会话的业务逻辑
 *
 * 流程:
 *   1. 定义消息角色和类型枚举
 *   2. 定义消息部分和消息 Schema
 *   3. 定义会话状态和会话 Schema
 *   4. 定义轻量版会话列表项 Schema
 */
import { z } from "zod";
import { SessionID, MessageID, ToolCallID } from "@/schema/ids";

/** 消息角色 */
export const MessageRole = z.enum(["system", "user", "assistant", "tool"]);
export type MessageRole = z.infer<typeof MessageRole>;

/** 消息部分类型 */
export const PartType = z.enum(["text", "tool_use", "tool_result"]);
export type PartType = z.infer<typeof PartType>;

/** 消息部分 Schema */
export const MessagePart = z.object({
  content: z.string(),
  result: z.unknown().optional(),
  tool_name: z.string().optional(),
  tool_use_id: ToolCallID.optional(),
  type: PartType,
});
export type MessagePart = z.infer<typeof MessagePart>;

/** 消息 Schema */
export const Message = z
  .object({
    created_at: z.number(),
    id: MessageID,
    parts: z.array(MessagePart),
    role: MessageRole,
  })
  .strict();
export type Message = z.infer<typeof Message>;

/** 会话状态 */
export const SessionStatus = z.enum(["active", "paused", "completed", "error"]);
export type SessionStatus = z.infer<typeof SessionStatus>;

/** 会话 Schema */
export const Session = z
  .object({
    created_at: z.number(),
    id: SessionID,
    messages: z.array(Message),
    model: z.string().optional(),
    status: SessionStatus,
    title: z.string(),
    updated_at: z.number(),
  })
  .strict();
export type Session = z.infer<typeof Session>;

/** 会话列表项(轻量版，不含消息) */
export const SessionListItem = z
  .object({
    created_at: z.number(),
    id: SessionID,
    message_count: z.number(),
    status: SessionStatus,
    title: z.string(),
    updated_at: z.number(),
  })
  .strict();
export type SessionListItem = z.infer<typeof SessionListItem>;
