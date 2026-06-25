/**
 * 传输层 — Route 系统的传输抽象。
 *
 * 职责:
 *   - 定义传输协议类型（HTTP / WebSocket）
 *   - 提供 HTTP fetch 传输实现
 *   - 提供 WebSocket 传输接口（预留）
 *
 * 使用场景:
 *   - Route 执行器通过传输层发送请求
 *   - 支持 HTTP 和 WebSocket 两种传输协议
 *
 * 边界:
 *   1. 仅负责传输，不处理业务逻辑
 *   2. HTTP 传输基于全局 fetch
 *   3. WebSocket 传输为预留接口，当前仅 HTTP 可用
 */

/** 传输协议类型 */
export type TransportProtocol = "http" | "websocket";

/** 传输请求参数 */
export interface TransportRequest {
  /** 完整 URL */
  url: string;
  /** HTTP 方法 */
  method: string;
  /** 请求头 */
  headers: Record<string, string>;
  /** 请求体（可选） */
  body?: string | Uint8Array;
  /** 中止信号 */
  abortSignal?: AbortSignal;
  /** 超时毫秒数 */
  timeoutMs?: number;
}

/** 传输响应 */
export interface TransportResponse {
  /** HTTP 状态码 */
  status: number;
  /** 响应头 */
  headers: Record<string, string>;
  /** 响应体文本 */
  body: string;
  /** 是否成功（2xx） */
  ok: boolean;
}

/** 传输层接口 */
export interface Transport {
  /** 传输协议 */
  readonly protocol: TransportProtocol;
  /** 发送请求并返回响应 */
  send(request: TransportRequest): Promise<TransportResponse>;
}

/** HTTP fetch 传输实现 */
export class HttpTransport implements Transport {
  readonly protocol = "http" as const;

  async send(request: TransportRequest): Promise<TransportResponse> {
    const controller = new AbortController();
    const timeoutId =
      request.timeoutMs !== undefined ? setTimeout(() => controller.abort("timeout"), request.timeoutMs) : undefined;

    // 联动外部 abortSignal
    if (request.abortSignal) {
      if (request.abortSignal.aborted) {
        controller.abort(request.abortSignal.reason);
      } else {
        request.abortSignal.addEventListener(
          "abort",
          () => {
            controller.abort(request.abortSignal!.reason);
          },
          { once: true },
        );
      }
    }

    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
      });

      const body = await response.text();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return {
        body,
        headers,
        ok: response.ok,
        status: response.status,
      };
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }
}

/** WebSocket 传输接口（预留，当前未实现） */
export interface WebSocketTransport extends Transport {
  readonly protocol: "websocket";
  /** 建立 WebSocket 连接 */
  connect(url: string, headers?: Record<string, string>): Promise<void>;
  /** 关闭连接 */
  close(): void;
}

/** WebSocket 消息处理器 */
export type WebSocketMessageHandler = (data: string | Uint8Array) => void;

/** WebSocket 连接状态 */
export type WebSocketState = "disconnected" | "connecting" | "connected" | "closing" | "closed";

/** WebSocket 传输实现 — 支持文本和二进制消息 */
export class WebSocketTransportImpl implements WebSocketTransport {
  readonly protocol = "websocket" as const;

  private ws: {
    send(data: string | Uint8Array): void;
    close(): void;
    on(event: string, handler: (...args: unknown[]) => void): void;
    readyState: number;
  } | null = null;
  private messageHandlers = new Set<WebSocketMessageHandler>();
  private state: WebSocketState = "disconnected";
  private url = "";
  private headers: Record<string, string> = {};

  /** 建立 WebSocket 连接 */
  async connect(url: string, headers: Record<string, string> = {}): Promise<void> {
    this.url = url;
    this.headers = headers;
    this.state = "connecting";

    // 动态导入 ws 模块（可选依赖）
    let WsClass: new (
      url: string,
      options?: Record<string, unknown>,
    ) => {
      send(data: string | Uint8Array): void;
      close(): void;
      on(event: string, handler: (...args: unknown[]) => void): void;
      readyState: number;
    };

    try {
      const wsModule = (await import("ws")) as {
        default?: new (url: string, options?: Record<string, unknown>) => unknown;
        WebSocket?: new (url: string, options?: Record<string, unknown>) => unknown;
      };
      const RawClass = wsModule.default ?? wsModule.WebSocket;
      if (!RawClass) {
        throw new Error("ws 模块未找到 WebSocket 构造函数");
      }
      WsClass = RawClass as new (
        url: string,
        options?: Record<string, unknown>,
      ) => {
        send(data: string | Uint8Array): void;
        close(): void;
        on(event: string, handler: (...args: unknown[]) => void): void;
        readyState: number;
      };
    } catch (error) {
      this.state = "disconnected";
      throw new Error(`WebSocket 模块加载失败: ${(error as Error).message}`);
    }

    return new Promise<void>((resolve, reject) => {
      const wsOptions: Record<string, unknown> = {};
      if (Object.keys(headers).length > 0) {
        wsOptions.headers = headers;
      }

      const ws = new WsClass(url, wsOptions);
      this.ws = ws;

      const timeout = setTimeout(() => {
        if (this.state === "connecting") {
          this.state = "disconnected";
          try {
            ws.close();
          } catch {
            // 忽略关闭错误
          }
          reject(new Error("WebSocket 连接超时"));
        }
      }, 10_000);

      ws.on("open", () => {
        clearTimeout(timeout);
        this.state = "connected";
        resolve();
      });

      ws.on("message", (data: unknown) => {
        const payload = data as string | Uint8Array;
        for (const handler of this.messageHandlers) {
          try {
            handler(payload);
          } catch {
            // 忽略处理器异常
          }
        }
      });

      ws.on("error", (err: unknown) => {
        clearTimeout(timeout);
        if (this.state === "connecting") {
          this.state = "disconnected";
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });

      ws.on("close", () => {
        this.state = "closed";
        this.ws = null;
      });
    });
  }

  /** 发送数据（文本或二进制） */
  sendData(data: string | Uint8Array): void {
    if (!this.ws || this.state !== "connected") {
      throw new Error("WebSocket 未连接");
    }
    this.ws.send(data);
  }

  /** 注册消息处理器，返回取消订阅函数 */
  onMessage(handler: WebSocketMessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  /** 关闭连接 */
  close(): void {
    this.state = "closing";
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // 忽略关闭错误
      }
      this.ws = null;
    }
    this.state = "closed";
    this.messageHandlers.clear();
  }

  /** 获取当前连接状态 */
  getState(): WebSocketState {
    return this.state;
  }

  /** 获取连接 URL */
  getUrl(): string {
    return this.url;
  }

  /** Transport.send — 将请求作为 WebSocket 消息发送，等待响应 */
  async send(request: TransportRequest): Promise<TransportResponse> {
    if (!this.ws || this.state !== "connected") {
      // 尝试自动连接
      await this.connect(request.url, request.headers);
    }

    return new Promise<TransportResponse>((resolve, reject) => {
      const timeoutId = request.timeoutMs
        ? setTimeout(() => {
            reject(new Error("WebSocket 请求超时"));
          }, request.timeoutMs)
        : undefined;

      const unsub = this.onMessage((data) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        unsub();

        const body = typeof data === "string" ? data : new TextDecoder().decode(data);
        resolve({
          body,
          headers: {},
          ok: true,
          status: 200,
        });
      });

      try {
        this.sendData(request.body ?? "");
      } catch (error) {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        unsub();
        reject(error);
      }
    });
  }
}

/** 默认 HTTP 传输实例 */
export const defaultHttpTransport = new HttpTransport();

/** 根据协议创建传输层 */
export function createTransport(protocol: TransportProtocol): Transport {
  switch (protocol) {
    case "http": {
      return new HttpTransport();
    }
    case "websocket": {
      return new WebSocketTransportImpl() as unknown as Transport;
    }
    default: {
      const _exhaustive: never = protocol;
      throw new Error(`未知传输协议: ${String(_exhaustive)}`);
    }
  }
}
