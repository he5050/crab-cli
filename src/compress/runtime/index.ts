/**
 * Runtime — 运行时调度和触发
 */
export { shouldAutoCompress, performAutoCompression } from "./autoCompress";

export { SubAgentCompressor, subAgentCompressor } from "./subAgentCompressor";

export { compressionQueue } from "./compressionQueue";

export type { MessageCompressor } from "@/conversation/core/llmLoop";
