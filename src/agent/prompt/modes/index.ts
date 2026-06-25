import type { ChatMode } from "../types";
import { CHAT_MODE_INSTRUCTION } from "./chat";
import { PLAN_MODE_INSTRUCTION } from "./plan";
import { TEAM_MODE_INSTRUCTION } from "./team";
import { YOLO_MODE_INSTRUCTION } from "./yolo";
import { SIMPLE_MODE_INSTRUCTION } from "./simple";
import { SECURITY_MODE_INSTRUCTION } from "./security";

export { MODE_META, getModeMeta, listModes, isReadOnlyMode, isAutoApproveMode, isToollessMode } from "../types";
export type { ChatMode, ModeMeta } from "../types";

/** 模式 → 指令映射 */
export const MODE_INSTRUCTIONS: Record<ChatMode, string> = {
  chat: CHAT_MODE_INSTRUCTION,
  plan: PLAN_MODE_INSTRUCTION,
  security: SECURITY_MODE_INSTRUCTION,
  simple: SIMPLE_MODE_INSTRUCTION,
  team: TEAM_MODE_INSTRUCTION,
  yolo: YOLO_MODE_INSTRUCTION,
};

/**
 * 获取纯模式指令文本(用于测试和预览)。
 */
export function getModeInstruction(mode: ChatMode): string {
  return MODE_INSTRUCTIONS[mode] ?? "";
}

export {
  CHAT_MODE_INSTRUCTION,
  PLAN_MODE_INSTRUCTION,
  TEAM_MODE_INSTRUCTION,
  YOLO_MODE_INSTRUCTION,
  SIMPLE_MODE_INSTRUCTION,
  SECURITY_MODE_INSTRUCTION,
};
