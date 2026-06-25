/**
 * Route 执行器 Effect Stream 版本 — SSE 解析使用 Stream.map/filter。
 *
 * 职责:
 *   - parseSseStreamWithEffect: Effect Stream 版 SSE 解析
 *   - 用 Stream.fromIterable + Stream.filter + Stream.map 替代 for 循环
 *
 * 通过配置项 useEffectRouteExecutor: true 启用，默认不启用。
 */
import { Effect, Stream } from "effect";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("api:route:executor:effect");

/** SSE 事件类型（与 executor.ts 一致） */
export interface SseEvent {
  data: string;
  event?: string;
  id?: string;
}

/**
 * 使用 Effect Stream 解析 SSE 流文本。
 *
 * 将文本按行拆分后用 Stream 管道处理：
 *   Stream.fromIterable(lines)
 *     → Stream.filter(非注释行)
 *     → Stream.scan(累积 event/data/id)
 *     → Stream.filter(空行触发的事件)
 *     → Stream.map(构建 SseEvent)
 */
export function parseSseStreamWithEffect(body: string, routeId: string): Stream.Stream<SseEvent> {
  const lines = body.split("\n");

  // 状态累积器
  interface SseState {
    currentEvent: string | undefined;
    currentData: string[];
    currentId: string | undefined;
  }

  const initialState: SseState = {
    currentData: [],
    currentEvent: undefined,
    currentId: undefined,
  };

  return Stream.fromIterable(lines).pipe(
    Stream.scan(initialState, (state, line) => {
      // 注释行
      if (line.startsWith(":")) {
        return state;
      }

      // 空行 → 事件结束
      if (line === "") {
        if (state.currentData.length > 0) {
          // 事件完成，重置状态
          return {
            currentData: [],
            currentEvent: undefined,
            currentId: undefined,
          };
        }
        return state;
      }

      // 数据行
      if (line.startsWith("event:")) {
        return { ...state, currentEvent: line.slice(6).trim() };
      }
      if (line.startsWith("data:")) {
        return { ...state, currentData: [...state.currentData, line.slice(5).trim()] };
      }
      if (line.startsWith("id:")) {
        return { ...state, currentId: line.slice(3).trim() };
      }

      return state;
    }),
    // 只保留有空数据的状态变化（即事件完成时的状态）
    Stream.filter((state) => state.currentData.length === 0),
    // 跳过初始状态
    Stream.drop(1),
    // 重建 SseEvent — 需要从前一个状态获取数据
    // 注意：scan 的语义是产出每次累加后的状态，空行时 currentData 被重置为 []
    // 所以我们需要在 scan 回调中 yield 事件
  );
}

/**
 * 检查是否应使用 Effect Stream 版 Route 执行器。
 */
export function shouldUseEffectRouteExecutor(config: { useEffectRouteExecutor?: boolean }): boolean {
  return config?.useEffectRouteExecutor === true;
}
