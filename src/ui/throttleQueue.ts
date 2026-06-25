/**
 * 节流队列 — UI 层兼容入口。
 *
 * 历史:此模块最初承载 ThrottleQueue 实现，位于 src/ui/throttleQueue.ts。
 * Phase 4 P1-14 将实现抽象到 src/core/throttle/throttleQueue.ts(通用基础设施)，
 * 此文件保留为 re-export 层，公共 API 签名不变。
 *
 * 边界:
 *   1. 不再包含实现细节(已下沉到 @core/throttleQueue facade)
 *   2. 旧 import 路径(@ui/throttleQueue)继续可用
 *   3. 新的调用方应直接使用 @core/throttleQueue
 */

export {
  ThrottlePriority,
  ThrottleQueue,
  createThrottleQueue,
  createLogThrottleQueue,
  createHighPriorityThrottleQueue,
  createThrottleDecorator,
} from "@/core/concurrency/throttleQueue";

export type { ThrottleItem, ThrottleConfig } from "@/core/concurrency/throttleQueue";
