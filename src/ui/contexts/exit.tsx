/**
 * Exit Context
 *
 * 职责:
 *   - 追踪应用退出状态
 *   - 提供优雅退出请求机制
 *   - 协调终端状态恢复
 *
 * 模块功能:
 *   - 设置退出标志
 *   - 查询当前退出状态
 *   - 防止重复退出请求
 *
 * 使用场景:
 *   - 用户触发退出快捷键
 *   - 异常处理后的应用关闭
 *   - 终端状态清理前的标志设置
 *
 * 边界:
 *   1. 不直接调用 process.exit
 *   2. 由 Renderer 负责实际的终端状态恢复
 *   3. 仅设置标志位，不执行清理操作
 *
 * 流程:
 *   1. 调用 requestExit() 请求退出
 *   2. 设置 exiting 标志为 true
 *   3. Renderer 检测到标志后执行 destroy
 *   4. 完成终端状态恢复
 */
import { createSignal } from "solid-js";
import { createSimpleContext } from "@/ui/contexts/helper";

/** 退出 Context 值 */
export interface ExitContextValue {
  /** 是否正在退出 */
  isExiting: () => boolean;
  /** 请求退出(设置标志，不直接执行 destroy) */
  requestExit: () => void;
}

export const { use: useExit, provider: ExitProvider } = createSimpleContext<ExitContextValue>({
  init: () => {
    const [exiting, setExiting] = createSignal(false);

    return {
      isExiting: exiting,
      requestExit() {
        if (exiting()) {
          return;
        }
        setExiting(true);
      },
    };
  },
  name: "Exit",
});
