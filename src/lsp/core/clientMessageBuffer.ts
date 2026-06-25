/**
 * LSP 客户端消息缓冲模块 — 按 LSP/JSON-RPC 规范从字节流中切分消息。
 *
 * 职责:
 *   - 解析 Content-Length 头
 *   - 按字节长度切分出完整 JSON-RPC 消息
 *   - 收集解析错误，保留未消费缓冲
 *
 * 模块功能:
 *   - extractJsonRpcMessages: 状态机式消息切分
 *   - JsonRpcMessageParseResult: 解析结果(剩余 buffer / contentLength / messages / errors)
 *   - JsonRpcInboundMessage: 入站消息联合类型
 *
 * 使用场景:
 *   - LSP 客户端读取 stdio 时持续喂入 buffer
 *   - 兼容 LSP 规范(LSP 8.0+ 同时支持 Content-Length / Content-Type，但本实现只读 Content-Length)
 *
 * 边界:
 *   1. 假定输入按 LSP 帧头规范(每条消息以 \r\n\r\n 分隔 header/body)
 *   2. JSON.parse 失败时写入 errors 但不抛错
 *   3. 未读完的字节会作为 buffer 返回供下次继续解析
 *
 * 流程:
 *   1. 扫描 \r\n\r\n 头尾分隔
 *   2. 解析 Content-Length(不区分大小写)
 *   3. 等待 body 长度达到 Content-Length 后切分
 *   4. JSON.parse 切分出的 body；失败累计到 errors
 *   5. 返回新 buffer / 解析消息 / 错误列表
 */
import type { JsonRpcNotification, JsonRpcResponse } from "./clientProtocol";

export type JsonRpcInboundMessage = JsonRpcResponse | JsonRpcNotification;

export interface JsonRpcMessageParseResult {
  buffer: string;
  contentLength: number | null;
  messages: JsonRpcInboundMessage[];
  errors: Error[];
}

export function extractJsonRpcMessages(buffer: string, contentLength: number | null): JsonRpcMessageParseResult {
  const messages: JsonRpcInboundMessage[] = [];
  const errors: Error[] = [];
  let nextBuffer = buffer;
  let nextContentLength = contentLength;

  while (true) {
    if (nextContentLength === null) {
      const headerEnd = nextBuffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        break;
      }

      const header = nextBuffer.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        nextBuffer = nextBuffer.slice(headerEnd + 4);
        continue;
      }

      nextContentLength = parseInt(match[1]!, 10);
      nextBuffer = nextBuffer.slice(headerEnd + 4);
    }

    if (nextContentLength !== null && nextBuffer.length >= nextContentLength) {
      const body = nextBuffer.slice(0, nextContentLength);
      nextBuffer = nextBuffer.slice(nextContentLength);
      nextContentLength = null;

      try {
        messages.push(JSON.parse(body) as JsonRpcInboundMessage);
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    } else {
      break;
    }
  }

  return {
    buffer: nextBuffer,
    contentLength: nextContentLength,
    errors,
    messages,
  };
}
