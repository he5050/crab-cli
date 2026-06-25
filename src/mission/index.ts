export { DEFAULT_GOAL_TOKEN_BUDGET } from "./types";
export { GoalManager, goalManager } from "./goal";
export { TaskManager, taskManager } from "./task/manager";
export { executeTask } from "./task/executor";
export {
  LoopManager,
  loopManager,
  parseLoopSchedule,
  scheduleLabel,
  validateCron,
  calculateNextCronRun,
} from "./loop/manager";
export { LoopDaemonManager, loopDaemonManager } from "./loop/daemon";

// ─── 测试覆写支持 ─────────────────────────────────────────────
export { __setLoopManagerDepsForTesting, __resetLoopManagerDepsForTesting } from "./loop/manager";

import { goalManager } from "./goal";
import { taskManager } from "./task/manager";
import { loopManager } from "./loop/manager";
import { loopDaemonManager } from "./loop/daemon";
import type { GoalManager } from "./goal";
import type { TaskManager } from "./task/manager";
import type { LoopManager } from "./loop/manager";
import type { LoopDaemonManager } from "./loop/daemon";
import type { AppConfigSchema } from "@/schema/config";

export function initTaskRuntime(
  projectDir: string = process.cwd(),
  managers: {
    taskManager?: TaskManager;
    goalManager?: GoalManager;
    loopManager?: LoopManager;
    loopDaemonManager?: LoopDaemonManager;
  } = {},
  options: {
    skipTaskLoad?: boolean;
    config?: AppConfigSchema;
  } = {},
): void {
  const taskMgr = managers.taskManager ?? taskManager;
  const goalMgr = managers.goalManager ?? goalManager;
  const loopMgr = managers.loopManager ?? loopManager;
  const loopDaemonMgr = managers.loopDaemonManager ?? loopDaemonManager;

  taskMgr.setProjectDir(projectDir);
  if (!options.skipTaskLoad) {
    taskMgr.loadFromDisk();
  }
  goalMgr.setProjectDir(projectDir);

  loopMgr.setProjectDir(projectDir);
  loopDaemonMgr.setProjectDir(projectDir);
  loopMgr.loadFromDisk(projectDir);
  if (options.config) {
    loopMgr.setConfig(options.config);
    loopMgr.restoreActiveLoops(options.config);
  }
}
