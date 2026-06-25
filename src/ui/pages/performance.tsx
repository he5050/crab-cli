/**
 * PerformancePage — 性能监控面板
 *
 * 职责:
 *   - 实时显示系统性能指标(内存、CPU、缓存、背压状态)
 *   - 提供性能数据可视化与颜色告警
 *   - 生成性能建议和告警信息
 *
 * 模块功能:
 *   - PerformancePage: 性能监控主组件
 *   - PerformanceData: 性能数据结构接口
 *   - Text: 文本渲染组件(支持颜色、粗体、模糊样式)
 *
 * 使用场景:
 *   - 系统性能监控
 *   - 故障排查与性能分析
 *   - 内存泄漏检测
 *
 * 边界:
 * 1. 每 5 秒自动刷新一次数据
 * 2. 依赖 resourceMonitor、cacheManager、backpressure 模块
 * 3. 内存 > 500MB 显示红色，> 300MB 显示黄色
 * 4. CPU > 80% 显示红色，> 50% 显示黄色
 *
 * 流程:
 * 1. 初始化时获取所有性能数据(内存/CPU/缓存/背压)
 * 2. 定时更新性能数据并刷新界面
 * 3. 根据阈值显示颜色告警(绿/黄/红)
 * 4. 生成智能性能建议
 * 5. 组件卸载时清理定时器
 */

import { For, type JSX, Show, createEffect, createSignal, onCleanup } from "solid-js";
import { createLogger } from "@/core/logging/logger";
import { type PerformanceData, collectPerformanceData, formatPerformanceDataError } from "./performanceData";

function Text(props: { color?: string; bold?: boolean; dim?: boolean; content?: string; children?: JSX.Element }) {
  const style = () => ({ bold: props.bold, dim: props.dim });
  return (
    <text fg={props.color}>
      <span style={style()}>{props.content ?? props.children}</span>
    </text>
  );
}

const log = createLogger("ui:performance");

export function PerformancePage() {
  const [data, setData] = createSignal<PerformanceData | null>(null);
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
  const [lastUpdate, setLastUpdate] = createSignal<Date>(new Date());

  // 定时更新性能数据
  let intervalId: ReturnType<typeof setInterval>;

  const updateData = () => {
    try {
      setData(collectPerformanceData());
      setErrorMessage(null);
      setLastUpdate(new Date());
    } catch (error) {
      const message = formatPerformanceDataError(error);
      setErrorMessage(message);
      log.error(message, {
        operation: "ui.performance.updateData",
      });
    }
  };

  createEffect(() => {
    updateData();
    intervalId = setInterval(updateData, 5000); // 每 5 秒更新一次

    onCleanup(() => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    });
  });

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hours}h ${minutes}m ${secs}s`;
  };

  const getMemoryColor = (mb: number) => {
    if (mb > 500) {
      return "red";
    }
    if (mb > 300) {
      return "yellow";
    }
    return "green";
  };

  const getCpuColor = (percent: number) => {
    if (percent > 80) {
      return "red";
    }
    if (percent > 50) {
      return "yellow";
    }
    return "green";
  };

  const getPressureColor = (level: string) => {
    switch (level) {
      case "critical": {
        return "red";
      }
      case "high": {
        return "orange";
      }
      case "medium": {
        return "yellow";
      }
      case "low": {
        return "green";
      }
      default: {
        return "gray";
      }
    }
  };

  const d = data();
  if (!d) {
    return errorMessage() ? (
      <Text color="red" content={errorMessage() ?? undefined} />
    ) : (
      <Text color="yellow">加载中...</Text>
    );
  }

  return (
    <div>
      {/* 标题 */}
      <Text color="cyan" bold content="═══ 性能监控面板 ═══" />
      <Text color="gray" dim content={`最后更新: ${lastUpdate().toLocaleTimeString()}`} />
      <Show when={errorMessage()}>{(message) => <Text color="red" content={`数据刷新失败: ${message()}`} />}</Show>

      {/* 系统运行时间 */}
      <Text color="cyan" content={`运行时间: ${formatUptime(d.uptime)}`} />

      {/* 内存使用 */}
      <Text color={getMemoryColor(d.memory.current)} bold content="═══ 内存使用 ═══" />
      <Text color={getMemoryColor(d.memory.current)} content={`当前: ${d.memory.current.toFixed(1)} MB`} />
      <Text
        color="gray"
        content={`平均: ${d.memory.avg.toFixed(1)} MB | 最小: ${d.memory.min.toFixed(1)} MB | 最大: ${d.memory.max.toFixed(1)} MB`}
      />
      <Text
        color={getMemoryColor(d.memory.current)}
        content={`趋势: ${d.memory.trend === "increasing" ? "↑ 上升" : d.memory.trend === "decreasing" ? "↓ 下降" : "→ 稳定"} (${d.memory.rate > 0 ? "+" : ""}${d.memory.rate} MB/min)`}
      />

      {/* CPU 使用 */}
      <Text color={getCpuColor(d.cpu.current)} bold content="═══ CPU 使用 ═══" />
      <Text color={getCpuColor(d.cpu.current)} content={`当前: ${d.cpu.current.toFixed(1)}%`} />

      {/* 缓存状态 */}
      <Text color="cyan" bold content="═══ 缓存状态 ═══" />
      <Text color="green" content={`总条目: ${d.cache.totalSize} | 平均命中率: ${d.cache.hitRate.toFixed(1)}%`} />
      <For each={d.cache.stats}>
        {(stat) => (
          <Text
            color="gray"
            content={`• ${stat.name}: ${stat.size}/${stat.maxSize} (命中率: ${stat.hitRate.toFixed(1)}%)`}
          />
        )}
      </For>

      {/* 背压状态 */}
      <Text color={getPressureColor(d.backpressure.pressureLevel)} bold content="═══ 背压状态 ═══" />
      <Text
        color={getPressureColor(d.backpressure.pressureLevel)}
        content={`压力水平: ${d.backpressure.pressureLevel.toUpperCase()}`}
      />
      <Text color="gray" content={`队列使用率: ${d.backpressure.queueUtilization.toFixed(1)}%`} />
      {d.backpressure.isBackpressured && <Text color="red" bold content="⚠ 系统处于背压状态，建议减少负载" />}

      {/* 性能建议 */}
      <Text color="cyan" bold content="═══ 性能建议 ═══" />
      {d.memory.trend === "increasing" && d.memory.rate > 50 && (
        <Text color="yellow" content="• 内存使用快速增长，请检查是否有内存泄漏" />
      )}
      {d.cpu.current > 80 && <Text color="yellow" content="• CPU 使用率较高，考虑减少并发或优化计算" />}
      {d.cache.hitRate < 50 && d.cache.totalSize > 0 && (
        <Text color="yellow" content="• 缓存命中率较低，考虑优化缓存策略" />
      )}
      {d.backpressure.isBackpressured && <Text color="red" content="• 系统负载过高，建议暂停新任务" />}
      {d.memory.trend === "stable" && d.cpu.current < 50 && !d.backpressure.isBackpressured && (
        <Text color="green" content="✓ 系统运行状态良好" />
      )}

      {/* 底部信息 */}
      <Text color="gray" dim content="提示: 按 Q 返回 | 数据每 5 秒自动刷新" />
    </div>
  );
}
