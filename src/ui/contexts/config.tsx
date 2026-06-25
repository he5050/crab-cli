/**
 * Config Context
 *
 * 职责:
 *   - 在组件树中传递应用配置
 *   - 支持配置热更新
 *   - 提供配置读取和更新接口
 *
 * 模块功能:
 *   - 注入配置对象到组件树
 *   - 订阅配置更新事件
 *   - 提供配置读取访问
 *   - 提供配置更新方法
 *
 * 使用场景:
 *   - 组件需要访问应用配置
 *   - 配置变更后同步到所有组件
 *   - 主题、语言等配置的热更新
 *
 * 边界:
 *   1. 配置持久化由外部 saveConfig 处理
 *   2. 仅管理内存中的配置状态
 *   3. 配置更新通过事件总线发布
 *
 * 流程:
 *   1. 初始化时加载配置
 *   2. 通过 Provider 注入组件树
 *   3. 订阅 ConfigUpdated 事件
 *   4. 配置变更时更新状态
 */
import { type JSX, type Setter, createContext, createSignal, onCleanup, useContext } from "solid-js";
import type { AppConfigSchema as AppConfigType } from "@/schema/config";
import { useEventBus } from "@/ui/contexts/eventBus";
import { AppEvent } from "@bus";
import { createInternalError } from "@/core/errors/appError";

/** 配置 Context 值 */
export interface ConfigContextValue {
  /** 当前应用配置 */
  config: AppConfigType;
  /** 更新配置(仅内存，需手动调用 saveConfig 持久化) */
  setConfig: Setter<AppConfigType>;
}

const ConfigContext = createContext<ConfigContextValue>();

export function ConfigProvider(props: { config: AppConfigType; children: JSX.Element }) {
  const eventBus = useEventBus();
  const [config, setConfig] = createSignal(props.config);

  // 订阅配置热更新事件(save / hot-reload)
  const unsub = eventBus.subscribe(AppEvent.ConfigUpdated, (evt) => {
    setConfig(evt.properties.config as AppConfigType);
  });
  onCleanup(() => {
    unsub();
  });

  return (
    <ConfigContext.Provider
      value={{
        get config() {
          return config();
        },
        setConfig,
      }}
    >
      {props.children}
    </ConfigContext.Provider>
  );
}

export function useConfig(): ConfigContextValue {
  const ctx = useContext(ConfigContext);
  if (!ctx) {
    throw createInternalError("INTERNAL_ERROR", "useConfig must be used within ConfigProvider");
  }
  return ctx;
}
