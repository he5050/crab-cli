// src/mission/type.ts
// Mission 模块公共类型导出入口

export type {
  AsyncTask,
  TaskStatus,
  GoalStatus,
  GoalRecord,
  GoalStatusUpdate,
  GoalCreateOptions,
  TaskEventPayload,
  GoalEventPayload,
} from "./types";

export type { TaskExecutorOptions, TaskExecutorResult } from "./task/executor";
export type { LoopExecutionRecord, LoopRecord, LoopScheduleInput, LoopStats } from "./loop/schedule";
export type { LoopDaemonStatus, LoopDaemonRecord } from "./loop/daemon";

export type { GoalManager } from "./goal";
export type { TaskManager } from "./task/manager";
export type { LoopManager } from "./loop/manager";
export type { LoopDaemonManager } from "./loop/daemon";
