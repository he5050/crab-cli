/**
 * Helper Context Factory
 *
 * 职责:
 *   - 提供 SolidJS Context 工厂函数
 *   - 统一 Context 创建模式(use + provider)
 *   - 支持异步初始化(ready 字段检测)
 *
 * 模块功能:
 *   - 创建带类型安全的 Context
 *   - 自动生成 use hook 和 Provider 组件
 *   - 支持 props 传递到 init 函数
 *   - 自动处理未在 Provider 内使用的错误提示
 *
 * 使用场景:
 *   - 创建新的业务 Context
 *   - 统一项目内 Context 创建规范
 *   - 需要异步初始化的 Context
 *
 * 边界:
 *   1. 仅提供工厂函数，不包含具体业务逻辑
 *   2. 依赖 SolidJS 的 createContext/useContext
 *   3. 异步初始化通过 ready 字段约定
 *
 * 流程:
 *   1. 调用 createSimpleContext({ name, init })
 *   2. 返回 { use, provider } 对象
 *   3. 使用 provider 包裹组件树
 *   4. 子组件通过 use() 获取 Context 值
 */
import { type JSX, type ParentProps, createContext, useContext } from "solid-js";
import { createInternalError } from "@/core/errors/appError";

export interface SimpleContext<T, Props extends Record<string, unknown> = Record<string, unknown>> {
  /** 在 Provider 内获取 Context 值，Provider 外调用会抛错 */
  use: () => T;
  /** Context Provider 组件，接收 props 传给 init 函数 */
  provider: (props: ParentProps<Props>) => JSX.Element;
}

/** 带 ready 字段的 Context 值类型 */
interface WithReady {
  ready?: boolean;
}

/**
 * 创建简易 Context。
 * 支持异步初始化(当 init 返回的 value 包含 ready 字段时自动等待)。
 *
 * @param input.name - Context 名称，用于错误提示
 * @param input.init - 初始化函数，接收 props 返回 Context 值
 */
export function createSimpleContext<T, Props extends Record<string, unknown> = Record<string, unknown>>(input: {
  name: string;
  init: ((input: Props) => T) | (() => T);
}): SimpleContext<T, Props> {
  const ctx = createContext<T>();

  return {
    provider: (props: ParentProps<Props>) => {
      const value = input.init(props as Props);
      const ready =
        value === undefined || (value as WithReady).ready === undefined || (value as WithReady).ready === true;
      if (!ready) {
        return null;
      }
      return <ctx.Provider value={value}>{props.children}</ctx.Provider>;
    },
    use(): T {
      const value = useContext(ctx);
      if (!value) {
        throw createInternalError("INTERNAL_ERROR", `${input.name} context 必须在 Provider 内使用`);
      }
      return value;
    },
  };
}
