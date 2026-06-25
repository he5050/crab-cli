/**
 * LSP Manager 类型定义模块 — 客户端配置、状态与内部条目结构。
 *
 * 职责:
 *   - 描述 LSP Server 配置(LspServerConfig)与客户端实例(LspClient)
 *   - 描述 Manager 内部使用的扩展条目(LspClientEntry)
 *   - 集中放置 LspManager 内部共享类型
 *
 * 模块功能:
 *   - LspServerConfig: Server 配置(definition + rootUri + initializationOptions)
 *   - LspClient: 对外暴露的客户端契约
 *   - LspClientEntry: Manager 内部条目(含 process/pendingRequests/buffer)
 *   - LspClientState: 状态枚举
 *
 * 使用场景:
 *   - manager / client 共享数据结构
 *
 * 边界:
 *   1. LspClientEntry 是内部结构(包含 process/buffer)，不应被 Manager 外部直接持有
 *   2. 类型导出仅作契约，运行时由 LspManager 创建并维护
 *
 * 流程:
 *   1. Manager 启动时按语言创建 LspClientEntry
 *   2. 状态机在 stopped/starting/running/error 间迁移
 *   3. 外部消费方仅通过 LspClient 接口读取状态
 */
import type { LspServerDefinition } from "../registry/serverRegistry";
import type { LspDiagnostic } from "./managerProtocol";

/** LSP Server 配置 */
export interface LspServerConfig {
  /** Server 定义 */
  definition: LspServerDefinition;
  /** 工作目录(项目根目录) */
  rootUri: string;
  /** 额外初始化选项 */
  initializationOptions?: Record<string, unknown>;
}

/** LSP 客户端状态 */
export type LspClientState = "stopped" | "starting" | "running" | "error";

/** LSP 客户端实例 */
export interface LspClient {
  /** Server ID */
  serverId: string;
  /** 语言 ID */
  languageId: string;
  /** 当前状态 */
  state: LspClientState;
  /** 最后错误 */
  lastError?: string;
  /** 诊断缓存(文件 URI → 诊断列表) */
  diagnostics: Map<string, LspDiagnostic[]>;
}

export interface LspClientEntry {
  definition: LspServerDefinition;
  process: ReturnType<typeof Bun.spawn> | null;
  publicClient?: LspClient;
  state: LspClientState;
  lastError?: string;
  diagnostics: Map<string, LspDiagnostic[]>;
  requestId: number;
  pendingRequests: Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >;
  buffer: string;
  rootUri: string;
  contentLength: number | null;
  /** 最后一次请求/通知时间（用于空闲清理） */
  lastUsedAt?: number;
}
