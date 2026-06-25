/**
 * 流中间件机制 — 允许在流处理管道中拦截和转换事件。
 *
 * 职责:
 *   - 定义流中间件接口和管道
 *   - 支持文本过滤、敏感词替换、内容审计等场景
 *   - 提供中间件组合和链式调用
 *
 * 使用场景:
 *   - 敏感词过滤和替换
 *   - 文本内容审计
 *   - 流事件日志记录
 *   - 内容格式转换
 *
 * 流程:
 *   1. 中间件按注册顺序组成管道
 *   2. 每个中间件接收事件和 next 函数
 *   3. 中间件可以修改、过滤或阻断事件
 *   4. 调用 next() 将事件传递给下一个中间件
 *   5. 不调用 next() 则阻断后续处理
 */
import type { LlmStreamEvent } from "../core/llm";

export type StreamEventType = LlmStreamEvent["type"];

export interface StreamMiddlewareContext {
  providerId: string;
  modelId: string;
  sessionId?: string;
  requestId?: string;
}

export interface StreamMiddleware {
  name: string;
  priority?: number;
  handler: (
    event: LlmStreamEvent,
    next: () => AsyncGenerator<LlmStreamEvent | null>,
    context: StreamMiddlewareContext,
  ) => AsyncGenerator<LlmStreamEvent | null>;
}

function compareMiddleware(a: StreamMiddleware, b: StreamMiddleware): number {
  return (b.priority ?? 0) - (a.priority ?? 0);
}

export class StreamMiddlewarePipeline {
  private middlewares: StreamMiddleware[] = [];

  use(middleware: StreamMiddleware): this {
    this.middlewares.push(middleware);
    this.middlewares.sort(compareMiddleware);
    return this;
  }

  clear(): this {
    this.middlewares = [];
    return this;
  }

  getMiddlewares(): StreamMiddleware[] {
    return [...this.middlewares];
  }

  async *process(
    source: AsyncGenerator<LlmStreamEvent>,
    context: StreamMiddlewareContext,
  ): AsyncGenerator<LlmStreamEvent> {
    if (this.middlewares.length === 0) {
      yield* source;
      return;
    }

    // 捕获当前中间件列表的快照，避免后续修改影响正在进行的流处理
    const middlewaresSnapshot = [...this.middlewares];

    for await (const event of source) {
      let current = event;

      // 创建递归处理函数，使用闭包正确捕获索引和中间件快照
      const runMiddlewareChain = async function* (
        index: number,
        ev: LlmStreamEvent,
      ): AsyncGenerator<LlmStreamEvent | null> {
        // 所有中间件已执行完毕，返回最终事件
        if (index >= middlewaresSnapshot.length) {
          yield ev;
          return;
        }

        const mw = middlewaresSnapshot[index];
        if (!mw) {
          yield ev;
          return;
        }

        // 创建 next 函数，传递正确的下一个索引
        const next = () => runMiddlewareChain(index + 1, ev);

        // 执行当前中间件
        for await (const result of mw.handler(ev, next, context)) {
          if (result !== null) {
            yield result;
          }
        }
      };

      // 从第一个中间件开始执行链式调用
      for await (const result of runMiddlewareChain(0, current)) {
        if (result !== null) {
          yield result;
        }
      }
    }
  }
}

const globalPipeline = new StreamMiddlewarePipeline();

export function getGlobalMiddlewarePipeline(): StreamMiddlewarePipeline {
  return globalPipeline;
}

export function clearGlobalMiddlewarePipeline(): void {
  globalPipeline.clear();
}

export function wrapStreamWithMiddleware(
  source: AsyncGenerator<LlmStreamEvent>,
  context: StreamMiddlewareContext,
  pipeline?: StreamMiddlewarePipeline,
): AsyncGenerator<LlmStreamEvent> {
  const p = pipeline ?? globalPipeline;
  return p.process(source, context);
}

/** 转义正则表达式中的特殊字符，防止 regex injection */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

export function createSensitiveWordFilter(words: string[], replacement = "***"): StreamMiddleware {
  // 预编译正则表达式，避免每个 chunk 重复编译
  const patterns = words.map((word) => new RegExp(escapeRegExp(word), "g"));
  return {
    name: "sensitive-word-filter",
    priority: 10,
    async *handler(event, next) {
      if (event.type === "text-delta") {
        let text = event.text;
        for (const pattern of patterns) {
          text = text.replace(pattern, replacement);
        }
        if (text !== event.text) {
          yield { ...event, text } as LlmStreamEvent;
          return;
        }
      }
      yield* next();
    },
  };
}

export function createEventLogger(
  logFn: (event: LlmStreamEvent, context: StreamMiddlewareContext) => void,
): StreamMiddleware {
  return {
    name: "event-logger",
    priority: 0,
    async *handler(event, next, ctx) {
      logFn(event, ctx);
      yield* next();
    },
  };
}

export function createEventCounter(): StreamMiddleware & { getCounts: () => Record<StreamEventType, number> } {
  const counts: Record<StreamEventType, number> = {
    "text-delta": 0,
    "reasoning-delta": 0,
    "tool-call": 0,
    done: 0,
    error: 0,
  };

  return {
    name: "event-counter" as const,
    priority: 0,
    async *handler(event: LlmStreamEvent, next: () => AsyncGenerator<LlmStreamEvent | null>) {
      counts[event.type]++;
      yield* next();
    },
    getCounts: () => ({ ...counts }),
  };
}
