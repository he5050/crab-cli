/**
 * StatusBar 组件
 *
 * 职责:
 *   - 提供底部状态栏，显示系统运行状态和资源使用情况
 *   - 实时展示内存、CPU、项目目录、Git 分支、当前模型等信息
 *
 * 模块功能:
 *   - StatusBar: 完整状态栏，显示内存、CPU、目录、分支、模型
 *   - ResourceUsageStatus: 简化版，仅显示内存和 CPU
 *   - 自动刷新资源使用数据(每 5 秒)
 *   - 监听 ProviderStatus 事件更新当前模型
 *
 * 使用场景:
 *   - 需要实时监控资源使用情况时
 *   - 需要快速查看当前项目上下文时
 *   - 需要确认当前使用的 AI 模型时
 *
 * 边界:
 *   1. 资源数据每 5 秒刷新一次
 *   2. Git 分支通过执行 git 命令获取
 *   3. 路径过长时显示为 .../最后三级目录
 *   4. 模型名称过长时截断显示
 *
 * 流程:
 *   1. 组件挂载时启动定时器获取资源数据
 *   2. 订阅 ProviderStatus 事件监听模型变更
 *   3. 渲染状态字段:内存、CPU、目录、分支、模型
 *   4. 组件卸载时清理定时器和订阅
 */
import { onCleanup } from "solid-js";
import { useRenderer } from "@opentui/solid";
import { useEventBus } from "@/ui/contexts/eventBus";
import { AppEvent } from "@bus";
import { getCpuUsagePercent, getMemoryUsageMB } from "@monitor";
import { useTheme } from "@/ui/contexts/theme";
import { useConfig } from "@/ui/contexts/config";
import type { MutableTextRenderable } from "@/ui/types/renderable";
import { createDeferredSync } from "@/ui/utils/deferredSync";

function decodeSpawnOutput(output: Uint8Array | undefined): string {
  if (!output || output.length === 0) {
    return "";
  }
  return new TextDecoder().decode(output).trim();
}

async function readGitBranch(): Promise<string> {
  try {
    const proc = Bun.spawn(["git", "branch", "--show-current"], {
      cwd: process.cwd(),
      stderr: "pipe",
      stdout: "pipe",
    });
    const timeout = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // Noop
      }
    }, 2000);
    const [exitCode, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
    clearTimeout(timeout);
    if (exitCode !== 0) {
      return "";
    }
    return stdout.trim();
  } catch {
    return "";
  }
}

function shortenPath(cwd: string): string {
  if (!cwd) {
    return "-";
  }
  const parts = cwd.split("/").filter(Boolean);
  if (parts.length <= 3) {
    return cwd;
  }
  const lastThree = `.../${parts.slice(-3).join("/")}`;
  if (lastThree.length <= 22) {
    return lastThree;
  }
  return `.../${parts[parts.length - 1]}`;
}

function truncate(value: string, max: number): string {
  if (!value) {
    return "-";
  }
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, Math.max(0, max - 2))}..`;
}

export function StatusBar() {
  const eventBus = useEventBus();
  const renderer = useRenderer();
  const theme = useTheme();
  const { config } = useConfig();
  const c = theme.colors;
  const defaultModel = config.defaultProvider.model;
  const projectDir = shortenPath(process.cwd());
  const snapshot = {
    branch: "",
    cpu: getCpuUsagePercent(),
    memory: getMemoryUsageMB(),
    runtimeModel: "",
  };
  let memoryText: MutableTextRenderable | undefined;
  let cpuText: MutableTextRenderable | undefined;
  let branchText: MutableTextRenderable | undefined;
  let modelText: MutableTextRenderable | undefined;
  const { disposed, schedule: scheduleTextSync } = createDeferredSync(() => {
    syncTextRefs();
  });

  const memoryLabel = () => `${snapshot.memory.toFixed(1)}MB`;
  const cpuLabel = () => `${snapshot.cpu.toFixed(1)}%`;
  const activeModel = () => truncate(snapshot.runtimeModel || defaultModel, 28);
  const activeBranch = () => truncate(snapshot.branch || "-", 24);

  const syncTextRefs = () => {
    if (disposed.current) {
      return;
    }
    if (memoryText) {
      memoryText.content = memoryLabel();
    }
    if (cpuText) {
      cpuText.content = cpuLabel();
    }
    if (branchText) {
      branchText.content = activeBranch();
    }
    if (modelText) {
      modelText.content = activeModel();
    }
    renderer.requestRender();
  };

  const refreshBranch = async () => {
    const branch = await readGitBranch();
    if (disposed.current) {
      return;
    }
    snapshot.branch = branch;
    scheduleTextSync();
  };

  void refreshBranch();

  const timer = setInterval(() => {
    snapshot.memory = getMemoryUsageMB();
    snapshot.cpu = getCpuUsagePercent();
    scheduleTextSync();
    void refreshBranch();
  }, 5000);

  const unsubProvider = eventBus.subscribe(AppEvent.ProviderStatus, (payload) => {
    snapshot.runtimeModel = payload.properties.model ?? "";
    scheduleTextSync();
  });

  onCleanup(() => {
    disposed.current = true;
    clearInterval(timer);
    unsubProvider();
  });

  return (
    <box
      height={1}
      flexDirection="row"
      justifyContent="space-between"
      paddingLeft={1}
      paddingRight={1}
      gap={2}
      flexShrink={0}
    >
      <box flexDirection="row" gap={1} flexShrink={1}>
        <text fg={c.muted} content="内存:" />
        <text
          ref={(node) => {
            memoryText = node as MutableTextRenderable;
          }}
          fg={c.text}
          content={memoryLabel()}
        />
      </box>
      <box flexDirection="row" gap={1} flexShrink={1}>
        <text fg={c.muted} content="CPU:" />
        <text
          ref={(node) => {
            cpuText = node as MutableTextRenderable;
          }}
          fg={c.text}
          content={cpuLabel()}
        />
      </box>
      <box flexDirection="row" gap={1} flexShrink={1}>
        <text fg={c.muted} content="目录:" />
        <text fg={c.text} content={projectDir} />
      </box>
      <box flexDirection="row" gap={1} flexShrink={1}>
        <text fg={c.muted} content="分支:" />
        <text
          ref={(node) => {
            branchText = node as MutableTextRenderable;
          }}
          fg={c.text}
          content={activeBranch()}
        />
      </box>
      <box flexDirection="row" gap={1} flexShrink={1}>
        <text fg={c.muted} content="模型:" />
        <text
          ref={(node) => {
            modelText = node as MutableTextRenderable;
          }}
          fg={c.accent}
          content={activeModel()}
        />
      </box>
    </box>
  );
}

export function ResourceUsageStatus() {
  const renderer = useRenderer();
  const theme = useTheme();
  const c = theme.colors;
  const snapshot = {
    cpu: getCpuUsagePercent(),
    memory: getMemoryUsageMB(),
  };
  let memoryText: MutableTextRenderable | undefined;
  let cpuText: MutableTextRenderable | undefined;

  const memoryLabel = () => `内存: ${snapshot.memory.toFixed(1)}MB`;
  const cpuLabel = () => `CPU: ${snapshot.cpu.toFixed(1)}%`;

  const syncTextRefs = () => {
    if (memoryText) {
      memoryText.content = memoryLabel();
    }
    if (cpuText) {
      cpuText.content = cpuLabel();
    }
    renderer.requestRender();
  };

  const timer = setInterval(() => {
    snapshot.memory = getMemoryUsageMB();
    snapshot.cpu = getCpuUsagePercent();
    syncTextRefs();
  }, 5000);

  onCleanup(() => clearInterval(timer));

  return (
    <box height={1} flexDirection="row" justifyContent="center" gap={2} flexShrink={0}>
      <text
        ref={(node) => {
          memoryText = node as MutableTextRenderable;
        }}
        fg={c.muted}
        content={memoryLabel()}
      />
      <text
        ref={(node) => {
          cpuText = node as MutableTextRenderable;
        }}
        fg={c.muted}
        content={cpuLabel()}
      />
    </box>
  );
}
