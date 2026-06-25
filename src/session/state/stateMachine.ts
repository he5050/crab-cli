/**
 * 会话状态机 (Session State Machine)
 *
 * 职责:
 *   - 定义严格的会话生命周期状态转换规则
 *   - 防止非法状态转换和竞态条件
 *   - 提供状态历史追踪
 *
 * 模块功能:
 *   - SessionState: 会话生命周期状态枚举
 *   - StateTransition: 状态转换记录
 *   - SessionStateMachine: 状态机类
 *   - createSessionStateMachine: 创建状态机实例
 *
 * 状态定义:
 *   - INIT: 初始状态，会话刚创建
 *   - RUNNING: 运行中，Agent 正在执行
 *   - WAITING: 等待中，等待用户输入或子代理结果
 *   - COMPLETED: 已完成，正常结束
 *   - FAILED: 失败，出错结束
 *   - CANCELLED: 已取消，被用户中断
 *
 * 合法状态转换:
 *   INIT -> RUNNING (开始执行)
 *   INIT -> CANCELLED (用户取消)
 *   RUNNING -> WAITING (等待子代理或用户)
 *   RUNNING -> COMPLETED (执行成功)
 *   RUNNING -> FAILED (执行失败)
 *   RUNNING -> CANCELLED (用户取消)
 *   WAITING -> RUNNING (恢复执行)
 *   WAITING -> COMPLETED (完成)
 *   WAITING -> FAILED (失败)
 *   WAITING -> CANCELLED (取消)
 *   COMPLETED -> INIT (重置)
 *   FAILED -> INIT (重置)
 *   CANCELLED -> INIT (重置)
 *
 * 使用场景:
 *   - Session 生命周期管理
 *   - 防止非法状态转换
 *   - 竞态条件检测
 *   - 状态历史追踪
 *
 * 边界:
 *   1. 状态机实例与 Session ID 一一对应
 *   2. 非法状态转换会被拒绝并记录警告
 *   3. 支持并发访问，但会检测竞态条件
 */

import { createLogger } from "@/core/logging/logger";
import { Mutex } from "async-mutex";

const log = createLogger("session:state-machine");

// ─── 类型定义 ────────────────────────────────────────────────────

/** 会话生命周期状态 */
export enum SessionState {
  /** 初始状态，会话刚创建 */
  INIT = "init",
  /** 运行中，Agent 正在执行 */
  RUNNING = "running",
  /** 等待中，等待用户输入或子代理结果 */
  WAITING = "waiting",
  /** 已完成，正常结束 */
  COMPLETED = "completed",
  /** 失败，出错结束 */
  FAILED = "failed",
  /** 已取消，被用户中断 */
  CANCELLED = "cancelled",
}

/** 状态转换事件 */
export enum StateTransitionEvent {
  START = "start", // 开始执行
  WAIT = "wait", // 进入等待
  RESUME = "resume", // 恢复执行
  COMPLETE = "complete", // 完成
  FAIL = "fail", // 失败
  CANCEL = "cancel", // 取消
  RESET = "reset", // 重置
}

/** 状态转换记录 */
export interface StateTransition {
  from: SessionState;
  to: SessionState;
  event: StateTransitionEvent;
  timestamp: number;
  reason?: string;
}

/** 状态转换错误 */
export class InvalidStateTransitionError extends Error {
  constructor(
    public readonly sessionId: string,
    public readonly currentState: SessionState,
    public readonly targetState: SessionState,
    public readonly event: StateTransitionEvent,
  ) {
    super(`非法状态转换 [${sessionId}]: ${currentState} --[${event}]--> ${targetState}`);
    this.name = "InvalidStateTransitionError";
  }
}

/** 状态机配置 */
export interface StateMachineConfig {
  /** 是否允许从终态重置到 INIT */
  allowResetFromTerminal?: boolean;
  /** 是否记录状态历史 */
  trackHistory?: boolean;
  /** 最大历史记录数 */
  maxHistorySize?: number;
  /** 状态转换前校验回调 */
  onBeforeTransition?: (from: SessionState, to: SessionState, event: StateTransitionEvent) => boolean;
  /** 状态转换后回调 */
  onAfterTransition?: (transition: StateTransition) => void;
}

/** 状态机完整配置(带默认值) */
interface ResolvedStateMachineConfig {
  allowResetFromTerminal: boolean;
  trackHistory: boolean;
  maxHistorySize: number;
  onBeforeTransition?: (from: SessionState, to: SessionState, event: StateTransitionEvent) => boolean;
  onAfterTransition?: (transition: StateTransition) => void;
}

// ─── 状态转换规则 ────────────────────────────────────────────────

/** 合法状态转换映射 */
const VALID_TRANSITIONS: Record<SessionState, Partial<Record<StateTransitionEvent, SessionState>>> = {
  [SessionState.INIT]: {
    [StateTransitionEvent.START]: SessionState.RUNNING,
    [StateTransitionEvent.CANCEL]: SessionState.CANCELLED,
  },
  [SessionState.RUNNING]: {
    [StateTransitionEvent.WAIT]: SessionState.WAITING,
    [StateTransitionEvent.COMPLETE]: SessionState.COMPLETED,
    [StateTransitionEvent.FAIL]: SessionState.FAILED,
    [StateTransitionEvent.CANCEL]: SessionState.CANCELLED,
  },
  [SessionState.WAITING]: {
    [StateTransitionEvent.RESUME]: SessionState.RUNNING,
    [StateTransitionEvent.COMPLETE]: SessionState.COMPLETED,
    [StateTransitionEvent.FAIL]: SessionState.FAILED,
    [StateTransitionEvent.CANCEL]: SessionState.CANCELLED,
  },
  [SessionState.COMPLETED]: {
    [StateTransitionEvent.RESET]: SessionState.INIT,
  },
  [SessionState.FAILED]: {
    [StateTransitionEvent.RESET]: SessionState.INIT,
  },
  [SessionState.CANCELLED]: {
    [StateTransitionEvent.RESET]: SessionState.INIT,
  },
};

/** 终态集合(不可自动恢复) */
const TERMINAL_STATES = new Set([SessionState.COMPLETED, SessionState.FAILED, SessionState.CANCELLED]);

/** 是否为终态 */
export function isTerminalState(state: SessionState): boolean {
  return TERMINAL_STATES.has(state);
}

/** 是否可以接受输入 */
export function canAcceptInput(state: SessionState): boolean {
  return state === SessionState.INIT;
}

/** 是否可以执行 */
export function canExecute(state: SessionState): boolean {
  return state === SessionState.INIT || state === SessionState.RUNNING || state === SessionState.WAITING;
}

// ─── 状态机类 ────────────────────────────────────────────────────

/**
 * 会话状态机
 *
 * 严格管理会话生命周期状态，防止非法转换和竞态条件。
 */
export class SessionStateMachine {
  private readonly sessionId: string;
  private _state: SessionState;
  private readonly config: ResolvedStateMachineConfig;
  private history: StateTransition[] = [];
  private readonly transitionMutex: Mutex = new Mutex();

  constructor(sessionId: string, initialState: SessionState = SessionState.INIT, config: StateMachineConfig = {}) {
    this.sessionId = sessionId;
    this._state = initialState;
    this.config = {
      allowResetFromTerminal: config.allowResetFromTerminal ?? true,
      maxHistorySize: config.maxHistorySize ?? 100,
      onAfterTransition: config.onAfterTransition,
      onBeforeTransition: config.onBeforeTransition,
      trackHistory: config.trackHistory ?? true,
    };

    log.debug(`状态机初始化: ${sessionId} -> ${initialState}`);
  }

  /**
   * 获取当前状态
   */
  get state(): SessionState {
    return this._state;
  }

  /**
   * 获取当前状态(兼容旧 API)
   */
  getStatus(): SessionState {
    return this._state;
  }

  /**
   * 检查状态是否为终态
   */
  isTerminal(): boolean {
    return isTerminalState(this._state);
  }

  /**
   * 检查是否可以接受输入
   */
  canAcceptInput(): boolean {
    return canAcceptInput(this._state);
  }

  /**
   * 检查是否可以执行
   */
  canExecute(): boolean {
    return canExecute(this._state);
  }

  /**
   * 获取状态历史
   */
  getHistory(): readonly StateTransition[] {
    return this.history;
  }

  /**
   * 获取转换次数统计
   */
  getTransitionCount(): number {
    return this.history.length;
  }

  /**
   * 执行状态转换
   *
   * @param event 转换事件
   * @param reason 可选的转换原因
   * @returns 转换后的状态
   * @throws InvalidStateTransitionError 非法转换
   */
  async transition(event: StateTransitionEvent, reason?: string): Promise<SessionState> {
    return await this.transitionMutex.runExclusive(async () => {
      // 获取合法目标状态
      const validTargets = VALID_TRANSITIONS[this._state];
      if (!validTargets) {
        log.error(`未知状态 [${this.sessionId}]: ${this._state}`);
        throw new InvalidStateTransitionError(this.sessionId, this._state, this._state, event);
      }

      const targetState = validTargets[event];
      if (!targetState) {
        const allowedEvents = Object.keys(validTargets).join(", ");
        log.warn(`非法状态转换 [${this.sessionId}]: ${this._state} --[${event}]--> ? ` + `(允许: ${allowedEvents})`);
        throw new InvalidStateTransitionError(this.sessionId, this._state, targetState!, event);
      }

      // 检查终态重置限制
      if (this.isTerminal() && event === StateTransitionEvent.RESET && !this.config.allowResetFromTerminal) {
        log.warn(`终态重置被禁止 [${this.sessionId}]: ${this._state} 不允许重置`);
        throw new InvalidStateTransitionError(this.sessionId, this._state, SessionState.INIT, event);
      }

      // 前置校验回调
      if (this.config.onBeforeTransition && !this.config.onBeforeTransition(this._state, targetState, event)) {
        log.debug(`状态转换被前置回调拒绝 [${this.sessionId}]: ${this._state} --[${event}]--> ${targetState}`);
        return this._state;
      }

      // 执行转换
      const previousState = this._state;
      this._state = targetState;

      // RESET 事件时清空历史
      if (event === StateTransitionEvent.RESET) {
        this.history = [];
      }

      // 记录历史
      if (this.config.trackHistory && event !== StateTransitionEvent.RESET) {
        const transition: StateTransition = {
          event,
          from: previousState,
          reason,
          timestamp: Date.now(),
          to: targetState,
        };
        this.history.push(transition);

        // 限制历史大小
        if (this.history.length > this.config.maxHistorySize) {
          this.history = this.history.slice(-this.config.maxHistorySize);
        }
      }

      // 后置回调
      if (this.config.onAfterTransition) {
        try {
          this.config.onAfterTransition({
            event,
            from: previousState,
            reason,
            timestamp: Date.now(),
            to: targetState,
          });
        } catch (error) {
          log.error(`状态转换后回调执行失败 [${this.sessionId}]`, { error });
        }
      }

      log.debug(
        `状态转换 [${this.sessionId}]: ${previousState} --[${event}]--> ${targetState}${reason ? ` (${reason})` : ""}`,
      );

      return targetState;
    });
  }

  /**
   * 尝试状态转换(不抛异常)
   *
   * @returns [是否成功, 转换后的状态或错误信息]
   */
  async tryTransition(event: StateTransitionEvent, reason?: string): Promise<[boolean, SessionState | string]> {
    try {
      const newState = await this.transition(event, reason);
      return [true, newState];
    } catch (error) {
      if (error instanceof InvalidStateTransitionError) {
        return [false, error.message];
      }
      throw error;
    }
  }

  /**
   * 启动执行 (INIT -> RUNNING)
   */
  async start(reason?: string): Promise<SessionState> {
    return await this.transition(StateTransitionEvent.START, reason);
  }

  /**
   * 进入等待 (RUNNING -> WAITING)
   */
  async wait(reason?: string): Promise<SessionState> {
    return await this.transition(StateTransitionEvent.WAIT, reason);
  }

  /**
   * 恢复执行 (WAITING -> RUNNING)
   */
  async resume(reason?: string): Promise<SessionState> {
    return await this.transition(StateTransitionEvent.RESUME, reason);
  }

  /**
   * 完成执行 (RUNNING/WAITING -> COMPLETED)
   */
  async complete(reason?: string): Promise<SessionState> {
    return await this.transition(StateTransitionEvent.COMPLETE, reason);
  }

  /**
   * 执行失败 (RUNNING/WAITING -> FAILED)
   */
  async fail(reason?: string): Promise<SessionState> {
    return await this.transition(StateTransitionEvent.FAIL, reason);
  }

  /**
   * 取消执行 (任意状态 -> CANCELLED，除了终态)
   */
  async cancel(reason?: string): Promise<SessionState> {
    return await this.transition(StateTransitionEvent.CANCEL, reason);
  }

  /**
   * 重置状态机 (终态 -> INIT)
   */
  async reset(reason?: string): Promise<SessionState> {
    return await this.transition(StateTransitionEvent.RESET, reason);
  }

  /**
   * 销毁状态机
   */
  destroy(): void {
    this.history = [];
    log.debug(`状态机销毁 [${this.sessionId}]`);
  }

  /**
   * 获取状态快照(用于调试和日志)
   */
  getSnapshot(): {
    sessionId: string;
    state: SessionState;
    isTerminal: boolean;
    transitionCount: number;
    lastTransition: StateTransition | null;
  } {
    return {
      isTerminal: this.isTerminal(),
      lastTransition: this.history[this.history.length - 1] ?? null,
      sessionId: this.sessionId,
      state: this._state,
      transitionCount: this.history.length,
    };
  }
}

/**
 * 创建会话状态机实例
 */
export function createSessionStateMachine(
  sessionId: string,
  initialState: SessionState = SessionState.INIT,
  config?: StateMachineConfig,
): SessionStateMachine {
  return new SessionStateMachine(sessionId, initialState, config);
}

/**
 * 创建带日志的状态机(生产环境使用)
 */
export function createLoggedStateMachine(
  sessionId: string,
  initialState: SessionState = SessionState.INIT,
  onTransition?: (transition: StateTransition) => void,
): SessionStateMachine {
  return new SessionStateMachine(sessionId, initialState, {
    maxHistorySize: 100,
    onAfterTransition: onTransition,
    trackHistory: true,
  });
}

/**
 * 创建受保护的状态机(不允许从终态重置)
 */
export function createProtectedStateMachine(
  sessionId: string,
  initialState: SessionState = SessionState.INIT,
): SessionStateMachine {
  return new SessionStateMachine(sessionId, initialState, {
    allowResetFromTerminal: false,
    maxHistorySize: 50,
    trackHistory: true,
  });
}

/**
 * 检查两个状态是否可以转换
 */
export function canTransition(from: SessionState, to: SessionState, event: StateTransitionEvent): boolean {
  const validTargets = VALID_TRANSITIONS[from];
  return validTargets?.[event] === to;
}

/**
 * 获取从指定状态可以进行的转换
 */
export function getAvailableTransitions(state: SessionState): StateTransitionEvent[] {
  const validTargets = VALID_TRANSITIONS[state];
  return Object.keys(validTargets) as StateTransitionEvent[];
}
