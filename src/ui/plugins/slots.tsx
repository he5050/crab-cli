/**
 * [Plugin Slot 系统]
 *
 * 职责:
 *   - 提供具名 Slot 机制，允许插件替换默认 UI 组件
 *   - 管理 Slot 注册表和优先级竞争
 *   - 注入上下文(theme、config)到 Slot 渲染器
 *   - 提供错误边界，确保插件崩溃不影响主 UI
 *
 * 模块功能:
 *   - Slot 注册与注销(registerSlot / unregisterSlot)
 *   - 上下文管理(updateSlotContext / getSlotContext)
 *   - Slot 渲染(Slot / SidebarSlot 组件)
 *   - 竞争模式(多插件竞争同一 Slot，按优先级选取)
 *   - 生命周期管理(register 返回 cleanup 函数)
 *
 * 使用场景:
 *   - 插件需要替换首页 Logo(home_logo)
 *   - 插件需要替换首页 Prompt(home_prompt)
 *   - 插件需要替换侧边栏(sidebar)
 *   - 插件需要替换底部状态栏(app_bottom)
 *   - 插件需要添加新页面路由(app)
 *
 * 边界:
 *   1. Slot 名称必须是预定义的 SLOT_NAMES 或 SIDEBAR_SLOT_NAMES 之一
 *   2. 插件渲染崩溃时会自动回退到默认 children
 *   3. 同一 Slot 多插件竞争时，仅最高优先级的渲染器生效
 *   4. 上下文更新由 ThemeProvider/App 主动调用
 *
 * 流程:
 *   1. 插件调用 registerSlot(name, renderer, options) 注册 Slot
 *   2. 注册表按优先级排序，高优先级在前
 *   3. 渲染时调用 Slot 组件，传入 name 和默认 children
 *   4. Slot 组件查找注册表，如有插件渲染器则调用
 *   5. 插件渲染器接收 SlotContext(theme、config)
 *   6. 渲染异常时捕获错误，回退到默认 children
 *
 */
import type { JSX } from "solid-js";
import { createSignal, onCleanup } from "solid-js";

// ─── 类型定义 ──────────────────────────────────────────────

/** 插槽上下文 — 注入到渲染器中的环境信息 */
export interface SlotContext {
  /** 当前主题颜色 */
  theme: {
    colors: import("@/ui/contexts/theme").ThemeColors;
    mode: "dark" | "light";
    themeName: string;
  };
  /** 当前配置快照 */
  config?: Record<string, unknown>;
}

/** Slot 渲染器类型(可接收上下文) */
export type SlotRenderer = (ctx?: SlotContext) => any;

/** 带优先级的 Slot 注册 */
interface SlotRegistration {
  id: string;
  renderer: SlotRenderer;
  priority: number;
}

// ─── Slot 注册表 ──────────────────────────────────────────

const registeredSlots = new Map<string, SlotRegistration[]>();

// ─── 上下文构建 ──────────────────────────────────────────

let _currentContext: SlotContext | undefined;

/**
 * 更新全局 Slot 上下文(由 ThemeProvider/App 调用)。
 */
export function updateSlotContext(ctx: SlotContext): void {
  _currentContext = ctx;
}

/**
 * 获取当前 Slot 上下文。
 */
export function getSlotContext(): SlotContext | undefined {
  return _currentContext;
}

// ─── 注册/注销 ────────────────────────────────────────────

/**
 * 注册 Slot 替换。
 *
 * @param name - Slot 名称
 * @param renderer - 替换渲染器
 * @param options - 选项(priority 竞争优先级，id 插件标识)
 * @returns cleanup 函数，调用即注销
 */
export function registerSlot(
  name: string,
  renderer: SlotRenderer,
  options?: { priority?: number; id?: string },
): () => void {
  const registration: SlotRegistration = {
    id: options?.id ?? `slot-${Date.now()}`,
    priority: options?.priority ?? 0,
    renderer,
  };

  const existing = registeredSlots.get(name) ?? [];
  existing.push(registration);
  // 按优先级降序排序(高优先级在前)
  existing.sort((a, b) => b.priority - a.priority);
  registeredSlots.set(name, existing);

  // 返回 cleanup 函数
  return () => {
    const regs = registeredSlots.get(name);
    if (regs) {
      const idx = regs.findIndex((r) => r.id === registration.id);
      if (idx !== -1) {
        regs.splice(idx, 1);
      }
      if (regs.length === 0) {
        registeredSlots.delete(name);
      }
    }
  };
}

/**
 * 取消注册(兼容旧 API)。
 */
export function unregisterSlot(name: string): void {
  registeredSlots.delete(name);
}

/**
 * 获取已注册的 Slot 渲染器(竞争模式:返回最高优先级)。
 */
export function getPluginSlot(name: string): SlotRenderer | undefined {
  const regs = registeredSlots.get(name);
  if (!regs || regs.length === 0) {
    return undefined;
  }
  return regs[0]!.renderer;
}

/**
 * 获取所有竞争者(用于调试/管理)。
 */
export function getSlotCompetitors(name: string): SlotRegistration[] {
  return registeredSlots.get(name) ?? [];
}

/**
 * 列出所有已注册的 Slot。
 */
export function listRegisteredSlots(): string[] {
  return [...registeredSlots.keys()];
}

/**
 * 清除所有已注册的 Slot。
 */
export function clearSlots(): void {
  registeredSlots.clear();
}

// ─── Slot 定义 ──────────────────────────────────────────────

/** 所有可用 Slot 名称 */
export const SLOT_NAMES = [
  "home_logo",
  "home_prompt",
  "home_prompt_right",
  "home_bottom",
  "home_footer",
  "session_prompt",
  "session_prompt_right",
  "sidebar",
  "app_bottom",
  "app",
] as const;

export type SlotName = (typeof SLOT_NAMES)[number];

// ─── 侧边栏子 Slot ─────────────────────────────────────────

/** 侧边栏专用 Slot 名称(含区块级插槽) */
export const SIDEBAR_SLOT_NAMES = [
  "sidebar_title",
  "sidebar_content",
  "sidebar_footer",
  "sidebar_context",
  "sidebar_mcp",
  "sidebar_lsp",
  "sidebar_todo",
  "sidebar_files",
  "sidebar_tasks",
] as const;

export type SidebarSlotName = (typeof SIDEBAR_SLOT_NAMES)[number];

// ─── Slot 组件 ──────────────────────────────────────────────

/**
 * Slot 组件 — 如果有插件注册了同名 Slot，使用插件的渲染器；
 * 否则使用默认的 children。
 *
 * 竞争模式:多插件注册同一 Slot 时，高优先级胜出。
 * 错误处理:插件渲染崩溃时回退到默认 children。
 *
 * 用法:
 *   <Slot name="home_logo"><Logo /></Slot>
 */
export function Slot(props: { name: string; children: JSX.Element }) {
  const pluginSlot = getPluginSlot(props.name);
  if (pluginSlot) {
    try {
      return pluginSlot(_currentContext);
    } catch {
      // 插件崩溃 → 回退到默认
      return props.children;
    }
  }
  return props.children;
}

/**
 * 侧边栏 Slot 组件 — 支持侧边栏专用 Slot(title/content/footer)。
 *
 * 用法:
 *   <SidebarSlot name="sidebar_content"><DefaultContent /></SidebarSlot>
 */
export function SidebarSlot(props: { name: SidebarSlotName; children: JSX.Element }) {
  const pluginSlot = getPluginSlot(props.name);
  if (pluginSlot) {
    try {
      return pluginSlot(_currentContext);
    } catch {
      return props.children;
    }
  }
  return props.children;
}

// ─── 插件路由系统 (P3-T12) ──────────────────────────────────

/** 插件路由渲染器 — 接收路由数据，返回 JSX */
export type PluginRouteRenderer = (routeData: { id: string; data?: Record<string, unknown> }) => JSX.Element;

/** 插件路由注册项 */
export interface PluginRoute {
  /** 路由名称（唯一标识，如 "diff"、"settings"） */
  name: string;
  /** 路由渲染器 */
  component: PluginRouteRenderer;
}

/** 插件路由注册表 */
const pluginRoutes = new Map<string, PluginRouteRenderer>();

/** 插件路由响应式信号（用于触发 UI 更新） */
const [pluginRoutesSignal, setPluginRoutesSignal] = createSignal<PluginRoute[]>([]);

/**
 * 创建插件路由注册器。
 *
 * 允许插件注册自定义路由页面，用户导航到 `{ type: "plugin", id: name }` 时
 * 会渲染对应组件。
 *
 * @returns 包含 registerRoute、getPluginRoutes 和 cleanup 的对象
 *
 * @example
 * const routes = createPluginRoutes();
 * routes.registerRoute("my-page", (data) => <MyPage data={data} />);
 * // 导航: route.navigate({ type: "plugin", id: "my-page" })
 * onCleanup(routes.cleanup);
 */
export function createPluginRoutes() {
  /**
   * 注册自定义路由。
   *
   * @param name - 路由名称（与 Route.id 对应）
   * @param component - 路由渲染器
   * @returns cleanup 函数，调用即注销该路由
   */
  function registerRoute(name: string, component: PluginRouteRenderer): () => void {
    pluginRoutes.set(name, component);
    refreshPluginRoutes();
    return () => {
      pluginRoutes.delete(name);
      refreshPluginRoutes();
    };
  }

  /**
   * 获取所有已注册的插件路由。
   */
  function getPluginRoutes(): PluginRoute[] {
    return pluginRoutesSignal();
  }

  /**
   * 根据名称获取插件路由渲染器。
   */
  function getPluginRoute(name: string): PluginRouteRenderer | undefined {
    return pluginRoutes.get(name);
  }

  /** 清理所有已注册路由 */
  function cleanup(): void {
    pluginRoutes.clear();
    refreshPluginRoutes();
  }

  function refreshPluginRoutes(): void {
    const routes: PluginRoute[] = [];
    for (const [name, component] of pluginRoutes) {
      routes.push({ name, component });
    }
    setPluginRoutesSignal(routes);
  }

  return { registerRoute, getPluginRoutes, getPluginRoute, cleanup };
}

/** 全局插件路由实例 */
const globalPluginRoutes = createPluginRoutes();

/**
 * usePluginRoutes — 获取当前已注册的插件路由列表（响应式）。
 *
 * @returns 当前已注册的插件路由数组
 */
export function usePluginRoutes(): PluginRoute[] {
  return globalPluginRoutes.getPluginRoutes();
}

/**
 * 获取全局插件路由渲染器。
 * 供 app.tsx 路由匹配使用。
 */
export function getGlobalPluginRoute(name: string): PluginRouteRenderer | undefined {
  return globalPluginRoutes.getPluginRoute(name);
}

/**
 * 全局注册插件路由（便捷方法）。
 * 返回 cleanup 函数。
 */
export function registerPluginRoute(name: string, component: PluginRouteRenderer): () => void {
  return globalPluginRoutes.registerRoute(name, component);
}
