/**
 * [诊断面板]
 *
 * 职责:
 *   - 订阅 IDEDiagnostics 事件接收诊断数据
 *   - 按严重性分组显示诊断列表(error/warning/info/hint)
 *   - 显示诊断统计信息和文件路径
 *
 * 模块功能:
 *   - DiagnosticsPanel 组件:全屏浮层显示诊断列表
 *   - 严重性图标映射:✗/⚠/ℹ/💡
 *   - 严重性颜色映射:根据主题显示不同颜色
 *   - 诊断统计:按严重性计数显示
 *
 * 使用场景:
 *   - 查看当前文件的 IDE 诊断信息(错误、警告等)
 *   - 快速定位代码问题的行号和位置
 *   - 集成到 TUI 界面作为诊断查看器
 *   - 需要按严重性筛选和查看诊断的场景
 *
 * 边界:
 *   1. 仅显示单个文件的诊断信息
 *   2. 诊断数据通过全局事件总线接收
 *   3. 面板为绝对定位浮层，zIndex 为 100
 *   4. 依赖外部传入 onClose 回调处理关闭
 *
 * 流程:
 *   1. 组件挂载时订阅 IDEDiagnostics 事件
 *   2. 接收到诊断数据后更新文件路径和诊断列表
 *   3. 按严重性分组渲染诊断条目(图标+位置+消息)
 *   4. 显示诊断统计(错误数/警告数/信息数)
 */

import { For, Show, createSignal, onCleanup } from "solid-js";
import { useEventBus } from "@/ui/contexts/eventBus";
import { AppEvent } from "@bus";
import { useTheme } from "@/ui/contexts/theme";
import { createStatusColorMap } from "@/ui/utils/statusColors";
import { actionBullet, actionHint, iconError, iconLsp, iconWarning } from "@/ui/utils/icon";
import { lspSeverityIcon } from "@/core/icons/iconDerived";

/** 面板内诊断条目 */
interface DiagEntry {
  message: string;
  severity: string;
  line: number;
  character: number;
  source?: string;
}

/** 面板属性 */
interface DiagnosticsPanelProps {
  onClose?: () => void;
}

/** 严重性图标 */
/** severityIcon 已迁 @core/iconDerived.lspSeverityIcon */

/** 严重性颜色 */
function severityColor(sev: string, theme: any): string {
  return createStatusColorMap<string>(
    {
      error: theme.colors.error,
      hint: theme.colors.muted,
      info: theme.colors.info ?? theme.colors.text,
      warning: theme.colors.warning,
    },
    theme.colors.text,
  )(sev);
}

/** 按严重性计数 */
function countBySeverity(entries: DiagEntry[]): { errors: number; warnings: number; info: number } {
  let errors = 0;
  let warnings = 0;
  let info = 0;
  for (const e of entries) {
    if (e.severity === "error") {
      errors++;
    } else if (e.severity === "warning") {
      warnings++;
    } else {
      info++;
    }
  }
  return { errors, info, warnings };
}

/**
 * 诊断面板 — 全屏浮层显示诊断列表。
 */
export function DiagnosticsPanel(_props: DiagnosticsPanelProps) {
  const eventBus = useEventBus();
  const theme = useTheme();
  const [filePath, setFilePath] = createSignal("");
  const [diagnostics, setDiagnostics] = createSignal<DiagEntry[]>([]);

  // 订阅 IDE 诊断事件
  const unsub = eventBus.subscribe(AppEvent.IDEDiagnostics, (payload: any) => {
    const { filePath: fp, diagnostics: diags } = payload.properties;
    setFilePath(fp);
    setDiagnostics(
      diags.map((d: any) => ({
        character: d.character,
        line: d.line,
        message: d.message,
        severity: d.severity,
        source: d.source,
      })),
    );
  });
  onCleanup(() => unsub());

  const counts = () => countBySeverity(diagnostics());

  return (
    <box
      flexDirection="column"
      border={true}
      borderStyle="single"
      borderColor={theme.colors.border}
      padding={1}
      position="absolute"
      top={2}
      left={2}
      right={2}
      bottom={2}
      zIndex={100}
    >
      {/* 标题栏 */}
      <box flexDirection="row" justifyContent="space-between" marginBottom={1}>
        <text fg={theme.colors.accent}>{iconLsp} IDE Diagnostics</text>
        <box flexDirection="row">
          <Show when={counts().errors > 0}>
            <text fg={theme.colors.error}>
              {iconError} {counts().errors} 个错误{" "}
            </text>
          </Show>
          <Show when={counts().warnings > 0}>
            <text fg={theme.colors.warning}>
              {iconWarning} {counts().warnings} 个警告{" "}
            </text>
          </Show>
          <Show when={counts().info > 0}>
            <text fg={theme.colors.muted}>ℹ {counts().info} 条信息</text>
          </Show>
        </box>
      </box>

      {/* 文件路径 */}
      <Show when={filePath().length > 0}>
        <text fg={theme.colors.muted} marginBottom={1}>
          文件: {filePath()}
        </text>
      </Show>

      {/* 诊断列表 */}
      <box flexDirection="column" flexGrow={1}>
        <Show
          when={diagnostics().length > 0}
          fallback={<text fg={theme.colors.muted}>暂无诊断信息。请连接 VSCode 并打开一个文件。</text>}
        >
          <For each={diagnostics()}>
            {(entry) => (
              <box flexDirection="row" marginBottom={0}>
                <text fg={severityColor(entry.severity, theme)}>{lspSeverityIcon(entry.severity)}</text>
                <text fg={theme.colors.muted}>{` L${entry.line}:${entry.character}`}</text>
                <Show when={entry.source}>
                  <text fg={theme.colors.muted}> [{entry.source}]</text>
                </Show>
                <text fg={theme.colors.text}> {entry.message}</text>
              </box>
            )}
          </For>
        </Show>
      </box>

      {/* 底部提示 */}
      <box marginTop={1}>
        <text fg={theme.colors.muted}>按 Esc 关闭</text>
      </box>
    </box>
  );
}
