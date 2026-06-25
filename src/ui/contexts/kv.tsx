/**
 * KV Context
 *
 * 职责:
 *   - 提供内存键值存储
 *   - 管理 UI 层临时状态
 *   - 支持类型安全的值存取
 *
 * 模块功能:
 *   - 获取指定键的值
 *   - 设置键值对
 *   - 删除指定键
 *   - 支持泛型类型推断
 *
 * 使用场景:
 *   - 组件间共享临时状态
 *   - 缓存计算结果
 *   - 存储 UI 临时数据
 *
 * 边界:
 *   1. 仅用于 UI 层临时状态
 *   2. 不持久化，应用重启数据丢失
 *   3. 单进程内存存储
 *
 * 流程:
 *   1. 调用 set(key, value) 存储数据
 *   2. 调用 get<T>(key) 读取数据
 *   3. 调用 remove(key) 删除数据
 */
import { createSimpleContext } from "@/ui/contexts/helper";

/** KV Context 值 */
export interface KVContextValue {
  /** 获取值 */
  get: <T = unknown>(key: string) => T | undefined;
  /** 设置值 */
  set: (key: string, value: unknown) => void;
  /** 删除键 */
  remove: (key: string) => void;
}

export const { use: useKV, provider: KVProvider } = createSimpleContext<KVContextValue>({
  init: () => {
    const store = new Map<string, unknown>();

    // 默认 KV 值
    store.set("animations_enabled", true);

    return {
      get<T = unknown>(key: string): T | undefined {
        return store.get(key) as T | undefined;
      },
      remove(key: string) {
        store.delete(key);
      },
      set(key: string, value: unknown) {
        store.set(key, value);
      },
    };
  },
  name: "KV",
});
