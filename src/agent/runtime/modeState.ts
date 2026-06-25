/**
 * 模式状态管理 — 管理当前对话模式和 YOLO 叠加。
 *
 * 职责:
 *   - 维护当前 ChatMode 状态
 *   - 管理 YOLO 叠加(在任意模式之上叠加 YOLO 行为)
 *   - 发布模式切换事件
 *   - 协调模式切换与 Agent 切换
 *
 * 模块功能:
 *   - getCurrentMode: 获取当前模式
 *   - getYoloOverlay: 获取 YOLO 叠加状态
 *   - getEffectiveMode: 获取有效模式(考虑 YOLO 叠加)
 *   - switchMode: 切换到指定模式
 *   - resetModeState: 重置模式状态(用于测试清理)
 *
 * 使用场景:
 *   - 用户切换对话模式(chat/plan/team/yolo)
 *   - 需要获取当前生效的模式配置
 *   - 模式切换时自动切换对应的 Agent
 *   - YOLO 模式的开启/关闭
 *
 * 边界:
 *   1. 纯状态管理，不涉及 TUI 渲染
 *   2. 仅维护内存中的模式状态，不持久化
 *   3. YOLO 是叠加模式，可在任意基础模式之上开启
 *   4. 切换非 YOLO 模式时会自动清除 YOLO 叠加
 *
 * 流程:
 *   1. 用户调用 switchMode(mode) 请求模式切换
 *   2. 如果是 YOLO 模式，切换叠加状态开/关
 *   3. 如果是其他模式:
 *      - 更新 currentMode
 *      - 清除 YOLO 叠加
 *      - 根据 MODE_META 切换对应的 Agent
 *   4. 发布 Toast 事件通知 UI 显示模式切换
 */
import type { ChatMode } from "@/agent/prompt/modes";
import { MODE_META, getModeMeta } from "@/agent/prompt/modes";
import { setActiveAgent } from "@/agent/core/manager";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("agent:mode-state");

/** 当前活跃模式 */
let currentMode: ChatMode = "chat";

/** YOLO 叠加状态(可以在 chat/plan/team 之上叠加) */
let yoloOverlay: boolean = false;

/**
 * 获取当前模式。
 */
export function getCurrentMode(): ChatMode {
  return currentMode;
}

/**
 * 获取 YOLO 叠加状态。
 */
export function getYoloOverlay(): boolean {
  return yoloOverlay;
}

/**
 * 获取有效模式(考虑 YOLO 叠加)。
 * 如果 YOLO 叠加开启，返回 "yolo"。
 */
export function getEffectiveMode(): ChatMode {
  if (yoloOverlay) {
    return "yolo";
  }
  return currentMode;
}

/**
 * 切换到指定模式。
 *
 * 行为:
 *   - chat: 切换到 general Agent
 *   - plan: 切换到 plan Agent
 *   - team: 切换到 team-lead Agent
 *   - yolo: 叠加/取消 YOLO 标识(不切换 Agent)
 *
 * @param onToast - 可选的回调，模式切换成功后调用以通知 UI（如显示 toast）。
 *                 不传则静默切换，由调用方自行处理通知。
 * @returns 是否成功切换
 */
export function switchMode(mode: ChatMode, onToast?: (message: string) => void): boolean {
  const previous = currentMode;
  const previousYolo = yoloOverlay;

  if (mode === "yolo") {
    // YOLO 是叠加模式，切换其开/关
    yoloOverlay = !yoloOverlay;
    log.info(`YOLO 叠加: ${yoloOverlay ? "开启" : "关闭"}`);
  } else {
    // 非 YOLO 模式:切换基础模式
    currentMode = mode;
    yoloOverlay = false; // 切换模式时清除 YOLO 叠加

    // 切换对应的 Agent
    const meta = MODE_META[mode];
    if (meta.agentName) {
      const switched = setActiveAgent(meta.agentName);
      if (!switched) {
        log.warn(`模式 ${mode} 对应的 Agent ${meta.agentName} 不存在，回退到 chat`);
        currentMode = "chat";
        setActiveAgent("general");
      }
    } else {
      // Chat 模式切换回 general
      setActiveAgent("general");
    }
  }

  const effectiveMode = getEffectiveMode();
  const effectiveMeta = getModeMeta(effectiveMode);

  log.info(`模式切换: ${previous}${previousYolo ? "+YOLO" : ""} → ${effectiveMode}`);
  if (onToast) {
    onToast(`${effectiveMeta.icon} ${effectiveMeta.label} 模式`);
  }

  return true;
}

/**
 * 重置模式状态(用于测试清理)。
 */
export function resetModeState(): void {
  currentMode = "chat";
  yoloOverlay = false;
}
