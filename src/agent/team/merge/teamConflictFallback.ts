/**
 * Team 冲突回退模块 — 合并冲突时请求用户选择处理策略。
 *
 * 职责:
 *   - 广播冲突回退请求事件
 *   - 等待用户响应或超时
 *   - 决定后续合并走向(ours-prefer / manual / abort)
 *
 * 模块功能:
 *   - requestConflictFallbackChoice: 等待用户选择
 *   - ConflictFallbackChoice: 选择枚举
 *   - AutoConflictResolution: 自动解析结果类型
 */
import { AppEvent } from "@/bus";
import { globalBus, type EventBus } from "@/bus";
import { createId } from "@/core/identity";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("team:conflict-fallback");

export type ConflictFallbackChoice = "ours-prefer" | "manual" | "abort";

export interface AutoConflictResolution {
  status: "resolved" | "manual" | "abort" | "failed";
}

export async function requestConflictFallbackChoice(
  conflicts: string[],
  failed: string[],
  timeoutMs = 1000,
  eventBus: EventBus = globalBus,
): Promise<ConflictFallbackChoice> {
  const requestId = createId("req");
  const choices = new Set<ConflictFallbackChoice>(["ours-prefer", "manual", "abort"]);

  return await new Promise<ConflictFallbackChoice>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsub: () => void = () => {};
    const cleanup = () => {
      unsub();
      if (timer) {
        clearTimeout(timer);
      }
    };
    const settle = (choice: ConflictFallbackChoice) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(choice);
    };

    unsub = eventBus.subscribe(AppEvent.UserInput, (event) => {
      const props = event.properties;
      if (props.requestId !== requestId || props.cancelled) {
        return;
      }
      const answer = props.answer as ConflictFallbackChoice | undefined;
      if (answer && choices.has(answer)) {
        settle(answer);
      }
    });

    eventBus.publish(AppEvent.UserInputRequested, {
      allowFreeInput: false,
      defaultValue: "ours-prefer",
      multiSelect: false,
      options: [
        { description: "保留主工作区版本并继续完成合并。", label: "Prefer ours", value: "ours-prefer" },
        { description: "保留冲突状态，交给用户手动解决。", label: "Manual", value: "manual" },
        { description: "中止本次合并。", label: "Abort", value: "abort" },
      ],
      placeholder: conflicts.join(", "),
      question: `Team 自动合并有 ${failed.length} 个冲突文件未能由 LLM 解决。`,
      requestId,
    });

    timer = setTimeout(() => settle("ours-prefer"), timeoutMs);
  });
}

export async function applyOursPreferConflictFallback(projectDir: string, conflicts: string[]): Promise<boolean> {
  for (const file of conflicts) {
    const proc = Bun.spawnSync(["git", "checkout", "--ours", "--", file], {
      cwd: projectDir,
      stderr: "pipe",
      stdout: "pipe",
    });
    if (proc.exitCode !== 0) {
      log.warn(`ours-prefer fallback 失败: ${file}`);
      return false;
    }
  }

  const addProc = Bun.spawnSync(["git", "add", "-A", "--", ...conflicts], {
    cwd: projectDir,
    stderr: "pipe",
    stdout: "pipe",
  });
  if (addProc.exitCode !== 0) {
    log.error("git add 冲突文件失败");
    return false;
  }

  return true;
}
