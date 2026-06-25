/**
 * Route Context
 *
 * 职责:
 *   - 维护当前路由状态
 *   - 提供页面导航方法
 *   - 管理路由历史栈
 *
 * 模块功能:
 *   - 导航到新路由
 *   - 返回上一路由
 *   - 类型安全的路由数据获取
 *   - 路由历史栈管理(最大 50 条)
 *
 * 使用场景:
 *   - 页面间导航切换
 *   - 返回上一页功能
 *   - 根据路由类型渲染不同页面
 *   - 路由守卫和拦截
 *
 * 边界:
 *   1. 仅管理路由状态，不涉及页面渲染
 *   2. 历史栈深度限制为 50 条
 *   3. 不支持浏览器式的前进导航
 *
 * 流程:
 *   1. 调用 navigate(route) 切换路由
 *   2. 当前路由快照保存到历史栈
 *   3. 更新当前路由状态
 *   4. 调用 back() 从历史栈恢复路由
 */
import { createStore, reconcile } from "solid-js/store";
import { createSimpleContext } from "@/ui/contexts/helper";
import { createLogger } from "@/core/logging/logger";
import { getSession } from "@session";

const log = createLogger("ui:route");

/** 路由类型定义 */
export type Route =
  | { type: "home" }
  | { type: "session"; sessionId: string }
  | { type: "plugin"; id: string; data?: Record<string, unknown>; returnRoute?: Route }
  | { type: "settings" }
  | { type: "help" }
  | { type: "mcp" }
  | { type: "pixel-editor" };

/** 路由 Context 值 */
export interface RouteContextValue {
  /** 当前路由状态(只读) */
  data: Route;
  /** 导航到新路由，使用 reconcile 替换整个状态 */
  navigate: (route: Route) => void;
  /** 返回上一路由 */
  back: () => void;
}

/**
 * 类型安全路由数据获取 hook。
 *
 * 用法:`const data = useRouteData("session")` 返回 `{ type: "session"; sessionId: string } | undefined`
 * 当路由类型匹配时返回路由数据，不匹配时返回 undefined。
 *
 */
export function useRouteData<T extends Route["type"]>(expected: T) {
  const route = useRoute();
  return () => {
    const d = route.data;
    if (d.type === expected) {
      return d as Extract<Route, { type: T }>;
    }
    return undefined;
  };
}

export function resolveInitialRoute(): { route: Route; invalidResumeSession?: string } {
  const resumeSession = process.env.CRAB_RESUME_SESSION?.trim();
  if (!resumeSession) {
    delete process.env.CRAB_RESUME_SESSION_INVALID;
    return { route: { type: "home" } };
  }

  if (getSession(resumeSession)) {
    delete process.env.CRAB_RESUME_SESSION_INVALID;
    return { route: { sessionId: resumeSession, type: "session" } };
  }

  process.env.CRAB_RESUME_SESSION_INVALID = resumeSession;
  return {
    invalidResumeSession: resumeSession,
    route: { type: "home" },
  };
}

export function consumeInvalidResumeSession(): string | undefined {
  const invalid = process.env.CRAB_RESUME_SESSION_INVALID?.trim();
  delete process.env.CRAB_RESUME_SESSION_INVALID;
  return invalid || undefined;
}

export const { use: useRoute, provider: RouteProvider } = createSimpleContext<RouteContextValue>({
  init: () => {
    const { route: initialRoute } = resolveInitialRoute();
    const [store, setStore] = createStore<Route>(initialRoute);
    // 使用栈结构支持多级回退
    const history: Route[] = [];

    const snapshotRoute = (route: Route): Route => {
      if (route.type === "session") {
        return { sessionId: route.sessionId, type: "session" };
      }
      if (route.type === "plugin") {
        return {
          data: route.data ? { ...route.data } : undefined,
          id: route.id,
          returnRoute: route.returnRoute ? snapshotRoute(route.returnRoute) : undefined,
          type: "plugin",
        };
      }
      return { ...route } as Route;
    };

    return {
      back() {
        if (history.length > 0) {
          const previous = history.pop()!;
          const fromType = store.type;
          const toType = previous.type;
          log.debug(`路由返回: ${fromType} → ${toType}`, { historyDepth: history.length });
          setStore(reconcile(previous));
        } else {
          log.debug("路由返回:无历史记录，保持在当前页面");
        }
      },
      get data() {
        return store;
      },
      navigate(route: Route) {
        // 保存当前路由到历史栈(必须展开为普通对象快照，否则 push 的是
        // SolidJS 响应式代理的引用，后续 setStore 更新后历史栈全部变成最新值)
        const snapshot = snapshotRoute(store);
        history.push(snapshot);
        // 限制历史栈深度，防止内存泄漏
        if (history.length > 50) {
          history.shift();
        }
        const fromType = store.type;
        const toType = route.type;
        log.debug(`路由导航: ${fromType} → ${toType}`, { historyDepth: history.length });
        setStore(reconcile(route));
      },
    };
  },
  name: "Route",
});
