/**
 * CommandPalette Context
 *
 * 职责:
 *   - 管理命令面板状态
 *   - 提供命令执行接口
 *   - 管理斜杠命令列表
 *   - 支持面板挂起/恢复
 *
 * 模块功能:
 *   - 执行命令字符串
 *   - 显示命令面板
 *   - 获取斜杠命令列表
 *   - 挂起/恢复命令面板
 *   - 跟踪挂起计数
 *
 * 使用场景:
 *   - 用户输入斜杠命令
 *   - 快捷键触发命令面板
 *   - 命令执行时临时挂起面板
 *   - 展示可用命令列表
 *
 * 边界:
 *   1. 命令执行逻辑由外部提供
 *   2. 斜杠命令列表由外部注入
 *   3. 仅管理面板状态，不负责渲染
 *
 * 流程:
 *   1. 通过 Provider 注入 run 和 slashes
 *   2. 调用 show() 显示命令面板
 *   3. 用户选择命令后调用 run() 执行
 *   4. 需要时调用 suspend() 挂起面板
 */
import { type Accessor, type ParentProps, createContext, createMemo, createSignal, useContext } from "solid-js";
import { createInternalError } from "@/core/errors/appError";

/** 斜杠命令条目 */
export interface SlashEntry {
  display: string;
  description?: string;
  aliases?: string[];
  onSelect: () => void;
}

/** CommandPalette Context 类型 */
export interface CommandPaletteContext {
  /** 执行命令 */
  run(command: string): void;
  /** 显示命令面板 */
  show(): void;
  /** 斜杠命令列表 */
  slashes: Accessor<readonly SlashEntry[]>;
  /** 暂停/恢复命令面板 */
  suspend(enabled: boolean): void;
  /** 是否暂停中 */
  readonly suspended: boolean;
}

const ctx = createContext<CommandPaletteContext>();

/**
 * CommandPalette Provider。
 *
 * 接受一个 run 回调来执行命令，以及一个 slashes accessor 来获取斜杠命令。
 * 在 app.tsx 的 Provider 树中使用。
 */
export function CommandPaletteProvider(
  props: ParentProps<{
    run: (command: string) => void;
    show: () => void;
    slashes?: Accessor<readonly SlashEntry[]>;
  }>,
) {
  const [suspendCount, setSuspendCount] = createSignal(0);

  const slashes = createMemo<readonly SlashEntry[]>(() => props.slashes?.() ?? []);

  const value: CommandPaletteContext = {
    run: props.run,
    show: props.show,
    slashes,
    suspend(enabled: boolean) {
      setSuspendCount((count) => Math.max(0, count + (enabled ? 1 : -1)));
    },
    get suspended() {
      return suspendCount() > 0;
    },
  };

  return <ctx.Provider value={value}>{props.children}</ctx.Provider>;
}

/** 获取 CommandPalette Context */
export function useCommandPalette(): CommandPaletteContext {
  const value = useContext(ctx);
  if (!value) {
    throw createInternalError("INTERNAL_ERROR", "CommandPalette context must be used within a CommandPaletteProvider");
  }
  return value;
}

/** 获取斜杠命令列表 */
export function useCommandSlashes(): Accessor<readonly SlashEntry[]> {
  return useCommandPalette().slashes;
}
