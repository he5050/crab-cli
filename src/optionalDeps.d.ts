/**
 * 类型声明 — 可选依赖的模块声明
 *
 * 职责:
 *   - 为可选依赖提供 TypeScript 类型声明
 *   - 确保缺少可选依赖时的类型安全
 *
 * 模块功能:
 *   - ws 模块声明: WebSocket 类型声明
 *   - mammoth 模块声明: Word 文档解析可选依赖
 *
 * 使用场景:
 *   - IDE 连接功能使用 ws 库
 *   - 可选依赖在未安装时提供类型安全
 *
 * 边界:
 * 1. 仅处理可选依赖的类型声明
 * 2. 不实现实际功能逻辑
 *
 * 流程:
 * 1. 暂无(这是类型声明文件，无特定执行流程)
 */
declare module "ws" {
  // Ws 是可选依赖，仅在 IDE 连接功能中使用
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const WebSocket: any;
  export default WebSocket;
  export { WebSocket };
}

declare module "mammoth" {
  export function extractRawText(input: { buffer: Buffer }): Promise<{
    value: string;
    messages: unknown[];
  }>;
}
