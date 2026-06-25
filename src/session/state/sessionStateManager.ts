/**
 * 会话状态管理器 — 统一的状态管理层。
 *
 * 职责:
 *   - 桥接简单状态 (idle/busy/retry/error) 和完整状态机
 *   - 提供单一的状态管理入口
 *   - 协调 SessionStatus 和 StateMachine 的状态同步
 *   - 发布统一的状态变更事件
 *
 * 模块功能:
 *   - SessionStateManager: 统一状态管理器类
 *   - createSessionStateManager: 创建状态管理器实例
 *   - getSessionStateManager: 获取会话的状态管理器
 *
 * 状态映射:
 *   SessionStatus (旧) <-> StateMachine (新)
 *   idle         <-> INIT
 *   busy         <-> RUNNING
 *   retry        <-> WAITING
 *   error        <-> FAILED
 *
 * 使用场景:
 *   - 统一管理会话生命周期
 *   - 防止非法状态转换
 *   - 状态历史追踪
 *   - 竞态条件检测
 *
 * 边界:
 *   1. 每个会话 ID 对应一个状态管理器实例
 *   2. 状态变更会同步到 SessionStatus 和 StateMachine
 *   3. 状态机提供严格的转换验证
 *   4. SessionStatus 提供向后兼容的简单状态查询
 *
 * 流程:
 *   1. 创建状态管理器实例
 *   2. 使用 start/wait/complete/fail 等方法管理状态
 *   3. 使用 canExecute 检查是否可以执行
 *   4. 使用 getSnapshot 获取完整状态信息
 */
import { globalBus, type EventBus } from "@/bus";
import { AppEvent } from "@/bus";
import { createLogger } from "@/core/logging/logger";
import type { StateTransitionEvent } from "./stateMachine";
import { SessionState, SessionStateMachine, type StateMachineConfig, type StateTransition } from "./stateMachine";
import { type SessionStatus, getSessionStatus, setSessionStatus } from "./sessionStatus";

const log = createLogger("session:state-manager");

/** 统一状态管理器配置 */
export interface SessionStateManagerConfig {
  /** 是否启用状态机严格模式 */
  strictMode?: boolean;
  /** 状态机配置 */
  stateMachineConfig?: StateMachineConfig;
}

/** 统一状态信息 */
export interface UnifiedSessionState {
  sessionId: string;
  /** 简单状态(向后兼容) */
  status: SessionStatus;
  /** 完整状态机状态(精确语义) */
  rawState: SessionState;
  /** 是否处于终态 */
  isTerminal: boolean;
  /** 是否可以执行 */
  canExecute: boolean;
  /** 是否可以接受输入 */
  canAcceptInput: boolean;
  /** 转换次数 */
  transitionCount: number;
  /** 最后一次转换 */
  lastTransition: StateTransition | null;
}

/** 状态变更事件载荷(兼容 AppEvent.SessionStatusChanged) */
export interface SessionStateChangedPayload {
  sessionId: string;
  status: SessionStatus;
  previousStatus: SessionStatus;
  reason?: string;
}

/** 全局状态管理器存储 */
const stateManagers = new Map<string, SessionStateManager>();

/**
 * 会话状态管理器
 *
 * 统一管理会话状态，桥接简单状态和完整状态机。
 */
export class SessionStateManager {
  private readonly sessionId: string;
  private readonly stateMachine: SessionStateMachine;
  private readonly strictMode: boolean;
  private readonly eventBus: EventBus;

  constructor(sessionId: string, config: SessionStateManagerConfig = {}, eventBus: EventBus = globalBus) {
    this.sessionId = sessionId;
    this.strictMode = config.strictMode ?? true;
    this.eventBus = eventBus;

    // 创建状态机实例
    this.stateMachine = new SessionStateMachine(sessionId, SessionState.INIT, {
      ...config.stateMachineConfig,
      maxHistorySize: 100,
      onAfterTransition: (transition) => {
        this.handleStateTransition(transition);
      },
      trackHistory: true,
    });

    // 初始化 SessionStatus
    setSessionStatus(sessionId, "idle", "状态管理器初始化");

    log.debug(`会话状态管理器已创建: ${sessionId}`);
  }

  /**
   * 获取会话 ID
   */
  get sessionId_(): string {
    return this.sessionId;
  }

  /**
   * 获取当前完整状态
   */
  get state(): SessionState {
    return this.stateMachine.state;
  }

  /**
   * 获取简单状态(向后兼容)
   */
  get status(): SessionStatus {
    return this.mapStateToStatus(this.stateMachine.state);
  }

  /**
   * 检查是否为终态
   */
  isTerminal(): boolean {
    return this.stateMachine.isTerminal();
  }

  /**
   * 检查是否可以执行
   */
  canExecute(): boolean {
    return this.stateMachine.canExecute();
  }

  /**
   * 检查是否可以接受输入
   */
  canAcceptInput(): boolean {
    return this.stateMachine.canAcceptInput();
  }

  /**
   * 获取转换历史
   */
  getHistory(): readonly StateTransition[] {
    return this.stateMachine.getHistory();
  }

  /**
   * 获取转换次数
   */
  getTransitionCount(): number {
    return this.stateMachine.getTransitionCount();
  }

  /**
   * 开始执行 (INIT -> RUNNING)
   */
  async start(reason?: string): Promise<boolean> {
    try {
      const newState = await this.stateMachine.start(reason);
      log.info(`会话开始执行: ${this.sessionId}`, { reason });
      return newState === SessionState.RUNNING;
    } catch (error) {
      if (this.strictMode) {
        log.error(`启动失败: ${this.sessionId}`, { error });
      }
      return false;
    }
  }

  /**
   * 进入等待 (RUNNING -> WAITING)
   */
  async wait(reason?: string): Promise<boolean> {
    try {
      const newState = await this.stateMachine.wait(reason);
      log.info(`会话进入等待: ${this.sessionId}`, { reason });
      return newState === SessionState.WAITING;
    } catch (error) {
      if (this.strictMode) {
        log.error(`等待失败: ${this.sessionId}`, { error });
      }
      return false;
    }
  }

  /**
   * 恢复执行 (WAITING -> RUNNING)
   */
  async resume(reason?: string): Promise<boolean> {
    try {
      const newState = await this.stateMachine.resume(reason);
      log.info(`会话恢复执行: ${this.sessionId}`, { reason });
      return newState === SessionState.RUNNING;
    } catch (error) {
      if (this.strictMode) {
        log.error(`恢复失败: ${this.sessionId}`, { error });
      }
      return false;
    }
  }

  /**
   * 完成执行 (RUNNING/WAITING -> COMPLETED)
   */
  async complete(reason?: string): Promise<boolean> {
    try {
      const newState = await this.stateMachine.complete(reason);
      log.info(`会话完成: ${this.sessionId}`, { reason });
      return newState === SessionState.COMPLETED;
    } catch (error) {
      if (this.strictMode) {
        log.error(`完成失败: ${this.sessionId}`, { error });
      }
      return false;
    }
  }

  /**
   * 执行失败 (RUNNING/WAITING -> FAILED)
   */
  async fail(reason?: string): Promise<boolean> {
    try {
      const newState = await this.stateMachine.fail(reason);
      log.warn(`会话失败: ${this.sessionId}`, { reason });
      return newState === SessionState.FAILED;
    } catch (error) {
      if (this.strictMode) {
        log.error(`失败处理失败: ${this.sessionId}`, { error });
      }
      return false;
    }
  }

  /**
   * 取消执行 (任意状态 -> CANCELLED)
   */
  async cancel(reason?: string): Promise<boolean> {
    try {
      const newState = await this.stateMachine.cancel(reason);
      log.info(`会话已取消: ${this.sessionId}`, { reason });
      return newState === SessionState.CANCELLED;
    } catch (error) {
      if (this.strictMode) {
        log.error(`取消失败: ${this.sessionId}`, { error });
      }
      return false;
    }
  }

  /**
   * 重置状态机 (终态 -> INIT)
   */
  async reset(reason?: string): Promise<boolean> {
    try {
      const newState = await this.stateMachine.reset(reason);
      log.info(`会话已重置: ${this.sessionId}`, { reason });
      return newState === SessionState.INIT;
    } catch (error) {
      if (this.strictMode) {
        log.error(`重置失败: ${this.sessionId}`, { error });
      }
      return false;
    }
  }

  /**
   * 尝试状态转换(不抛异常)
   */
  async tryTransition(event: StateTransitionEvent, reason?: string): Promise<[boolean, SessionState | string]> {
    return await this.stateMachine.tryTransition(event, reason);
  }

  /**
   * 获取统一状态快照
   */
  getSnapshot(): UnifiedSessionState {
    return {
      canAcceptInput: this.canAcceptInput(),
      canExecute: this.canExecute(),
      isTerminal: this.isTerminal(),
      lastTransition: this.stateMachine.getHistory()[this.stateMachine.getHistory().length - 1] ?? null,
      rawState: this.state,
      sessionId: this.sessionId,
      status: this.status,
      transitionCount: this.getTransitionCount(),
    };
  }

  /**
   * 销毁状态管理器
   */
  destroy(): void {
    this.stateMachine.destroy();
    stateManagers.delete(this.sessionId);
    log.debug(`会话状态管理器已销毁: ${this.sessionId}`);
  }

  /**
   * 处理状态转换
   */
  private handleStateTransition(transition: StateTransition): void {
    const newStatus = this.mapStateToStatus(transition.to);
    // 统一通过 sessionStatus 负责事件发布，避免双发。
    setSessionStatus(this.sessionId, newStatus, `状态转换: ${transition.from} -> ${transition.to}`);
  }

  /**
   * 将 StateMachine 状态映射到简单 SessionStatus。
   *
   * 映射规则:
   *   INIT       → idle        (初始空闲)
   *   RUNNING    → busy        (执行中)
   *   WAITING    → waiting     (等待子代理或用户输入)
   *   COMPLETED  → completed   (正常完成)
   *   FAILED     → error       (失败，兼容现有消费者对 "error" 的检查)
   *   CANCELLED  → cancelled   (用户取消)
   *
   * 注意: SessionStatus 中的 "retry" 和 "failed" 由 sessionStatus 直接管理，
   * 不经过状态机映射。"retry" 用于 LLM 降级重试场景。
   */
  private mapStateToStatus(state: SessionState): SessionStatus {
    switch (state) {
      case SessionState.INIT: {
        return "idle";
      }
      case SessionState.RUNNING: {
        return "busy";
      }
      case SessionState.WAITING: {
        return "waiting";
      }
      case SessionState.COMPLETED: {
        return "completed";
      }
      case SessionState.FAILED: {
        return "error";
      }
      case SessionState.CANCELLED: {
        return "cancelled";
      }
      default: {
        return "idle";
      }
    }
  }
}

/**
 * 创建或获取会话状态管理器
 */
export function getOrCreateSessionStateManager(
  sessionId: string,
  config?: SessionStateManagerConfig,
): SessionStateManager {
  let manager = stateManagers.get(sessionId);
  if (!manager) {
    manager = new SessionStateManager(sessionId, config);
    stateManagers.set(sessionId, manager);
  }
  return manager;
}

/**
 * 获取会话状态管理器(如果不存在返回 null)
 */
export function getSessionStateManager(sessionId: string): SessionStateManager | null {
  return stateManagers.get(sessionId) ?? null;
}

/**
 * 获取所有状态管理器
 */
export function getAllSessionStateManagers(): Map<string, SessionStateManager> {
  return new Map(stateManagers);
}

/**
 * 销毁会话状态管理器
 */
export function destroySessionStateManager(sessionId: string): boolean {
  const manager = stateManagers.get(sessionId);
  if (manager) {
    manager.destroy();
    return true;
  }
  return false;
}

/**
 * 销毁所有状态管理器
 */
export function destroyAllSessionStateManagers(): number {
  const count = stateManagers.size;
  for (const manager of stateManagers.values()) {
    manager.destroy();
  }
  return count;
}
