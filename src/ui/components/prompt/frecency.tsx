/**
 * 频率/新鲜度 Hook 重新导出。
 *
 * 职责:
 *   - 提供 prompt 相关的频率/新鲜度排序
 *
 * 模块功能:
 *   - usePromptFrecency: 重新导出 useFrecency
 *
 * 使用场景:
 *   - prompt 自动补全排序
 *
 * 边界:
 *   1. 仅重新导出功能
 *   2. 详细实现见 @ui/hooks/useFrecency
 *
 * 流程:
 *   暂无
 */
export { useFrecency as usePromptFrecency } from "@/ui/hooks/useFrecency";
