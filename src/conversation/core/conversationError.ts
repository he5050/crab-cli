/**
 * ConversationError — 对话处理器的专用错误类型。
 *
 * 从 types/handler.ts 提取，归属 core 子域。
 */

export class ConversationError extends Error {
  constructor(
    message: string,
    public override readonly cause?: Error,
  ) {
    super(message);
    this.name = "ConversationError";
  }
}
