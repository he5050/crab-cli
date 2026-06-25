/**
 * 性能数据聚合 — 从资源监控、缓存、背压等模块汇总数据并暴露给 UI。
 *
 * 职责:
 *   - 读取内存/CPU/缓存/背压指标
 *   - 组装为统一的 PerformanceData 结构
 */
import { getMemoryStats, getMemoryTrend, getResourceStatus } from "@monitor";
import { getAllCacheStats, getTotalCacheSize } from "@/core/concurrency/cacheManager";
import { getBackpressureStatus } from "@/core/concurrency/backpressure";
import { AppError, createInternalError, toAppError } from "@/core/errors/appError";

export interface PerformanceData {
  memory: {
    current: number;
    avg: number;
    min: number;
    max: number;
    trend: string;
    rate: number;
  };
  cpu: {
    current: number;
  };
  cache: {
    totalSize: number;
    hitRate: number;
    stats: {
      name: string;
      size: number;
      maxSize: number;
      hitRate: number;
    }[];
  };
  backpressure: {
    isBackpressured: boolean;
    pressureLevel: string;
    queueUtilization: number;
  };
  uptime: number;
}

export interface PerformanceDataDeps {
  getResourceStatus: typeof getResourceStatus;
  getMemoryStats: typeof getMemoryStats;
  getMemoryTrend: typeof getMemoryTrend;
  getAllCacheStats: typeof getAllCacheStats;
  getTotalCacheSize: typeof getTotalCacheSize;
  getBackpressureStatus: typeof getBackpressureStatus;
}

const defaultDeps: PerformanceDataDeps = {
  getAllCacheStats,
  getBackpressureStatus,
  getMemoryStats,
  getMemoryTrend,
  getResourceStatus,
  getTotalCacheSize,
};

export function collectPerformanceData(deps: PerformanceDataDeps = defaultDeps): PerformanceData {
  const resourceStatus = deps.getResourceStatus();
  const memoryStats = deps.getMemoryStats();
  const memoryTrend = deps.getMemoryTrend();
  const cacheStats = deps.getAllCacheStats();
  const totalCacheSize = deps.getTotalCacheSize();
  const bpStatus = deps.getBackpressureStatus();

  const avgHitRate = cacheStats.length > 0 ? cacheStats.reduce((sum, s) => sum + s.hitRate, 0) / cacheStats.length : 0;

  return {
    backpressure: {
      isBackpressured: bpStatus.isBackpressured,
      pressureLevel: bpStatus.pressureLevel,
      queueUtilization: bpStatus.queueUtilization,
    },
    cache: {
      hitRate: avgHitRate,
      stats: cacheStats,
      totalSize: totalCacheSize,
    },
    cpu: {
      current: resourceStatus.cpuPercent,
    },
    memory: {
      avg: memoryStats.avg,
      current: memoryStats.current,
      max: memoryStats.max,
      min: memoryStats.min,
      rate: memoryTrend.rate,
      trend: memoryTrend.direction,
    },
    uptime: resourceStatus.uptime,
  };
}

export function normalizePerformanceDataError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  const appError = toAppError(error);
  return createInternalError("UNKNOWN_ERROR", `获取性能数据失败: ${appError.message}`, {
    cause: error,
    context: { operation: "ui.performance.collect" },
  });
}

export function formatPerformanceDataError(error: unknown): string {
  return normalizePerformanceDataError(error).toUserString();
}
