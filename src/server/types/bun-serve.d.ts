/**
 * Bun.serve WebSocket 类型扩展 — 补充 Bun 类型声明中缺失的属性。
 *
 * 背景: Bun.serve 的 WebSocket 处理器和 Server.upgrade() 方法
 * 在 Bun 的 TypeScript 类型声明中缺少 data 属性和 upgrade 方法，
 * 导致需要 (ws as any).data 和 (server as any).upgrade() 等类型不安全的写法。
 * 本模块通过 module augmentation 补充这些类型声明。
 */

declare module "bun" {
  interface ServerWebSocket<TData = undefined> {
    /** WebSocket 升级时通过 server.upgrade({ data }) 传入的附加数据 */
    data: TData;
  }

  interface Server {
    /**
     * 将 HTTP 请求升级为 WebSocket 连接。
     * @param req - 原始 HTTP 请求
     * @param options - 升级选项，data 会被设置到 ws.data
     * @returns 是否成功升级
     */
    upgrade(req: Request, options?: { data?: unknown }): boolean;
  }
}
