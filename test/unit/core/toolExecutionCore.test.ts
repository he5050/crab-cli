/**
 * 工具执行核心测试。
 *
 * 测试目标:
 *   - 验证 defineTool 定义与工具执行核心流程
 *
 * 测试用例:
 *   - 通过 defineTool 声明的工具可被调用
 *   - zod schema 校验生效
 *   - DEFAULT_CONFIG 在工具调用时的传递
 */
import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { DEFAULT_CONFIG } from "@/config";
import { defineTool } from "@/tool/types";
import { executeToolCore } from "@/tool/executor/toolExecutionCore";
import { executeSingleTool, type HandlerContext } from "@/conversation/core/toolExecution";

describe("toolExecutionCore", () => {
  test("validates args before executing the tool", async () => {
    const tool = defineTool({
      description: "Core validation success",
      execute: async (args) => `count:${args.count}`,
      name: "core_validation_success",
      parameters: z.object({ count: z.coerce.number().int() }),
      permission: "test",
    });

    const result = await executeToolCore({
      args: { count: "3" },
      fallbackTimeout: 1000,
      getConfig: () => DEFAULT_CONFIG,
      startTime: Date.now(),
      tool,
      toolName: tool.name,
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error(`expected success, got ${result.kind}`);
    }
    expect(result.args).toEqual({ count: 3 });
    expect(result.output).toBe("count:3");
  });

  test("returns validation failure without invoking the tool", async () => {
    let didExecute = false;
    const tool = defineTool({
      description: "Core validation failed",
      execute: async () => {
        didExecute = true;
        return "should not run";
      },
      name: "core_validation_failed",
      parameters: z.object({ count: z.number().int() }),
      permission: "test",
    });

    const result = await executeToolCore({
      args: { count: "bad" },
      fallbackTimeout: 1000,
      getConfig: () => DEFAULT_CONFIG,
      startTime: Date.now(),
      tool,
      toolName: tool.name,
    });

    expect(result.kind).toBe("validation_failed");
    if (result.kind !== "validation_failed") {
      throw new Error(`expected validation_failed, got ${result.kind}`);
    }
    expect(result.error).toContain("count");
    expect(didExecute).toBe(false);
  });

  test("normalizes execution exceptions", async () => {
    const tool = defineTool({
      description: "Core exception",
      execute: async () => {
        throw "core boom";
      },
      name: "core_exception",
      parameters: z.object({}),
      permission: "test",
    });

    const result = await executeToolCore({
      args: {},
      fallbackTimeout: 1000,
      getConfig: () => DEFAULT_CONFIG,
      startTime: Date.now(),
      tool,
      toolName: tool.name,
    });

    expect(result.kind).toBe("exception");
    if (result.kind !== "exception") {
      throw new Error(`expected exception, got ${result.kind}`);
    }
    expect(result.error).toBe("core boom");
  });

  test("executeSingleTool 接受前缀白名单匹配语义", async () => {
    const ctx: HandlerContext = {
      abortSignal: undefined,
      allowedTools: ["filesystem-"],
      config: DEFAULT_CONFIG,
      getToolContext: undefined,
      messages: [],
      modelId: undefined,
      permissionManager: {} as any,
      providerId: undefined,
      sessionId: "test",
      streamFn: (() => {
        throw new Error("streamFn should not be used in executeSingleTool test");
      }) as any,
      temperature: undefined,
      toolExecutor: {
        execute: async () => ({
          durationMs: 1,
          output: "ok",
          success: true,
          toolName: "filesystem-read",
        }),
      } as any,
      topP: undefined,
    };

    const result = await executeSingleTool(ctx, {
      args: {},
      toolCallId: "tc-prefix",
      toolName: "filesystem-read",
    });
    expect(result.isError).toBe(false);
    expect(result.output).toBe("ok");
  });
});
