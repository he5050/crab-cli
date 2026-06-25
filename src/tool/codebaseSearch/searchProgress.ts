import type { ToolContext } from "@/tool/types";

/** 向工具上下文发送搜索元数据（如索引状态、耗时等） @param context 工具上下文 @param title 元数据标题 @param meta 附加元数据键值对 */
export function emitSearchMetadata(
  context: ToolContext | undefined,
  title: string,
  meta: Record<string, unknown>,
): void {
  context?.metadata?.(title, { tool: "codebase-search", ...meta });
}
