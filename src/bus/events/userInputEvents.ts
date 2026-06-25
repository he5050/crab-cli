/**
 * Ask-user 用户输入事件 — UI 发起提问请求与回传答案。
 *
 * 职责:定义多步骤提问 + 单步提问的事件契约。
 * 边界:options 形状由订阅方按 UI 框架二次封装。
 */
import { defineEvent } from "../core";

export const UserInputEvents = {
  /** Ask-user 向 UI 发起提问请求 */
  UserInputRequested: defineEvent<{
    requestId: string;
    question: string;
    options?: { label: string; value: string; description?: string }[];
    multiSelect: boolean;
    defaultValue?: string;
    allowFreeInput?: boolean;
    placeholder?: string;
    steps?: {
      id?: string;
      title: string;
      question: string;
      options?: { label: string; value: string; description?: string }[];
      multiSelect?: boolean;
      defaultValue?: string;
      allowFreeInput?: boolean;
      placeholder?: string;
    }[];
  }>("user.input.requested"),

  /** UI 回传 ask-user 的用户输入 */
  UserInput: defineEvent<{
    requestId: string;
    answer?: string;
    cancelled?: boolean;
  }>("user.input"),
} as const;
