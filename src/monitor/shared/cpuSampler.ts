/**
 * 公共 CPU 采集器 — 增量式 CPU 百分比计算。
 *
 * 职责:
 *   - 封装 process.cpuUsage() 的增量状态
 *   - 提供准确的瞬时 CPU 使用率百分比
 *   - 首次调用建立基线，返回 0（避免启动时异常大值）
 *
 * 使用场景:
 *   - ResourceMonitor: 资源监控的 CPU 采集
 *   - PerformanceDashboard: 仪表盘的 CPU 采集
 *   - 任何需要进程级 CPU 使用率的模块
 *
 * 边界:
 *   1. 仅采集当前进程（不感知子进程/容器）
 *   2. 首次采样建立基线，返回 (user: 0, system: 0)
 *   3. 计算基于两次调用间的增量，采样间隔过短会不准确
 */
import os from "node:os";

export interface CpuSample {
  /** 用户态 CPU 百分比（0-100） */
  user: number;
  /** 内核态 CPU 百分比（0-100） */
  system: number;
}

export class CpuSampler {
  private lastUsage: NodeJS.CpuUsage | undefined;
  private lastTime: number;
  private initialized = false;

  constructor() {
    this.lastTime = Date.now();
  }

  /**
   * 采集一次 CPU 样本。
   * 首次调用建立基线，返回 { user: 0, system: 0 }。
   * 后续调用基于增量计算瞬时百分比。
   */
  sample(): CpuSample {
    if (!this.initialized) {
      this.lastUsage = process.cpuUsage();
      this.lastTime = Date.now();
      this.initialized = true;
      return { system: 0, user: 0 };
    }

    try {
      const now = Date.now();
      const elapsedMs = now - this.lastTime;
      const delta = process.cpuUsage(this.lastUsage);

      this.lastUsage = process.cpuUsage();
      this.lastTime = now;

      if (!delta || elapsedMs <= 0) {
        return { system: 0, user: 0 };
      }

      const cpuCount = os.cpus().length || 1;
      const userPercent = (delta.user / 1000 / elapsedMs / cpuCount) * 100;
      const systemPercent = (delta.system / 1000 / elapsedMs / cpuCount) * 100;

      return {
        system: Math.min(Math.round(systemPercent * 10) / 10, 100),
        user: Math.min(Math.round(userPercent * 10) / 10, 100),
      };
    } catch {
      return { system: 0, user: 0 };
    }
  }

  /** 重置基线（用于重新初始化场景） */
  reset(): void {
    this.lastUsage = undefined;
    this.lastTime = Date.now();
    this.initialized = false;
  }
}
