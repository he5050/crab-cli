/**
 * UseLspDiagnostics — LSP 诊断信息收集 Hook
 *
 * 职责:
 *   - 从 LspManager 收集诊断信息
 *   - 转换为侧边栏可用的数据格式
 *   - 提供响应式的诊断列表和统计信息
 *
 * 模块功能:
 *   - 监听 LSP 诊断变更事件
 *   - 转换 LSP 诊断格式为 LspDiagnosticItem
 *   - 过滤当前工作目录下的文件诊断
 *   - 按严重程度排序(error > warning > info > hint)
 *   - 限制最多显示 50 条诊断
 *   - 提供诊断统计(errors/warnings/total)
 *   - 每 10 秒自动刷新
 *
 * 使用场景:
 *   - 在 Session 组件侧边栏显示代码诊断
 *   - 需要实时查看项目中的错误和警告
 *   - 需要诊断统计信息用于 UI 展示
 *
 * 边界:
 *   1. 仅收集当前工作目录(process.cwd())下文件的诊断
 *   2. 最多显示 50 条诊断，超出部分被截断
 *   3. 诊断消息只取第一行(去除换行)
 *   4. 行号从 LSP 的 0-based 转换为 1-based
 *   5. 依赖 LspManager 的诊断事件机制
 *   6. 组件卸载时自动清理定时器和事件监听
 *
 * 流程:
 *   1. 初始化时从 lspManager 拉取所有诊断
 *   2. 注册诊断变更事件处理器
 *   3. 转换并过滤诊断数据
 *   4. 按严重程度排序并限制数量
 *   5. 设置 10 秒定时器定期刷新
 *   6. 组件卸载时清理资源
 */
import { createSignal, onCleanup } from "solid-js";
import { type LspDiagnostic, lspManager } from "@/lsp/index";
import type { LspDiagnosticItem } from "@/ui/pages/session/components/sidebar";

const MAX_DIAGNOSTICS = 50;

function severityMap(s: string): LspDiagnosticItem["severity"] {
  switch (s) {
    case "error": {
      return "error";
    }
    case "warning": {
      return "warning";
    }
    case "information": {
      return "info";
    }
    default: {
      return "hint";
    }
  }
}

/** 从 file:// URI 提取文件路径 */
function uriToPath(uri: string): string {
  if (uri.startsWith("file://")) {
    return uri.slice(7);
  }
  return uri;
}

export function useLspDiagnostics() {
  const [diagnostics, setDiagnostics] = createSignal<LspDiagnosticItem[]>([]);

  /** 从 lspManager 拉取所有诊断并转换 */
  const refresh = () => {
    const allDiags = lspManager.getAllDiagnostics();
    const items: LspDiagnosticItem[] = [];
    const cwd = process.cwd();

    for (const [uri, diags] of allDiags) {
      const filePath = uriToPath(uri);
      // 只显示当前项目内的文件
      const relativePath = filePath.startsWith(cwd) ? filePath.slice(cwd.length + 1) : filePath;

      for (const d of diags) {
        if (items.length >= MAX_DIAGNOSTICS) {
          break;
        }
        items.push({
          file: relativePath,
          line: d.location.range.start.line + 1, // LSP 0-based → 1-based
          message: d.message.split("\n")[0] ?? d.message, // 只取第一行
          severity: severityMap(d.severity),
        });
      }
      if (items.length >= MAX_DIAGNOSTICS) {
        break;
      }
    }

    // 按严重程度排序:error > warning > info > hint
    const severityOrder: Record<string, number> = { error: 0, hint: 3, info: 2, warning: 1 };
    items.sort((a, b) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3));

    setDiagnostics(items);
  };

  // 监听诊断变更事件
  lspManager.setDiagnosticsHandler((_uri: string, _diags: LspDiagnostic[]) => {
    refresh();
  });

  // 初始加载
  refresh();

  // 定期刷新(LSP 诊断可能通过多种途径更新)
  const interval = setInterval(refresh, 10_000);
  onCleanup(() => {
    clearInterval(interval);
  });

  return {
    diagnostics,
    /** 手动触发刷新 */
    refresh,
    /** 诊断统计 */
    stats: () => {
      const d = diagnostics();
      return {
        errors: d.filter((x) => x.severity === "error").length,
        total: d.length,
        warnings: d.filter((x) => x.severity === "warning").length,
      };
    },
  };
}
