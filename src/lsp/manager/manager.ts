/**
 * LSP Manager 模块 — 项目级 LSP 客户端生命周期与请求路由。
 *
 * 职责:
 *   - 管理项目级 LSP 客户端实例(按语言 ID 懒启动)
 *   - stdio Server 进程生命周期管理(spawn / shutdown / exit)
 *   - JSON-RPC 请求/通知收发(含 pending 请求 + 超时清理)
 *   - 诊断缓存与变更回调
 *   - 响应缓存、请求队列、性能监控（集成自 perf 模块）
 *   - 空闲客户端自动清理（集成自 pool 模块概念）
 *   - re-export 协议类型 + 客户端契约
 *
 * 模块功能:
 *   - LspManager: 核心管理器类
 *   - startClient / stopClient: 单个客户端生命周期
 *   - request: 通用 JSON-RPC 请求(含缓存/队列/监控)
 *   - notify: 通用 JSON-RPC 通知
 *   - getDiagnostics / clearDiagnostics: 诊断缓存
 *   - 高阶语义封装委托 managerFeatures(hover/completion/...)
 *   - getPerformanceReport: 性能指标查询
 *
 * 使用场景:
 *   - 工具调用 lspTool 时由 Manager 找到对应客户端
 *   - 文档同步(didOpen/didChange/didClose)由 Manager 路由
 *
 * 边界:
 *   1. 仅做「客户端生命周期 + 请求路由 + 缓存」；语义请求在 managerFeatures
 *   2. Server 不可用或未安装时降级(不抛错，记录 lastError)
 *   3. 同一语言 ID 复用同一客户端(避免重复进程)
 *   4. 响应缓存仅对幂等只读请求生效(hover/definition/references/symbols)
 *   5. 请求队列限制并发数，避免 LSP Server 过载
 *   6. 空闲超过 idleTimeout 的客户端自动停止
 *
 * 流程:
 *   1. 按语言 ID 找到 Server 定义并 spawn 进程
 *   2. 走 initialize → initialized 握手
 *   3. 进入 running 状态；接受 request/notify
 *   4. 收到 didChangeContent / didOpen 等刷新诊断
 *   5. shutdown → exit，清理 pending
 */
import { createLogger } from "@/core/logging/logger";
import { detectLanguage } from "../language/language";
import { findServerForLanguage, isServerInstalled } from "../registry/serverRegistry";
import type { LspServerDefinition } from "../registry/serverRegistry";
import type { LspClient, LspClientEntry, LspClientState } from "./managerTypes";
import {
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type LspCompletionItem,
  type LspDiagnostic,
  type LspLocation,
  type LspSymbol,
  type LspTextEdit,
  type LspWorkspaceEdit,
  parseDiagnostic,
  pathToUri as _pathToUri,
  uriToPath as _uriToPath,
} from "./managerProtocol";
import {
  notifyLspDidChange,
  notifyLspDidClose,
  notifyLspDidOpen,
  requestLspCodeActions,
  requestLspCompletion,
  requestLspDocumentSymbols,
  requestLspFormatDocument,
  requestLspHover,
  requestLspLocations,
  requestLspRename,
  requestLspWorkspaceSymbols,
} from "./managerFeatures";
import { ResponseCache, RequestQueue, PerformanceMonitor } from "../perf/performance";

const log = createLogger("lsp:manager");

// ── 可缓存的 LSP 方法（幂等只读请求）─────────────────────────────
const CACHEABLE_METHODS = new Set([
  "textDocument/hover",
  "textDocument/definition",
  "textDocument/references",
  "textDocument/documentSymbol",
  "textDocument/completion",
  "textDocument/formatting",
  "textDocument/codeLens",
  "textDocument/semanticTokens/full",
  "workspace/symbol",
]);

// ── 生命周期控制方法（跳过缓存和队列）───────────────────────────
const CONTROL_METHODS = new Set(["initialize", "shutdown"]);

export type {
  LspCompletionItem,
  LspDiagnostic,
  LspLocation,
  LspSymbol,
  LspTextEdit,
  LspWorkspaceEdit,
} from "./managerProtocol";
export type { LspClient, LspServerConfig } from "./managerTypes";

// ── LSP Manager ───────────────────────────────────────────────────

export class LspManager {
  /** 已启动的客户端(语言 ID → 客户端信息) */
  private clients = new Map<string, LspClientEntry>();

  /** 诊断变更回调 */
  private onDiagnosticsChange?: (uri: string, diagnostics: LspDiagnostic[]) => void;

  private projectRoot = process.cwd();
  private maxConnections = 8;

  // ── 性能组件（集成自 perf 模块）───────────────────────────────

  /** LSP 响应缓存 */
  private responseCache: ResponseCache<unknown>;

  /** LSP 请求并发控制队列 */
  private requestQueue: RequestQueue;

  /** LSP 请求性能监控 */
  private perfMonitor: PerformanceMonitor;

  /** 性能监控请求 ID 计数器 */
  private perfRequestIdCounter = 0;

  // ── 空闲清理（集成自 pool 模块概念）───────────────────────────

  /** 空闲清理定时器 */
  private idleCleanupTimer: ReturnType<typeof setInterval> | null = null;

  /** 空闲超时时间（毫秒），默认 5 分钟 */
  private idleTimeout: number;

  constructor(options?: {
    projectRoot?: string;
    maxConnections?: number;
    /** 响应缓存 TTL（毫秒，默认 5000） */
    cacheTtl?: number;
    /** 响应缓存最大条数（默认 1000） */
    cacheMaxSize?: number;
    /** 最大并发请求数（默认 10） */
    maxConcurrentRequests?: number;
    /** 空闲客户端超时时间（毫秒，默认 5 分钟） */
    idleTimeout?: number;
    /** 是否启用性能日志（默认 true） */
    enablePerformanceLogging?: boolean;
  }) {
    this.projectRoot = options?.projectRoot ?? process.cwd();
    this.maxConnections = options?.maxConnections ?? 8;
    this.idleTimeout = options?.idleTimeout ?? 5 * 60 * 1000;

    const enablePerfLogging = options?.enablePerformanceLogging ?? true;

    this.responseCache = new ResponseCache<unknown>({
      enableLogging: enablePerfLogging,
      maxSize: options?.cacheMaxSize ?? 1000,
      ttl: options?.cacheTtl ?? 5000,
    });

    this.requestQueue = new RequestQueue({
      enableLogging: enablePerfLogging,
      maxConcurrent: options?.maxConcurrentRequests ?? 10,
    });

    this.perfMonitor = new PerformanceMonitor({ enableLogging: enablePerfLogging });

    // 启动空闲客户端定期清理
    this.startIdleCleanup();
  }

  // ── 公共 API ────────────────────────────────────────────────────

  /**
   * 初始化项目根目录。保留旧 manager API，便于统一迁移到本实现。
   */
  async initialize(projectRoot: string): Promise<void> {
    this.projectRoot = projectRoot;
  }

  /**
   * 旧 manager API 兼容:根据文件获取或启动客户端。
   */
  async getClientForFile(filePath: string): Promise<LspClient | null> {
    return this.startForFile(filePath, this.getRootUri());
  }

  /**
   * 旧 manager API 兼容:根据语言获取或启动客户端。
   */
  async getClientForLanguage(languageId: string): Promise<LspClient | null> {
    return this.startForLanguage(languageId, this.getRootUri());
  }

  /**
   * 旧 manager API 兼容:关闭文件对应语言客户端。
   */
  async closeClientForFile(filePath: string): Promise<void> {
    const lang = detectLanguage(filePath);
    if (!lang) {
      return;
    }
    await this.stop(lang.languageId);
  }

  /**
   * 旧 manager API 兼容:关闭指定语言客户端。
   */
  async closeClientForLanguage(languageId: string): Promise<void> {
    await this.stop(languageId);
  }

  /**
   * 旧 manager API 兼容:关闭全部客户端。
   */
  async closeAll(): Promise<void> {
    await this.stopAll();
  }

  /**
   * 清理空闲客户端 — 停止超过 idleTimeout 未使用的 LSP Server。
   *
   * @returns 清理的客户端数量
   */
  async cleanupIdle(): Promise<number> {
    const now = Date.now();
    let cleaned = 0;

    for (const [languageId, client] of this.clients.entries()) {
      if (client.state !== "running") continue;

      const lastUsed = client.lastUsedAt ?? 0;
      if (now - lastUsed > this.idleTimeout) {
        try {
          await this.stop(languageId);
          cleaned++;
          log.info(`清理空闲 LSP Server: ${languageId} (空闲 ${Math.round((now - lastUsed) / 1000)}s)`);
        } catch (error) {
          log.warn(`清理空闲客户端失败: ${languageId}`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return cleaned;
  }

  /**
   * 旧 manager API 兼容:重新加载时关闭现有客户端，由后续调用按需启动。
   */
  async reloadConfig(): Promise<void> {
    await this.stopAll();
  }

  /**
   * 旧 manager API 兼容:返回活跃客户端快照。
   */
  getActiveClients(): LspClient[] {
    return this.getClients();
  }

  /**
   * 设置诊断变更回调。
   */
  setDiagnosticsHandler(handler: (uri: string, diagnostics: LspDiagnostic[]) => void): void {
    this.onDiagnosticsChange = handler;
  }

  /**
   * 为指定文件启动对应的 LSP Server。
   *
   * @returns 客户端信息，如果启动失败返回 null
   */
  async startForFile(filePath: string, rootUri: string): Promise<LspClient | null> {
    const lang = detectLanguage(filePath);
    if (!lang) {
      log.debug(`无法检测语言: ${filePath}`);
      return null;
    }

    return this.startForLanguage(lang.languageId, rootUri);
  }

  /**
   * 为指定语言启动 LSP Server。
   */
  async startForLanguage(languageId: string, rootUri: string): Promise<LspClient | null> {
    // 如果已有客户端，直接返回
    const existing = this.clients.get(languageId);
    if (existing) {
      return this.toClient(existing);
    }

    if (this.clients.size >= this.maxConnections) {
      const oldestLanguage = this.clients.keys().next().value as string | undefined;
      if (oldestLanguage) {
        await this.stop(oldestLanguage);
      }
    }

    // 查找 Server 定义
    const serverDef = findServerForLanguage(languageId);
    if (!serverDef) {
      log.debug(`无内置 LSP Server: ${languageId}`);
      return null;
    }

    // 检查是否安装
    const installed = await isServerInstalled(serverDef.id);
    if (!installed) {
      log.warn(`LSP Server 未安装: ${serverDef.id} — ${serverDef.installHint}`);
      return null;
    }

    return this.launchServer(serverDef, languageId, rootUri);
  }

  /**
   * 停止指定语言的 LSP Server。
   */
  async stop(languageId: string): Promise<void> {
    const client = this.clients.get(languageId);
    if (!client) {
      return;
    }

    // 发送 shutdown 请求（走 doSendRequest，不经过缓存/队列）
    try {
      await this.doSendRequest(client, "shutdown", undefined, 3000);
      this.sendNotification(languageId, "exit");
    } catch {
      // 强制关闭
    }

    // 清理 pending 请求
    for (const [, pending] of client.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error("LSP Server 关闭"));
    }

    // 关闭进程
    if (client.process) {
      try {
        client.process.kill();
      } catch {
        // 进程可能已退出
      }
    }

    this.clients.delete(languageId);

    // 清理过期的响应缓存
    this.responseCache.cleanup();

    log.info(`LSP Server 已停止: ${languageId}`);
  }

  /**
   * 停止所有 LSP Server。
   */
  async stopAll(): Promise<void> {
    this.stopIdleCleanup();

    const languages = [...this.clients.keys()];
    await Promise.all(languages.map((lang) => this.stop(lang)));

    // 清空性能状态
    this.responseCache.clear();
    this.requestQueue.clear();
    this.perfMonitor.reset();
  }

  /**
   * 跳转到定义。
   */
  async gotoDefinition(filePath: string, line: number, character: number): Promise<LspLocation[]> {
    try {
      return await requestLspLocations(this.getFeatureDeps(), "textDocument/definition", filePath, line, character);
    } catch {
      return [];
    }
  }

  /**
   * 查找引用。
   */
  async findReferences(filePath: string, line: number, character: number): Promise<LspLocation[]> {
    try {
      return await requestLspLocations(this.getFeatureDeps(), "textDocument/references", filePath, line, character, {
        context: { includeDeclaration: true },
      });
    } catch {
      return [];
    }
  }

  /**
   * 获取悬浮信息。
   */
  async hover(filePath: string, line: number, character: number): Promise<{ contents: unknown } | null> {
    try {
      return await requestLspHover(this.getFeatureDeps(), filePath, line, character);
    } catch {
      return null;
    }
  }

  /**
   * 获取文档符号。
   */
  async documentSymbols(filePath: string): Promise<LspSymbol[]> {
    try {
      return await requestLspDocumentSymbols(this.getFeatureDeps(), filePath);
    } catch {
      return [];
    }
  }

  /**
   * 获取代码补全建议。
   */
  async completion(filePath: string, line: number, character: number): Promise<LspCompletionItem[]> {
    try {
      return await requestLspCompletion(this.getFeatureDeps(), filePath, line, character);
    } catch {
      return [];
    }
  }

  /**
   * 格式化文档。
   */
  async formatDocument(filePath: string): Promise<LspTextEdit[]> {
    try {
      return await requestLspFormatDocument(this.getFeatureDeps(), filePath);
    } catch {
      return [];
    }
  }

  /**
   * 获取重命名编辑。
   */
  async rename(filePath: string, line: number, character: number, newName: string): Promise<LspWorkspaceEdit | null> {
    try {
      return await requestLspRename(this.getFeatureDeps(), filePath, line, character, newName);
    } catch {
      return null;
    }
  }

  /**
   * 工作区符号搜索 — 在整个项目中搜索符号。
   */
  async workspaceSymbols(query: string): Promise<LspSymbol[]> {
    return requestLspWorkspaceSymbols(this.getFeatureDeps(), query);
  }

  /**
   * 获取代码操作 — 获取指定位置的可用快速修复/重构操作。
   */
  async codeActions(
    filePath: string,
    line: number,
    character: number,
    diagnostics?: { line: number; column: number; message: string }[],
  ): Promise<{ title: string; kind?: string; command?: string }[]> {
    try {
      return await requestLspCodeActions(this.getFeatureDeps(), filePath, line, character, diagnostics);
    } catch {
      return [];
    }
  }

  /**
   * 获取指定文件的诊断信息。
   */
  getDiagnostics(filePath: string): LspDiagnostic[] {
    const lang = detectLanguage(filePath);
    if (!lang) {
      return [];
    }

    const client = this.clients.get(lang.languageId);
    if (!client) {
      return [];
    }

    const uri = this.pathToUri(filePath);
    return client.diagnostics.get(uri) ?? [];
  }

  /**
   * 获取所有诊断信息。
   */
  getAllDiagnostics(): Map<string, LspDiagnostic[]> {
    const all = new Map<string, LspDiagnostic[]>();
    for (const client of this.clients.values()) {
      for (const [uri, diags] of client.diagnostics) {
        all.set(uri, diags);
      }
    }
    return all;
  }

  /**
   * 获取所有活跃客户端列表。
   */
  getClients(): LspClient[] {
    return [...this.clients.values()].map((c) => this.toClient(c));
  }

  /**
   * 通知 LSP 文件已打开。
   */
  didOpen(filePath: string, content: string): void {
    notifyLspDidOpen(this.getFeatureDeps(), filePath, content);
  }

  /**
   * 通知 LSP 文件已修改。
   */
  didChange(filePath: string, content: string, version: number): void {
    notifyLspDidChange(this.getFeatureDeps(), filePath, content, version);
  }

  /**
   * 通知 LSP 文件已关闭。
   */
  didClose(filePath: string): void {
    notifyLspDidClose(this.getFeatureDeps(), filePath);
  }

  /**
   * 获取性能报告。
   *
   * 返回响应缓存、请求队列、性能监控的综合指标。
   */
  getPerformanceReport() {
    return {
      cache: this.responseCache.getStats(),
      cacheHitRate: this.perfMonitor.getCacheHitRate(),
      monitor: this.perfMonitor.getMetrics(),
      queue: this.requestQueue.getStats(),
    };
  }

  // ── 内部方法 ────────────────────────────────────────────────────

  /**
   * 启动 LSP Server 子进程。
   */
  private launchServer(definition: LspServerDefinition, languageId: string, rootUri: string): LspClient | null {
    const entry: LspClientEntry = {
      buffer: "",
      contentLength: null as number | null,
      definition,
      diagnostics: new Map<string, LspDiagnostic[]>(),
      lastUsedAt: Date.now(),
      pendingRequests: new Map<
        number,
        { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
      >(),
      process: null as ReturnType<typeof Bun.spawn> | null,
      requestId: 0,
      rootUri,
      state: "starting" as LspClientState,
    };

    this.clients.set(languageId, entry);

    try {
      log.info(`启动 LSP Server: ${definition.id} for ${languageId}`);

      const proc = Bun.spawn([definition.command, ...definition.args], {
        cwd: this.uriToPath(rootUri),
        stderr: "pipe",
        stdin: "pipe",
        stdout: "pipe",
      });

      entry.process = proc;

      // 异步读取 stdout
      this.readStdout(languageId, proc);

      // 发送 initialize 请求
      this.sendRequest(
        languageId,
        "initialize",
        {
          capabilities: {
            textDocument: {
              definition: { dynamicRegistration: false },
              documentSymbol: { dynamicRegistration: false },
              hover: { contentFormat: ["plaintext", "markdown"], dynamicRegistration: false },
              publishDiagnostics: { relatedInformation: true },
              references: { dynamicRegistration: false },
              synchronization: {
                didSave: true,
                dynamicRegistration: false,
                willSave: false,
                willSaveWaitUntil: false,
              },
            },
          },
          initializationOptions: definition.initializationOptions,
          processId: process.pid,
          rootUri,
        },
        10_000,
      )
        .then(() => {
          entry.state = "running";
          // 发送 initialized 通知
          this.sendNotification(languageId, "initialized", {});
          log.info(`LSP Server 就绪: ${definition.id}`);
        })
        .catch((error) => {
          entry.state = "error";
          entry.lastError = error instanceof Error ? error.message : String(error);
          log.error(`LSP Server 初始化失败: ${definition.id}`, { error: entry.lastError });
        });

      return this.toClient(entry);
    } catch (error) {
      entry.state = "error";
      entry.lastError = error instanceof Error ? error.message : String(error);
      this.clients.delete(languageId);
      log.error(`LSP Server 启动失败: ${definition.id}`, { error: entry.lastError });
      return null;
    }
  }

  /**
   * 异步读取 LSP Server stdout。
   */
  private async readStdout(languageId: string, proc: ReturnType<typeof Bun.spawn>): Promise<void> {
    const client = this.clients.get(languageId);
    if (!client || !proc.stdout) {
      return;
    }

    const stdout = proc.stdout as ReadableStream<Uint8Array>;
    const reader = stdout.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        client.buffer += decoder.decode(value, { stream: true });
        this.processBuffer(languageId);
      }
    } catch {
      // 进程关闭
      client.state = "stopped";
    }
  }

  /**
   * 处理接收缓冲区中的 LSP 消息。
   */
  private processBuffer(languageId: string): void {
    const client = this.clients.get(languageId);
    if (!client) {
      return;
    }

    while (true) {
      // 解析 Content-Length header
      if (client.contentLength === null) {
        const headerEnd = client.buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) {
          break;
        }

        const header = client.buffer.slice(0, headerEnd);
        const match = header.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
          client.buffer = client.buffer.slice(headerEnd + 4);
          continue;
        }

        client.contentLength = parseInt(match[1]!, 10);
        client.buffer = client.buffer.slice(headerEnd + 4);
      }

      // 读取消息体
      if (client.contentLength !== null && client.buffer.length >= client.contentLength) {
        const body = client.buffer.slice(0, client.contentLength);
        client.buffer = client.buffer.slice(client.contentLength);
        client.contentLength = null;

        try {
          const message = JSON.parse(body) as JsonRpcResponse | JsonRpcNotification;
          this.handleMessage(languageId, message);
        } catch (error) {
          log.warn(`LSP 消息解析失败`, { error: error instanceof Error ? error.message : String(error) });
        }
      } else {
        break;
      }
    }
  }

  /**
   * 处理接收到的 LSP 消息。
   */
  private handleMessage(languageId: string, message: JsonRpcResponse | JsonRpcNotification): void {
    const client = this.clients.get(languageId);
    if (!client) {
      return;
    }

    // 响应
    if ("id" in message && typeof message.id === "number") {
      const pending = client.pendingRequests.get(message.id);
      if (pending) {
        clearTimeout(pending.timer);
        client.pendingRequests.delete(message.id);

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
        const params = message.params as { uri: string; diagnostics: Record<string, unknown>[] };
        const diags = (params.diagnostics ?? []).map((d) => parseDiagnostic(params.uri, d));
        client.diagnostics.set(params.uri, diags);
        this.onDiagnosticsChange?.(params.uri, diags);
      }
      // 其他通知忽略
    }
  }

  /**
   * 发送 JSON-RPC 请求（含缓存、队列、监控）。
   *
   * 流程:
   *   1. 生命周期控制方法(initialize/shutdown) → 直接发送，跳过缓存和队列
   *   2. 幂等只读请求 → 先检查缓存，命中则直接返回
   *   3. 所有其他请求 → 通过请求队列并发控制 + 性能监控
   */
  private sendRequest(languageId: string, method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const client = this.clients.get(languageId);
    if (!client || !client.process?.stdin) {
      return Promise.reject(new Error(`LSP 客户端未启动: ${languageId}`));
    }

    // 更新最后使用时间（用于空闲清理）
    client.lastUsedAt = Date.now();

    // 生命周期控制方法跳过缓存和队列
    if (CONTROL_METHODS.has(method)) {
      return this.doSendRequest(client, method, params, timeoutMs);
    }

    // 检查幂等只读请求的缓存
    if (CACHEABLE_METHODS.has(method)) {
      const cached = this.responseCache.get(method, params);
      if (cached !== null) {
        this.perfMonitor.recordCacheHit();
        return Promise.resolve(cached);
      }
    }

    // 通过请求队列进行并发控制 + 性能监控
    return this.requestQueue.add(() => {
      const reqId = `req-${++this.perfRequestIdCounter}`;
      this.perfMonitor.startRequest(reqId, method);

      return this.doSendRequest(client, method, params, timeoutMs)
        .then((result) => {
          this.perfMonitor.endRequest(reqId, false);
          // 缓存幂等只读请求的结果
          if (CACHEABLE_METHODS.has(method)) {
            this.responseCache.set(method, params, result);
          }
          return result;
        })
        .catch((error) => {
          this.perfMonitor.endRequest(reqId, false);
          throw error;
        });
    });
  }

  /**
   * 实际发送 JSON-RPC 请求（底层通信，不含缓存/队列/监控）。
   */
  private doSendRequest(client: LspClientEntry, method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const id = ++client.requestId;
    const request: JsonRpcRequest = { id, jsonrpc: "2.0", method, params };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        client.pendingRequests.delete(id);
        reject(new Error(`LSP 请求超时: ${method}`));
      }, timeoutMs);

      client.pendingRequests.set(id, { reject, resolve, timer });
      this.writeMessage(client, request);
    });
  }

  /**
   * 发送 JSON-RPC 通知。
   */
  private sendNotification(languageId: string, method: string, params?: unknown): void {
    const client = this.clients.get(languageId);
    if (!client || !client.process?.stdin) {
      return;
    }

    // 更新最后使用时间
    client.lastUsedAt = Date.now();

    const notification: JsonRpcNotification = { jsonrpc: "2.0", method, params };
    this.writeMessage(client, notification);
  }

  /**
   * 写入 JSON-RPC 消息到 stdin。
   */
  private writeMessage(
    client: { process: ReturnType<typeof Bun.spawn> | null },
    message: JsonRpcRequest | JsonRpcNotification,
  ): void {
    if (!client.process?.stdin) {
      return;
    }
    const body = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
    const stdin = client.process.stdin as { write: (chunk: string) => void };
    stdin.write(header + body);
  }

  // ── 空闲清理 ──────────────────────────────────────────────────

  /**
   * 启动空闲客户端定期清理。
   */
  private startIdleCleanup(): void {
    this.idleCleanupTimer = setInterval(() => {
      this.cleanupIdle();
    }, 60 * 1000); // 每分钟检查一次
  }

  /**
   * 停止空闲清理定时器。
   */
  private stopIdleCleanup(): void {
    if (this.idleCleanupTimer) {
      clearInterval(this.idleCleanupTimer);
      this.idleCleanupTimer = null;
    }
  }

  // ── 客户端快照与路径辅助 ────────────────────────────────────────

  private getFeatureDeps() {
    return {
      getDiagnostics: (languageId: string, uri: string) => this.clients.get(languageId)?.diagnostics.get(uri) ?? [],
      getRunningClients: () =>
        [...this.clients.values()].map((client) => ({
          languageId: client.definition.languages[0] ?? "unknown",
          state: client.state,
        })),
      pathToUri: (filePath: string) => this.pathToUri(filePath),
      sendNotification: (languageId: string, method: string, params?: unknown) =>
        this.sendNotification(languageId, method, params),
      sendRequest: (languageId: string, method: string, params: unknown, timeoutMs: number) =>
        this.sendRequest(languageId, method, params, timeoutMs),
    };
  }

  private toClient(entry: LspClientEntry): LspClient {
    if (!entry.publicClient) {
      entry.publicClient = {
        diagnostics: entry.diagnostics,
        languageId: entry.definition.languages[0] ?? "unknown",
        lastError: entry.lastError,
        serverId: entry.definition.id,
        state: entry.state,
      };
    }

    entry.publicClient.state = entry.state;
    entry.publicClient.lastError = entry.lastError;
    entry.publicClient.diagnostics = entry.diagnostics;
    return entry.publicClient;
  }

  private getRootUri(): string {
    return this.projectRoot.startsWith("file://") ? this.projectRoot : this.pathToUri(this.projectRoot);
  }

  /**
   * 文件路径 → file:// URI
   */
  private pathToUri(filePath: string): string {
    return _pathToUri(filePath);
  }

  /**
   * file:// URI → 文件路径
   */
  private uriToPath(uri: string): string {
    return _uriToPath(uri);
  }
}

/** 全局单例 */
export const lspManager = new LspManager();
