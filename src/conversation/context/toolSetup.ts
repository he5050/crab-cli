/**
 * 工具执行配置 — 会话级工具拦截/扩展/上下文设置。
 *
 * 从 ConversationHandler 提取的独立职责:
 *   - 持有 toolInterceptor / toolInterceptorContext
 *   - 管理 additionalToolSchemas 扩展
 *   - 持有 getToolContext 工厂
 *
 * 设计原则:
 *   1. 纯配置容器，不参与工具执行流程
 *   2. 从 ConversationHandlerOptions 初始化
 *   3. 传递给 HandlerContext 使用
 *
 * 边界:
 *   1. 不包含 permissionManager / toolExecutor（运行时组件）
 *   2. 不持久化（运行时注入配置）
 */
import type { ToolContext } from "@/tool/types";
import type { ToolInterceptor, ToolInterceptorContext } from "../types/handler";

export class ToolSetup {
  toolInterceptor?: ToolInterceptor;
  toolInterceptorContext?: ToolInterceptorContext;
  additionalToolSchemas?: Record<string, { description: string; inputSchema: unknown }>;
  getToolContext?: () => ToolContext;

  /** 从 ConversationHandlerOptions 初始化 */
  applyOptions(options: {
    toolInterceptor?: ToolInterceptor;
    toolInterceptorContext?: ToolInterceptorContext;
    additionalToolSchemas?: Record<string, { description: string; inputSchema: unknown }>;
    getToolContext?: () => ToolContext;
  }): void {
    this.toolInterceptor = options.toolInterceptor;
    this.toolInterceptorContext = options.toolInterceptorContext;
    this.additionalToolSchemas = options.additionalToolSchemas;
    this.getToolContext = options.getToolContext;
  }

  /** 设置额外的工具 schema(运行时扩展) */
  setAdditionalToolSchemas(schemas: Record<string, { description: string; inputSchema: unknown }> | undefined): void {
    this.additionalToolSchemas = schemas;
  }
}
