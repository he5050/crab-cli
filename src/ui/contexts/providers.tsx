/**
 * Compound Providers — 将多个 Context Provider 合并为子组，减少嵌套层级
 *
 * 职责:
 *   - 将多个 Context Provider 合并为子组
 *   - 减少嵌套层级，提升性能
 *   - 提供统一的 Provider 结构
 *
 * 模块功能:
 *   - DataProviders: 配置、键值存储、Toast 通知、主题的 Provider 组合
 *   - UIProviders: 对话框、命令面板、PromptRef、编辑器上下文的 Provider 组合
 *   - AppProviders: 合并所有 Provider
 *
 * 使用场景:
 *   - React/Solid 应用的根 Provider 设置
 *   - 减少 Provider 嵌套层级
 *
 * 边界:
 * 1. 所有子 Provider 均无内部跨 Provider 依赖
 * 2. 可安全合并
 * 3. 层级从 11 层缩减为 5 层
 *
 * 流程:
 * 1. 暂无(这是 Provider 组合，无特定执行流程)
 */
import { ConfigProvider } from "./config";
import { KVProvider } from "./kv";
import { ToastProvider } from "./toast";
import { type ThemeMode, ThemeProvider } from "./theme";
import { DialogProvider } from "./dialog";
import { CommandPaletteProvider } from "./commandPalette";
import { PromptRefProvider } from "./prompt";
import { EditorContextProvider } from "./editor";
import type { AppConfigSchema as AppConfigType } from "@/schema/config";
import type { JSX } from "solid-js";

/** 数据层 Provider 组合:Config + KV + Toast + Theme */
export function DataProviders(props: {
  children: JSX.Element;
  config: AppConfigType;
  initialTheme: string;
  initialMode: ThemeMode;
}) {
  return (
    <ConfigProvider config={props.config}>
      <KVProvider>
        <ToastProvider>
          <ThemeProvider initialTheme={props.initialTheme} initialMode={props.initialMode}>
            {props.children}
          </ThemeProvider>
        </ToastProvider>
      </KVProvider>
    </ConfigProvider>
  );
}

/** UI 交互层 Provider 组合:Dialog + CommandPalette + PromptRef + EditorContext */
export function UIProviders(props: {
  children: JSX.Element;
  commandRun: (cmd: string) => void;
  commandShow: () => void;
}) {
  return (
    <DialogProvider>
      <CommandPaletteProvider run={props.commandRun} show={props.commandShow}>
        <PromptRefProvider>
          <EditorContextProvider>{props.children}</EditorContextProvider>
        </PromptRefProvider>
      </CommandPaletteProvider>
    </DialogProvider>
  );
}
