/**
 * 滚动加速工具 — 根据连续滚动速度计算加速因子。
 *
 * 职责:
 *   - 跟踪连续滚动事件的时间间隔
 *   - 根据滚动速度计算加速因子
 *   - 提供 ScrollAcceleration 接口实现
 *
 * 模块功能:
 *   - getScrollAcceleration(config): 创建滚动加速器实例
 *   - CrabScrollAccel: 自定义滚动加速实现
 *
 * 使用场景:
 *   - 消息列表 scrollbox 的 scrollAcceleration 属性
 *   - 长列表快速滚动加速
 *   - 精细滚动控制
 *
 * 边界:
 *   1. 实现 OpenTUI 的 ScrollAcceleration 接口
 *   2. 基于 macOS 风格的指数加速曲线
 *   3. 支持配置阈值和倍率
 *
 * 流程:
 *   1. 每次 tick() 调用记录当前时间戳
 *   2. 维护最近 N 次间隔的滑动窗口
 *   3. 平均间隔决定加速倍率
 *   4. 超时后重置加速状态
 */
import type { ScrollAcceleration } from "@opentui/core";

/** 滚动加速配置 */
export interface ScrollAccelerationConfig {
  /** 慢速阈值(ms)，间隔大于此值不加速，默认 200 */
  threshold1?: number;
  /** 快速阈值(ms)，间隔小于此值启用最高加速，默认 80 */
  threshold2?: number;
  /** 中速倍率，默认 1.5 */
  multiplier1?: number;
  /** 快速倍率，默认 2.5 */
  multiplier2?: number;
  /** 基础倍率(慢速)，默认 1 */
  baseMultiplier?: number;
  /** 连续超时(ms)，超过此时间无滚动则重置，默认 300 */
  streakTimeout?: number;
}

/**
 * crab-cli 自定义滚动加速器。
 *
 * 基于 macOS 风格的指数加速曲线:
 *   - 慢速滚动(baseMultiplier): 精确控制
 *   - 中速滚动(multiplier1): 适度加速
 *   - 快速连续滚动(multiplier2): 高速翻页
 *
 * 实现 OpenTUI 的 ScrollAcceleration 接口，可直接用于 scrollbox 的 scrollAcceleration 属性。
 */
export class CrabScrollAccel implements ScrollAcceleration {
  private opts: Required<ScrollAccelerationConfig>;
  private lastTickTime: number | null = null;
  private velocityHistory: number[] = [];
  private readonly historySize = 5;

  constructor(config: ScrollAccelerationConfig = {}) {
    this.opts = {
      baseMultiplier: config.baseMultiplier ?? 1,
      multiplier1: config.multiplier1 ?? 1.5,
      multiplier2: config.multiplier2 ?? 2.5,
      streakTimeout: config.streakTimeout ?? 300,
      threshold1: config.threshold1 ?? 200,
      threshold2: config.threshold2 ?? 80,
    };
  }

  tick(now?: number): number {
    const currentTime = now ?? Date.now();

    // 首次滚动，返回基础倍率
    if (this.lastTickTime === null) {
      this.lastTickTime = currentTime;
      return this.opts.baseMultiplier;
    }

    const interval = currentTime - this.lastTickTime;

    // 超时重置 — 连续滚动中断
    if (interval > this.opts.streakTimeout) {
      this.velocityHistory = [];
      this.lastTickTime = currentTime;
      return this.opts.baseMultiplier;
    }

    // 记录间隔到滑动窗口
    this.velocityHistory.push(interval);
    if (this.velocityHistory.length > this.historySize) {
      this.velocityHistory.shift();
    }

    // 计算平均间隔
    const avgInterval = this.velocityHistory.reduce((sum, v) => sum + v, 0) / this.velocityHistory.length;

    this.lastTickTime = currentTime;

    // 根据平均间隔选择加速倍率
    if (avgInterval <= this.opts.threshold2) {
      // 快速连续滚动 — 最高加速
      return this.opts.multiplier2;
    }
    if (avgInterval <= this.opts.threshold1) {
      // 中速滚动 — 适度加速
      return this.opts.multiplier1;
    }
    // 慢速滚动 — 不加速
    return this.opts.baseMultiplier;
  }

  reset(): void {
    this.lastTickTime = null;
    this.velocityHistory = [];
  }
}

/**
 * 创建滚动加速器实例。
 *
 * @param config - 加速配置
 * @returns ScrollAcceleration 实例，可用于 scrollbox 的 scrollAcceleration 属性
 *
 * @example
 * const accel = getScrollAcceleration({ multiplier2: 3 });
 * <scrollbox scrollAcceleration={accel}>...</scrollbox>
 */
export function getScrollAcceleration(config: ScrollAccelerationConfig = {}): ScrollAcceleration {
  return new CrabScrollAccel(config);
}
