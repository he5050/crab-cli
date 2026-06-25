/**
 * 应用生命周期事件 — AppEvent 中"应用全局"语义的事件集合。
 *
 * 职责:定义应用启动、配置、日志、命令面板等运行时骨架事件。
 * 边界:仅声明事件契约,不感知任何业务模块。
 */
import { defineEvent } from "../core";

export const LifecycleEvents = {
  /** 应用启动 */
  AppStarted: defineEvent<{ version: string; pid: number }>("app.started"),

  /** 日志事件(写入状态栏) */
  Log: defineEvent<{ level: "debug" | "info" | "warn" | "error"; message: string }>("app.log"),

  /** 配置更新 */
  ConfigUpdated: defineEvent<{ config: unknown; source?: "save" | "hot-reload" | "init" }>("config.updated"),

  /** 命令面板打开(由 input / 触发) */
  CommandPaletteShow: defineEvent<{ query?: string }>("command.palette.show"),

  /** Toast 通知 */
  Toast: defineEvent<{ message: string; variant: "info" | "success" | "warning" | "error" }>("toast.show"),

  /** 内存状态更新(定时触发) */
  ResourceUpdate: defineEvent<{ memoryMB: number; cpuPercent: number; uptime: number }>("resource.update"),

  /** 主题切换 */
  ThemeChanged: defineEvent<{ mode: "dark" | "light" }>("theme.changed"),

  /** 显示主题选择弹窗 */
  ThemePickerShow: defineEvent<Record<string, never>>("theme.picker.show"),

  /** 显示模型选择弹窗 */
  ModelPickerShow: defineEvent<Record<string, never>>("model.picker.show"),

  /** 显示状态弹窗 */
  StatusDialogShow: defineEvent<Record<string, never>>("status.dialog.show"),

  /** 显示 Leader 快捷键提示 */
  LeaderKeyShow: defineEvent<Record<string, never>>("leader.key.show"),

  /** 隐藏 Leader 快捷键提示 */
  LeaderKeyHide: defineEvent<Record<string, never>>("leader.key.hide"),

  /** 更新可用通知 */
  UpdateAvailable: defineEvent<{ currentVersion: string; latestVersion: string; releaseUrl?: string }>(
    "app.update.available",
  ),
} as const;
