/**
 * LSP 客户端模块 — 封装单个 LSP 客户端的所有通信逻辑。
 *
 * 职责:
 *   - 封装单个 LSP 客户端的所有通信逻辑
 *   - 实现 LSP 协议的所有标准方法
 *   - 管理客户端生命周期(initialize → shutdown → exit)
 *   - 处理 JSON-RPC 通信
 *   - 管理诊断信息缓存
 *
 * 模块功能:
 *   - 启动和停止 LSP Server 进程
 *   - 发送 JSON-RPC 请求和通知
 *   - 实现文档操作(didOpen, didChange, didClose)
 *   - 实现导航操作(definition, references, hover)
 *   - 实现代码操作(completion, codeAction, rename)
 *   - 实现诊断管理
 *   - 处理进程通信和消息解析
 *
 * 使用场景:
 *   - LSP Manager 使用此客户端与 Server 通信
 *   - 每种语言对应一个独立的客户端实例
 *   - 支持并发多个客户端
 *
 * 边界:
 *   1. 仅支持 stdio 传输方式
 *   2. 客户端实例与语言一对一绑定
 *   3. 不涉及 TUI 渲染
 *   4. 请求超时时间可配置
 *   5. 诊断信息仅在内存中缓存
 *
 * 流程:
 *   1. 创建客户端实例
 *   2. 启动 Server 进程(start)
 *   3. 发送 initialize 请求
 *   4. 发送 initialized 通知
 *   5. 处理各类 LSP 请求
 *   6. 接收诊断通知
 *   7. 关闭时发送 shutdown/exit
 */

import { createLogger } from "@/core/logging/logger";
import type { LspServerDefinition } from "../registry/serverRegistry";
import { createInternalError } from "@/core/errors/appError";
import { extractJsonRpcMessages } from "./clientMessageBuffer";
import { parseDiagnostic, parseLocationResult } from "./clientProtocol";
import type {
  CodeActionParams,
  CompletionParams,
  DefinitionParams,
  DidChangeTextDocumentParams,
  DidCloseTextDocumentParams,
  DidOpenTextDocumentParams,
  DidSaveTextDocumentParams,
  DocumentDiagnosticParams,
  DocumentDiagnosticReport,
  DocumentFormattingParams,
  DocumentSymbolParams,
  HoverParams,
  ImplementationParams,
  InitializeParams,
  InitializeResult,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
  LSPClientOptions,
  LspClientState,
  LspCodeAction,
  LspCompletionItem,
  LspDiagnostic,
  LspDocumentSymbol,
  LspHover,
  LspLocation,
  LspSymbolInformation,
  LspTextEdit,
  ReferenceParams,
  RenameParams,
  ServerCapabilities,
  SignatureHelpParams,
  TypeDefinitionParams,
  WorkspaceSymbolParams,
} from "./clientProtocol";

const log = createLogger("lsp:client");

/**
 * P0-1: 仅导出 LSPClient 独有的类型。
 * 与 manager/managerProtocol 重名的类型（LspDiagnostic, LspLocation 等）
 * 统一由 managerProtocol 作为公共 API 来源，此处不再 re-export。
 */
export type {
  InitializeParams,
  InitializeResult,
  LSPClientOptions,
  LspClientState,
  ServerCapabilities,
} from "./clientProtocol";

// ── LSP 客户端类 ─────────────────────────────────────────────────

/**
 * LSP 客户端类
 *
 * 封装单个 LSP Server 进程和通信逻辑。
 */
export class LSPClient {
  /** Server 定义 */
  private serverDefinition: LspServerDefinition;

  /** Server 进程 */
  private process: ReturnType<typeof Bun.spawn> | null = null;

  /** 客户端状态 */
  private clientState: LspClientState = "stopped";

  /** 当前启动流程；用于让重复 start 调用共享同一个生命周期 */
  private startPromise: Promise<void> | null = null;

  /** 最后错误信息 */
  private lastError?: string;

  /** 请求 ID 计数器 */
  private requestId = 0;

  /** 待处理请求映射 */
  private pendingRequests = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();

  /** 接收缓冲区 */
  private buffer = "";

  /** 当前消息长度 */
  private contentLength: number | null = null;

  /** 诊断缓存 */
  private diagnosticCache = new Map<string, LspDiagnostic[]>();

  /** 服务器能力 */
  private capabilities: ServerCapabilities | null = null;

  /** 根 URI */
  private rootUri: string;

  /** 请求超时(毫秒) */
  private requestTimeout: number;

  /**
   * 创建 LSP 客户端实例
   */
  constructor(serverDefinition: LspServerDefinition, options: LSPClientOptions) {
    this.serverDefinition = serverDefinition;
    this.rootUri = options.rootUri ?? `file://${options.rootPath ?? process.cwd()}`;
    this.requestTimeout = options.requestTimeout ?? 5000;
  }

  /**
   * 启动客户端进程并建立连接
   */
  async start(options: LSPClientOptions): Promise<void> {
    if (this.clientState === "running") {
      return;
    }

    if (this.clientState === "starting" && this.startPromise) {
      return this.startPromise;
    }

    if (this.clientState === "error") {
      await this.exit();
    }

    this.startPromise = (async () => {
      this.clientState = "starting";
      this.lastError = undefined;

      try {
        log.info(`启动 LSP Server: ${this.serverDefinition.id} (${this.serverDefinition.command})`);

        // 启动 Server 进程
        this.process = Bun.spawn({
          cmd: [options.command ?? this.serverDefinition.command, ...(options.args ?? this.serverDefinition.args)],
          cwd: options.cwd,
          env: { ...process.env, ...options.env },
          stderr: "pipe",
          stdin: "pipe",
          stdout: "pipe",
        });

        // 异步读取 stdout
        if (this.process.stdout) {
          this.readStdout().catch((error) => {
            log.error(`读取 stdout 失败: ${this.serverDefinition.id}`, {
              error: error instanceof Error ? error.message : String(error),
            });
          });
        }

        // 异步读取 stderr(仅日志)
        if (this.process.stderr) {
          this.readStderr().catch((error) => {
            log.error(`读取 stderr 失败: ${this.serverDefinition.id}`, {
              error: error instanceof Error ? error.message : String(error),
            });
          });
        }

        // 等待进程启动
        await new Promise((resolve) => setTimeout(resolve, 100));

        this.clientState = "running";
        log.info(`LSP Server 启动成功: ${this.serverDefinition.id}`);
      } catch (error) {
        this.clientState = "error";
        this.lastError = error instanceof Error ? error.message : String(error);
        log.error(`LSP Server 启动失败: ${this.serverDefinition.id}`, { error: this.lastError });
        throw error;
      } finally {
        this.startPromise = null;
      }
    })();

    return this.startPromise;
  }

  /**
   * 发送 initialize 请求
   */
  async initialize(): Promise<InitializeResult> {
    if (this.clientState !== "running") {
      throw createInternalError("INTERNAL_ERROR", `客户端未运行: ${this.clientState}`);
    }

    const params: InitializeParams = {
      capabilities: {
        textDocument: {
          codeAction: { dynamicRegistration: true },
          completion: { dynamicRegistration: true },
          definition: { dynamicRegistration: true },
          hover: { dynamicRegistration: true },
          references: { dynamicRegistration: true },
        },
        workspace: {
          didChangeConfiguration: { dynamicRegistration: true },
        },
      },
      initializationOptions: this.serverDefinition.initializationOptions,
      processId: process.pid,
      rootUri: this.rootUri,
    };

    const result = (await this.sendRequest("initialize", params)) as InitializeResult;
    this.capabilities = result.capabilities;

    // 发送 initialized 通知
    this.sendNotification("initialized", {});

    log.info(`LSP 客户端初始化完成: ${this.serverDefinition.id}`);
    return result;
  }

  /**
   * 发送 shutdown 请求
   */
  async shutdown(): Promise<void> {
    if (this.clientState !== "running") {
      return;
    }

    try {
      await this.sendRequest("shutdown", undefined, 3000);
      log.info(`LSP 客户端已关闭: ${this.serverDefinition.id}`);
    } catch (error) {
      log.warn(`shutdown 请求失败: ${this.serverDefinition.id}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * 终止客户端进程
   */
  async exit(): Promise<void> {
    if (this.clientState === "stopped") {
      return;
    }

    // 发送 exit 通知
    this.sendNotification("exit", undefined);

    // 等待进程退出
    if (this.process) {
      try {
        await Promise.race([this.process.exited, new Promise((resolve) => setTimeout(resolve, 1000))]);
      } catch {
        // 进程可能已退出
      }
    }

    this.cleanup();
    this.clientState = "stopped";
    log.info(`LSP 客户端已终止: ${this.serverDefinition.id}`);
  }

  /**
   * 获取客户端状态
   */
  getState(): LspClientState {
    return this.clientState;
  }

  /**
   * 获取最后错误
   */
  getLastError(): string | undefined {
    return this.lastError;
  }

  /**
   * 获取服务器能力
   */
  getCapabilities(): ServerCapabilities | null {
    return this.capabilities;
  }

  /**
   * 获取诊断信息
   */
  getDiagnostics(uri: string): LspDiagnostic[] {
    return this.diagnosticCache.get(uri) ?? [];
  }

  /**
   * === 标准 LSP 功能 ===
   */

  /**
   * 文档符号
   */
  async documentSymbol(params: DocumentSymbolParams): Promise<(LspSymbolInformation | LspDocumentSymbol)[]> {
    if (!this.capabilities?.documentSymbolProvider) {
      return [];
    }
    const result = await this.sendRequest("textDocument/documentSymbol", params);
    return Array.isArray(result) ? result : [];
  }

  /**
   * 工作区符号
   */
  async workspaceSymbol(params: WorkspaceSymbolParams): Promise<LspSymbolInformation[]> {
    if (!this.capabilities?.workspaceSymbolProvider) {
      return [];
    }
    const result = await this.sendRequest("workspace/symbol", params, 8000);
    return Array.isArray(result) ? result : [];
  }

  /**
   * 定义跳转
   */
  async definition(params: DefinitionParams): Promise<LspLocation[]> {
    if (!this.capabilities?.definitionProvider) {
      return [];
    }
    const result = await this.sendRequest("textDocument/definition", params);
    return parseLocationResult(result);
  }

  /**
   * 引用查找
   */
  async references(params: ReferenceParams): Promise<LspLocation[]> {
    if (!this.capabilities?.referencesProvider) {
      return [];
    }
    const result = await this.sendRequest("textDocument/references", params);
    return parseLocationResult(result);
  }

  /**
   * Hover 信息
   */
  async hover(params: HoverParams): Promise<LspHover | null> {
    if (!this.capabilities?.hoverProvider) {
      return null;
    }
    const result = await this.sendRequest("textDocument/hover", params);
    return result as LspHover | null;
  }

  /**
   * 文档诊断
   */
  async diagnostics(params: DocumentDiagnosticParams): Promise<DocumentDiagnosticReport> {
    const diags = this.getDiagnostics(params.textDocument.uri);
    return { items: diags };
  }

  /**
   * 代码补全
   */
  async completion(params: CompletionParams): Promise<LspCompletionItem[]> {
    if (!this.capabilities?.completionProvider) {
      return [];
    }
    const result = await this.sendRequest("textDocument/completion", params);
    if (!result || !Array.isArray((result as { items?: unknown[] }).items)) {
      return [];
    }
    return (result as { items: LspCompletionItem[] }).items;
  }

  /**
   * 代码操作
   */
  async codeAction(params: CodeActionParams): Promise<LspCodeAction[]> {
    if (!this.capabilities?.codeActionProvider) {
      return [];
    }
    const result = await this.sendRequest("textDocument/codeAction", params);
    return Array.isArray(result) ? result : [];
  }

  /**
   * 重命名
   */
  async rename(params: RenameParams): Promise<unknown> {
    if (!this.capabilities?.renameProvider) {
      return null;
    }
    return await this.sendRequest("textDocument/rename", params);
  }

  /**
   * 格式化
   */
  async formatting(params: DocumentFormattingParams): Promise<LspTextEdit[]> {
    if (!this.capabilities?.documentFormattingProvider) {
      return [];
    }
    const result = await this.sendRequest("textDocument/formatting", params);
    return Array.isArray(result) ? result : [];
  }

  /**
   * 签名帮助
   */
  async signatureHelp(params: SignatureHelpParams): Promise<unknown | null> {
    if (!this.capabilities?.signatureHelpProvider) {
      return null;
    }
    return await this.sendRequest("textDocument/signatureHelp", params);
  }

  /**
   * 实现查找
   */
  async implementation(params: ImplementationParams): Promise<LspLocation[]> {
    if (!this.capabilities?.implementationProvider) {
      return [];
    }
    const result = await this.sendRequest("textDocument/implementation", params);
    return parseLocationResult(result);
  }

  /**
   * 类型定义
   */
  async typeDefinition(params: TypeDefinitionParams): Promise<LspLocation[]> {
    if (!this.capabilities?.typeDefinitionProvider) {
      return [];
    }
    const result = await this.sendRequest("textDocument/typeDefinition", params);
    return parseLocationResult(result);
  }

  /**
   * === 文档管理 ===
   */

  /**
   * 通知文档打开
   */
  didOpen(params: DidOpenTextDocumentParams): void {
    this.sendNotification("textDocument/didOpen", params);
  }

  /**
   * 通知文档变更
   */
  didChange(params: DidChangeTextDocumentParams): void {
    this.sendNotification("textDocument/didChange", params);
  }

  /**
   * 通知文档关闭
   */
  didClose(params: DidCloseTextDocumentParams): void {
    this.sendNotification("textDocument/didClose", params);
  }

  /**
   * 通知文档保存
   */
  didSave(params: DidSaveTextDocumentParams): void {
    this.sendNotification("textDocument/didSave", params);
  }

  /**
   * === 私有方法 ===
   */

  /**
   * 发送 JSON-RPC 请求
   */
  private async sendRequest<T>(method: string, params?: unknown, timeout?: number): Promise<T> {
    if (!this.process?.stdin) {
      return Promise.reject(new Error(`LSP 客户端未启动`)) as Promise<T>;
    }

    const id = ++this.requestId;
    const request: JsonRpcRequest = { id, jsonrpc: "2.0", method, params };

    return new Promise((resolve: (value: unknown) => void, reject: (error: Error) => void) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`LSP 请求超时: ${method}`));
      }, timeout ?? this.requestTimeout);

      this.pendingRequests.set(id, { reject, resolve, timer });
      this.writeMessage(request);
    }) as Promise<T>;
  }

  /**
   * 发送 JSON-RPC 通知
   */
  private sendNotification(method: string, params?: unknown): void {
    if (!this.process?.stdin) {
      return;
    }

    const notification: JsonRpcNotification = { jsonrpc: "2.0", method, params };
    this.writeMessage(notification);
  }

  /**
   * 写入 JSON-RPC 消息到 stdin
   */
  private writeMessage(message: JsonRpcRequest | JsonRpcNotification): void {
    if (!this.process?.stdin) {
      return;
    }
    const body = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
    const stdin = this.process.stdin as { write: (chunk: string) => void };
    stdin.write(header + body);
  }

  /**
   * 异步读取 LSP Server stdout
   */
  private async readStdout(): Promise<void> {
    if (!this.process?.stdout) {
      return;
    }

    const stdout = this.process.stdout as ReadableStream<Uint8Array>;
    const reader = stdout.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        this.buffer += decoder.decode(value, { stream: true });
        this.processBuffer();
      }
    } catch {
      // 进程关闭
      this.clientState = "stopped";
    }
  }

  /**
   * 异步读取 stderr(仅日志)
   */
  private async readStderr(): Promise<void> {
    if (!this.process?.stderr) {
      return;
    }

    const stderr = this.process.stderr as ReadableStream<Uint8Array>;
    const reader = stderr.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        const text = decoder.decode(value, { stream: true });
        log.debug(`LSP stderr [${this.serverDefinition.id}]: ${text}`);
      }
    } catch {
      // 忽略错误
    }
  }

  /**
   * 处理接收缓冲区中的 LSP 消息
   */
  private processBuffer(): void {
    const result = extractJsonRpcMessages(this.buffer, this.contentLength);
    this.buffer = result.buffer;
    this.contentLength = result.contentLength;

    for (const err of result.errors) {
      log.warn(`LSP 消息解析失败`, { error: err.message });
    }

    for (const message of result.messages) {
      this.handleMessage(message);
    }
  }

  /**
   * 处理接收到的 LSP 消息
   */
  private handleMessage(message: JsonRpcResponse | JsonRpcNotification): void {
    // 响应
    if ("id" in message && typeof message.id === "number") {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(message.id);

        if (message.error) {
          pending.reject(new Error(message.error.message));
        } else {
          pending.resolve(message.result);
        }
      }
      return;
    }

    // 通知
    if ("method" in message) {
      if (message.method === "textDocument/publishDiagnostics") {
        const params = message.params as {
          uri: string;
          diagnostics: Record<string, unknown>[];
        };
        const diags = (params.diagnostics ?? []).map((d) => parseDiagnostic(params.uri, d as Record<string, unknown>));
        this.diagnosticCache.set(params.uri, diags);
      }
      // 其他通知忽略
    }
  }

  /**
   * 清理资源
   */
  private cleanup(): void {
    // 取消所有待处理请求
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error("客户端已关闭"));
    }
    this.pendingRequests.clear();

    // 清理缓冲区
    this.buffer = "";
    this.contentLength = null;

    // 清理诊断缓存
    this.diagnosticCache.clear();

    // 清理能力信息
    this.capabilities = null;
  }
}
