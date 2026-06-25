/**
 * 测试工具注册 — 使用真实 tool-registry 注册可控的测试工具。
 *
 * 替代 mock.module("tool-registry")，无跨文件污染。
 * 配合 afterAll/teardown 调用 cleanupTestTools 清理。
 */
import { _resetForTesting, registerTool, unregisterTool } from "@/tool/registry/toolRegistry";
import type { ToolDefinition } from "@/schema/tool";
import { z } from "zod";

/** 注册一个简单的测试工具(自动返回固定结果) */
export function registerTestTool(
  name: string,
  options?: {
    description?: string;
    permission?: string;
    execute?: (args: any) => Promise<any>;
    parameters?: any;
  },
): void {
  const tool = {
    description: options?.description ?? `测试工具 ${name}`,
    execute: options?.execute ?? (() => Promise.resolve("ok")),
    name,
    parameters: options?.parameters ?? z.object({}),
    permission: options?.permission,
  } as any;
  registerTool(tool);
}

/** 注册多个测试工具 */
export function registerTestTools(
  tools: { name: string; permission?: string; execute?: (args: any) => Promise<any> }[],
): void {
  for (const t of tools) {
    registerTestTool(t.name, { execute: t.execute, permission: t.permission });
  }
}

/** 注销指定测试工具 */
export function unregisterTestTool(name: string): void {
  unregisterTool(name);
}

/** 清理所有注册的工具并重置到初始状态 */
export function resetTestTools(): void {
  _resetForTesting();
}
