/**
 * PromptRef Context
 *
 * 职责:
 *   - 管理 Prompt 输入框引用
 *   - 提供跨组件的输入框控制能力
 *   - 支持 Home 和 Session 页共享输入框
 *
 * 模块功能:
 *   - 获取当前 Prompt 组件引用
 *   - 设置输入框值
 *   - 聚焦输入框
 *   - 提交当前输入
 *   - 读取当前输入值
 *
 * 使用场景:
 *   - 快捷键聚焦输入框
 *   - 预设输入框内容
 *   - 程序化提交消息
 *   - 跨页面共享输入状态
 *
 * 边界:
 *   1. 仅持有引用，不管理输入框内部状态
 *   2. 需要 Prompt 组件主动注册引用
 *   3. 不处理输入框渲染逻辑
 *
 * 流程:
 *   1. Prompt 组件初始化时调用 set() 注册引用
 *   2. 外部通过 usePromptRef() 获取引用
 *   3. 调用 focus()/set()/submit() 控制输入框
 *   4. 组件卸载时清除引用
 */
import { createSimpleContext } from "@/ui/contexts/helper";

/** Prompt 组件公开的接口 */
export interface PromptRef {
  /** 当前输入值 */
  readonly value: string;
  /** 设置输入值 */
  set(value: string): void;
  /** 聚焦输入框 */
  focus(): void;
  /** 提交当前输入 */
  submit(): void;
}

export const { use: usePromptRef, provider: PromptRefProvider } = createSimpleContext<{
  /** 获取当前 PromptRef */
  current: PromptRef | undefined;
  /** 设置 PromptRef */
  set(ref: PromptRef | undefined): void;
}>({
  init: () => {
    let current: PromptRef | undefined;

    return {
      get current() {
        return current;
      },
      set(ref: PromptRef | undefined) {
        current = ref;
      },
    };
  },
  name: "PromptRef",
});

/** 对齐计划与上层调用口径的别名导出 */
export const usePrompt = usePromptRef;
