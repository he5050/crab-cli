/**
 * PermissionManager — 权限管理器。
 *
 * 职责:
 *   - 管理权限审批状态
 *   - 处理用户审批交互
 *   - 持久化审批结果
 *   - 维护已批准/拒绝的规则列表
 *
 * 模块功能:
 *   - PermissionManager: 权限管理器类
 *   - PermissionAskInput: 权限询问输入类型
 *   - ApprovalAction: 审批动作类型
 *   - ask: 请求权限
 *   - reply: 回复权限请求
 *   - isApproved: 检查是否已批准
 *   - isDenied: 检查是否已拒绝
 *   - getApprovedRules: 获取已批准规则
 *   - getDeniedRules: 获取已拒绝规则
 *   - clear: 清除所有规则
 *   - destroy: 销毁管理器
 *
 * 使用场景:
 *   - 工具调用前权限检查
 *   - 用户权限审批交互
 *   - 持久化用户审批选择
 *   - 管理权限规则集
 *
 * 边界:
 *   1. 权限评估委托给 evaluate() 函数
 *   2. UI 交互通过 EventBus 实现
 *   3. 支持会话级和持久化审批
 *   4. 启动时清理过期记录
 *
 * 流程:
 *   1. 创建 PermissionManager 实例
 *   2. 调用 ask 请求权限
 *   3. 通过 EventBus 通知 UI 显示审批界面
 *   4. 用户选择后调用 reply 回复
 *   5. 持久化审批结果
 *   6. 后续检查使用 isApproved/isDenied
 */
import { evaluate } from "../core/evaluate";
import type { PermissionRule, PermissionRuleset, ApprovalAction } from "@/schema/permission";
import { globalBus, type EventBus } from "@/bus";
import { AppEvent } from "@/bus";
import { createLogger } from "@/core/logging/logger";
import { type IApprovalRepository, createSqliteApprovalRepository } from "../store/approvalStore";
import { uuid } from "@/core/id";
import { classifyRiskLevel } from "../security/riskPatterns";
import { normalizeApprovalAction } from "../core/normalize";

const log = createLogger("permission");
const APPROVAL_ABORTED = Symbol("approval-aborted");

/** 权限请求输入 */
export interface PermissionAskInput {
  /** 权限类型(如 "bash"、"fs.write") */
  permission: string;
  /** 操作模式数组(如 ["rm -rf node_modules"]) */
  patterns: string[];
  /** 触发的工具名称 */
  tool: string;
  /** 所属会话 ID，用于跨进程/远程审批隔离 */
  sessionId?: string;
  /** 附加描述 */
  description?: string;
}

/** 审批动作（从 schema/permission 重导出，保持向后兼容） */
export type { ApprovalAction } from "@/schema/permission";

/** preCheck 预检结果项 */
export interface PermissionCheckResultItem {
  pattern: string;
  action: "allow" | "deny" | "ask";
  source: "session-approve" | "session-deny" | "default" | "persisted-approve" | "persisted-deny";
}

interface PendingRequest {
  resolve: (value: boolean) => void;
  input: PermissionAskInput;
}

/**
 * 权限管理器。
 * 维护已批准的规则列表，处理权限请求。
 */
export class PermissionManager {
  /** 用户批准的规则(会话级) */
  private approved: PermissionRuleset = [];

  /** 用户拒绝的规则(会话级) */
  private denied: PermissionRuleset = [];

  /** 等待审批的请求 */
  private pending = new Map<string, PendingRequest>();

  /** 标记实例是否已销毁 */
  private destroyed = false;

  /** 全局默认规则 */
  private defaultRules: PermissionRuleset;

  /** 全局权限回复事件订阅 */
  private unsubResolved: (() => void) | undefined;

  /** Abort 监听清理函数 */
  private unsubAbort: (() => void) | undefined;

  /** Abort signal 引用(ask 入口检查用) */
  private abortSignal?: AbortSignal;

  /** 当前会话 ID */
  private sessionId: string;
  /** 自定义审批桥(用于后台/跨进程请求) */
  private requestApprovalHandler?: (input: PermissionAskInput) => Promise<ApprovalAction | boolean>;

  /** EventBus 实例 */
  private readonly eventBus: EventBus;

  /** 审批存储 */
  private readonly repository: IApprovalRepository;

  constructor(
    defaultRules: PermissionRuleset = [],
    sessionId = "default",
    requestApprovalHandler?: (input: PermissionAskInput) => Promise<ApprovalAction | boolean>,
    abortSignal?: AbortSignal,
    eventBus: EventBus = globalBus,
    repository?: IApprovalRepository,
  ) {
    this.defaultRules = defaultRules;
    this.sessionId = sessionId;
    this.requestApprovalHandler = requestApprovalHandler;
    this.abortSignal = abortSignal;
    this.eventBus = eventBus;
    this.repository = repository ?? createSqliteApprovalRepository();
    this.unsubResolved = this.eventBus.subscribe(AppEvent.PermissionResolved, (evt) => {
      this.reply(evt.properties.id, evt.properties.action ?? (evt.properties.allowed ? "once" : "reject"));
    });
    // 监听 abort signal，自动拒绝所有待确认请求
    if (abortSignal) {
      if (abortSignal.aborted) {
        this.abortAllPending();
      } else {
        const onAbort = () => this.abortAllPending();
        abortSignal.addEventListener("abort", onAbort, { once: true });
        this.unsubAbort = () => abortSignal.removeEventListener("abort", onAbort);
      }
    }
    // 启动时清理过期记录（SQLite 未初始化时静默跳过）
    try {
      this.repository.cleanExpired();
    } catch {
      log.debug("清理过期记录失败（数据库可能未初始化）");
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.unsubResolved?.();
    this.unsubResolved = undefined;
    this.unsubAbort?.();
    this.unsubAbort = undefined;
    this.pending.clear();
  }

  /**
   * 检查操作是否被允许。
   * 如果没有匹配规则，发布 PermissionAsked 事件等待用户审批。
   *
   * @param input - 权限请求
   * @returns 是否允许
   */
  async ask(input: PermissionAskInput): Promise<boolean> {
    // 入口检查: 如果实例已销毁，直接报错
    if (this.destroyed) {
      throw new Error("PermissionManager 已销毁");
    }

    // 入口检查:如果已 abort，直接拒绝
    if (this.abortSignal?.aborted) {
      return false;
    }

    // 0. 先检查持久化审批存储（精确匹配 → 通配符匹配回退）
    for (const pattern of input.patterns) {
      const persisted =
        this.repository.getApproval(input.permission, pattern) ??
        this.repository.findApproval(input.permission, pattern);
      if (persisted) {
        log.debug(`命中持久化审批: ${input.permission} ${pattern} → ${persisted.decision}`);
        if (persisted.decision === "deny") {
          return false;
        }
        // Allow — 仅添加到会话级规则避免重复查询（不再次写入 SQLite）
        this.approved.push({
          action: "allow",
          metadata: { createdAt: Date.now(), persistent: false },
          pattern,
          permission: input.permission,
        });
      }
    }

    // 1. 先检查拒绝列表
    for (const pattern of input.patterns) {
      const deniedResult = evaluate(input.permission, pattern, this.denied);
      if (deniedResult.action === "deny") {
        log.warn(`权限拒绝: ${input.permission} ${pattern}`);
        return false;
      }
    }

    // 2. 检查已批准列表
    let allApproved = true;
    for (const pattern of input.patterns) {
      const approvedResult = evaluate(input.permission, pattern, this.approved);
      if (approvedResult.action !== "allow") {
        allApproved = false;
        break;
      }
    }
    if (allApproved) {
      return true;
    }

    // 3. 检查默认规则
    const defaultResult = this.evaluateDefault(input.permission, input.patterns);
    if (defaultResult.action === "deny") {
      log.warn(`默认规则拒绝: ${input.permission}`);
      return false;
    }
    if (defaultResult.action === "allow") {
      return true;
    }
    // ask — 需要用户确认

    // 4. 需要用户审批 → 发布事件等待
    return this.requestUserApproval(input);
  }

  /**
   * 处理用户审批回复。
   *
   * @param id - 请求 ID
   * @param action - 审批动作
   */
  reply(id: string, action: ApprovalAction): void {
    const pendingRequest = this.pending.get(id);
    if (!pendingRequest) {
      log.debug(`忽略非当前会话的审批响应: ${id}`);
      return;
    }

    const { resolve: resolveRequest, input } = pendingRequest;

    if (action === "always") {
      for (const pattern of input.patterns) {
        this.approve(input.permission, pattern, true);
      }
    }

    if (action === "reject") {
      // 自动添加 deny 规则（会话级），避免重复弹窗
      for (const pattern of input.patterns) {
        this.deny(input.permission, pattern, false);
      }
      resolveRequest(false);
    } else {
      resolveRequest(true);
    }

    this.pending.delete(id);
    this.eventBus.publish(AppEvent.PermissionStatus, {
      action,
      allowed: action !== "reject",
      id,
      permission: input.permission,
      sessionId: this.sessionId,
      status: "resolved",
      tool: input.tool,
    });
  }

  /**
   * 添加一条已批准规则。
   */
  approve(permission: string, pattern: string, persistent = false): void {
    const rule: PermissionRule = {
      action: "allow",
      metadata: { createdAt: Date.now(), persistent },
      pattern,
      permission,
    };
    this.approved.push(rule);
    log.info(`权限已批准: ${permission} ${pattern}${persistent ? " (持久)" : " (会话)"}`);

    // 持久化到 SQLite
    if (persistent) {
      this.repository.saveApproval({
        decision: "allow",
        expiresAt: null, // 持久审批不过期
        pattern,
        permission,
        sessionId: this.sessionId,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * 添加一条拒绝规则。
   */
  deny(permission: string, pattern: string, persistent = false): void {
    this.denied.push({ action: "deny", pattern, permission });
    log.info(`权限已拒绝: ${permission} ${pattern}${persistent ? " (持久)" : ""}`);

    // 持久化到 SQLite
    if (persistent) {
      this.repository.saveApproval({
        decision: "deny",
        expiresAt: null,
        pattern,
        permission,
        sessionId: this.sessionId,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Abort 触发时，自动拒绝所有待确认请求。
   */
  private abortAllPending(): void {
    for (const [id, pending] of this.pending) {
      log.info(`abort 触发，自动拒绝待确认请求: ${id}`);
      pending.resolve(false);
    }
    this.pending.clear();
  }

  /**
   * 获取所有已批准规则。
   */
  getApprovedRules(): PermissionRuleset {
    return [...this.approved];
  }

  /**
   * 获取所有待审批请求。
   */
  getPendingRequests(): string[] {
    return [...this.pending.keys()];
  }

  /**
   * 清除会话级规则。
   */
  clearSession(): void {
    this.approved = this.approved.filter((r) => r.metadata?.persistent);
    this.denied = [];
    this.pending.clear();
  }

  /**
   * 预检权限状态（不触发用户审批，不持久化）。
   * 返回每个 pattern 的评估结果。
   *
   * 与 ask() 的区别:
   *   - preCheck 不检查持久化审批记录（仅检查会话级规则）
   *   - preCheck 不触发用户审批交互
   *   - preCheck 的 default 规则评估是逐 pattern 独立的
   *   - ask() 的 default 规则评估是跨 pattern 的（任一 deny → 整体 deny）
   *
   * 适用场景: UI 展示权限状态预览、工具调用前的快速检查。
   * 如需包含持久化审批的完整检查，请使用 ask()。
   *
   * @returns 评估结果数组
   */
  preCheck(input: PermissionAskInput): PermissionCheckResultItem[] {
    const results: PermissionCheckResultItem[] = [];
    for (const pattern of input.patterns) {
      // 检查 denied
      const deniedResult = evaluate(input.permission, pattern, this.denied);
      if (deniedResult.action === "deny") {
        results.push({ pattern, action: "deny", source: "session-deny" });
        continue;
      }
      // 检查 approved
      const approvedResult = evaluate(input.permission, pattern, this.approved);
      if (approvedResult.action === "allow") {
        results.push({ pattern, action: "allow", source: "session-approve" });
        continue;
      }
      // 检查 default（逐 pattern 独立评估，不受其他 pattern 影响）
      const defaultResult = this.evaluateDefault(input.permission, [pattern]);
      results.push({ pattern, action: defaultResult.action, source: "default" });
    }
    return results;
  }

  /**
   * 评估默认规则。
   * 遍历所有 patterns，优先级: deny > ask > allow。
   * 单趟扫描：记录最高优先级，deny 一票否决。
   */
  private evaluateDefault(permission: string, patterns: string[]): { action: "allow" | "deny" | "ask" } {
    let hasAsk = false;
    for (const pattern of patterns) {
      const result = evaluate(permission, pattern, this.defaultRules);
      if (result.action === "deny") {
        return { action: "deny" };
      }
      if (result.action === "ask") {
        hasAsk = true;
      }
    }
    return hasAsk ? { action: "ask" } : { action: "allow" };
  }

  /**
   * 请求用户审批。
   */
  private requestUserApproval(input: PermissionAskInput): Promise<boolean> {
    if (this.requestApprovalHandler) {
      return this.requestApprovalWithAbort(input);
    }

    const id = uuid();
    const { promise, resolve } = Promise.withResolvers<boolean>();
    this.pending.set(id, { resolve, input });

    const riskLevel = classifyRiskLevel(input.permission, input.patterns);

    this.eventBus.publish(AppEvent.PermissionAsked, {
      description: input.description,
      id,
      patterns: input.patterns,
      permission: input.permission,
      riskLevel,
      sessionId: this.sessionId,
      tool: input.tool,
    });

    log.info(`等待用户审批: ${input.permission} ${input.patterns.join(", ")} (风险: ${riskLevel})`);

    return promise;
  }

  private async requestApprovalWithAbort(input: PermissionAskInput): Promise<boolean> {
    if (this.abortSignal?.aborted) {
      return false;
    }

    const handlerPromise = this.requestApprovalHandler!(input);
    if (!this.abortSignal) {
      return this.handleApprovalDecision(input, await handlerPromise);
    }

    let cleanupAbort = () => {};
    const abortPromise = new Promise<typeof APPROVAL_ABORTED>((resolve) => {
      const onAbort = () => resolve(APPROVAL_ABORTED);
      this.abortSignal!.addEventListener("abort", onAbort, { once: true });
      cleanupAbort = () => this.abortSignal!.removeEventListener("abort", onAbort);
    });

    const decision = await Promise.race([handlerPromise, abortPromise]).finally(cleanupAbort);
    if (decision === APPROVAL_ABORTED || this.abortSignal.aborted) {
      return false;
    }

    return this.handleApprovalDecision(input, decision);
  }

  private handleApprovalDecision(input: PermissionAskInput, decision: ApprovalAction | boolean): boolean {
    const action = normalizeApprovalAction(decision);
    const riskLevel = classifyRiskLevel(input.permission, input.patterns);

    if (action === "always" && riskLevel === "high") {
      log.warn(
        `高风险操作禁止 "always" 永久授权: ${input.permission} ${input.patterns.join(", ")} (风险: ${riskLevel})`,
      );
      // 发布降级事件通知 UI：用户选择的 "always" 被降级为 "once"
      this.eventBus.publish(AppEvent.PermissionStatus, {
        action: "once",
        allowed: true,
        id: "downgrade",
        permission: input.permission,
        sessionId: this.sessionId,
        status: "resolved",
        tool: input.tool,
      });
      for (const pattern of input.patterns) {
        this.approve(input.permission, pattern, false);
      }
      return true;
    }

    if (action === "always") {
      for (const pattern of input.patterns) {
        this.approve(input.permission, pattern, true);
      }
      return true;
    }

    if (action === "reject") {
      // 与 reply() 一致：添加会话级 deny 规则，避免重复弹窗
      for (const pattern of input.patterns) {
        this.deny(input.permission, pattern, false);
      }
    }

    return action !== "reject";
  }
}
