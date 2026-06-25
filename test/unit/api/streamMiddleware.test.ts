import { describe, expect, it, beforeEach } from "bun:test";
import {
  StreamMiddlewarePipeline,
  createSensitiveWordFilter,
  createEventLogger,
  createEventCounter,
  getGlobalMiddlewarePipeline,
  clearGlobalMiddlewarePipeline,
  wrapStreamWithMiddleware,
  type LlmStreamEvent,
  type StreamMiddlewareContext,
} from "@/api";

async function* makeStream(events: LlmStreamEvent[]): AsyncGenerator<LlmStreamEvent> {
  for (const e of events) yield e;
}

describe("StreamMiddlewarePipeline", () => {
  let pipeline: StreamMiddlewarePipeline;

  beforeEach(() => {
    pipeline = new StreamMiddlewarePipeline();
  });

  it("passes events through when no middleware registered", async () => {
    const input = [{ type: "text-delta", text: "hello" } as const];
    const output: LlmStreamEvent[] = [];
    for await (const e of pipeline.process(makeStream(input), { providerId: "test", modelId: "test" })) {
      output.push(e);
    }
    expect(output).toEqual(input);
  });

  it("applies middleware in priority order", async () => {
    const order: string[] = [];

    pipeline
      .use({
        name: "low",
        priority: 0,
        async *handler(_event, next) {
          order.push("low-start");
          yield* next();
          order.push("low-end");
        },
      })
      .use({
        name: "high",
        priority: 10,
        async *handler(_event, next) {
          order.push("high-start");
          yield* next();
          order.push("high-end");
        },
      });

    const input = [{ type: "text-delta", text: "x" } as const];
    for await (const _ of pipeline.process(makeStream(input), { providerId: "test", modelId: "test" })) {
    }

    expect(order).toEqual(["high-start", "low-start", "low-end", "high-end"]);
  });

  it("can filter events by not calling next", async () => {
    pipeline.use({
      name: "filter-text",
      priority: 5,
      async *handler(event, next) {
        if (event.type === "text-delta") return;
        yield* next();
      },
    });

    const input: LlmStreamEvent[] = [
      { type: "text-delta", text: "skip" },
      { type: "reasoning-delta", text: "keep" },
    ];
    const output: LlmStreamEvent[] = [];
    for await (const e of pipeline.process(makeStream(input), { providerId: "test", modelId: "test" })) {
      output.push(e);
    }
    expect(output).toEqual([{ type: "reasoning-delta", text: "keep" }]);
  });

  it("can modify events", async () => {
    pipeline.use({
      name: "uppercase",
      priority: 5,
      async *handler(event, next) {
        if (event.type === "text-delta") {
          yield { ...event, text: event.text.toUpperCase() };
          return;
        }
        yield* next();
      },
    });

    const input = [{ type: "text-delta", text: "hello" } as const];
    const output: LlmStreamEvent[] = [];
    for await (const e of pipeline.process(makeStream(input), { providerId: "test", modelId: "test" })) {
      output.push(e);
    }
    expect(output).toEqual([{ type: "text-delta", text: "HELLO" }]);
  });

  it("clears all middleware", async () => {
    pipeline.use({
      name: "test",
      priority: 0,
      async *handler(event, next) {
        yield { ...event, text: "modified" };
      },
    });
    pipeline.clear();

    const input = [{ type: "text-delta", text: "original" } as const];
    const output: LlmStreamEvent[] = [];
    for await (const e of pipeline.process(makeStream(input), { providerId: "test", modelId: "test" })) {
      output.push(e);
    }
    expect(output).toEqual(input);
  });
});

describe("createSensitiveWordFilter", () => {
  it("replaces sensitive words in text-delta", async () => {
    const pipeline = new StreamMiddlewarePipeline();
    pipeline.use(createSensitiveWordFilter(["bad", "evil"], "***"));

    const input: LlmStreamEvent[] = [{ type: "text-delta", text: "this is bad and evil" }];
    const output: LlmStreamEvent[] = [];
    for await (const e of pipeline.process(makeStream(input), { providerId: "test", modelId: "test" })) {
      output.push(e);
    }
    expect(output).toEqual([{ type: "text-delta", text: "this is *** and ***" }]);
  });

  it("does not modify reasoning-delta", async () => {
    const pipeline = new StreamMiddlewarePipeline();
    pipeline.use(createSensitiveWordFilter(["bad"], "***"));

    const input: LlmStreamEvent[] = [{ type: "reasoning-delta", text: "bad thought" }];
    const output: LlmStreamEvent[] = [];
    for await (const e of pipeline.process(makeStream(input), { providerId: "test", modelId: "test" })) {
      output.push(e);
    }
    expect(output).toEqual([{ type: "reasoning-delta", text: "bad thought" }]);
  });
});

describe("createEventLogger", () => {
  it("logs events without modifying them", async () => {
    const logged: LlmStreamEvent[] = [];
    const pipeline = new StreamMiddlewarePipeline();
    pipeline.use(createEventLogger((event) => logged.push(event)));

    const input: LlmStreamEvent[] = [
      { type: "text-delta", text: "hello" },
      { type: "done", fullText: "hello world" },
    ];
    const output: LlmStreamEvent[] = [];
    for await (const e of pipeline.process(makeStream(input), { providerId: "test", modelId: "test" })) {
      output.push(e);
    }
    expect(output).toEqual(input);
    expect(logged).toEqual(input);
  });
});

describe("createEventCounter", () => {
  it("counts events by type", async () => {
    const pipeline = new StreamMiddlewarePipeline();
    const counter = createEventCounter();
    pipeline.use(counter);

    const input: LlmStreamEvent[] = [
      { type: "text-delta", text: "a" },
      { type: "text-delta", text: "b" },
      { type: "done", fullText: "ab" },
    ];
    for await (const _ of pipeline.process(makeStream(input), { providerId: "test", modelId: "test" })) {
    }
  });
});

describe("global pipeline", () => {
  beforeEach(() => {
    clearGlobalMiddlewarePipeline();
  });

  it("wraps streams with global pipeline", async () => {
    const pipeline = getGlobalMiddlewarePipeline();
    pipeline.use({
      name: "global",
      priority: 5,
      async *handler(event, next) {
        if (event.type === "text-delta") {
          yield { ...event, text: `[GLOBAL]${event.text}` };
          return;
        }
        yield* next();
      },
    });

    const input = [{ type: "text-delta", text: "test" } as const];
    const output: LlmStreamEvent[] = [];
    for await (const e of wrapStreamWithMiddleware(makeStream(input), { providerId: "test", modelId: "test" })) {
      output.push(e);
    }
    expect(output).toEqual([{ type: "text-delta", text: "[GLOBAL]test" }]);
  });
});
