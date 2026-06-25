/**
 * 会话回放器 — 回放录制的会话事件。
 *
 * 职责:
 *   - 加载录制文件
 *   - 按时间间隔回放事件
 *   - 支持实时/加速模式
 *   - 发布回放事件到 EventBus
 */

import { createLogger } from "@/core/logging/logger";
import { globalBus, type EventBus } from "@/bus";
import { AppEvent } from "@/bus";
import { type RecordedEvent, type RecordingData, loadRecording } from "./recorder";

const log = createLogger("session:replayer");

export type ReplaySpeed = 0.5 | 1 | 2 | 5 | 10;
export type ReplayState = "idle" | "playing" | "paused" | "completed" | "error";
export type ReplayProgressCallback = (progress: {
  current: number;
  total: number;
  event: RecordedEvent;
  state: ReplayState;
}) => void;

export class SessionReplayer {
  private data: RecordingData | null = null;
  private state: ReplayState = "idle";
  private currentIndex = 0;
  private speed: ReplaySpeed = 1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private onProgress: ReplayProgressCallback | null = null;
  private startWallTime = 0;
  private pausedAtElapsed = 0;
  private readonly eventBus: EventBus;

  constructor(eventBus: EventBus = globalBus) {
    this.eventBus = eventBus;
  }

  get replayState(): ReplayState {
    return this.state;
  }
  get replayProgress(): number {
    return this.data ? this.currentIndex / this.data.events.length : 0;
  }
  get loadedRecordingId(): string | null {
    return this.data?.meta.id ?? null;
  }

  load(id: string): boolean {
    const data = loadRecording(id);
    if (!data) {
      log.warn(`录制文件不存在: ${id}`);
      return false;
    }
    this.data = data;
    this.currentIndex = 0;
    this.state = "idle";
    log.info(`已加载录制: ${id} (${data.events.length} 个事件)`);
    return true;
  }

  loadFromData(data: RecordingData): void {
    this.data = data;
    this.currentIndex = 0;
    this.state = "idle";
  }

  setSpeed(speed: ReplaySpeed): void {
    this.speed = speed;
    if (this.state === "playing") {
      this.pause();
      this.play();
    }
  }

  onProgressUpdate(cb: ReplayProgressCallback): void {
    this.onProgress = cb;
  }

  async play(): Promise<void> {
    if (!this.data || this.data.events.length === 0) {
      this.state = "completed";
      return;
    }

    this.state = "playing";
    this.startWallTime = Date.now();

    if (this.pausedAtElapsed > 0) {
      this.startWallTime -= this.pausedAtElapsed;
    }

    this.scheduleNext();
  }

  pause(): void {
    if (this.state !== "playing") {
      return;
    }
    this.state = "paused";
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pausedAtElapsed = Date.now() - this.startWallTime;
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.currentIndex = 0;
    this.pausedAtElapsed = 0;
    this.state = "idle";
  }

  seekTo(index: number): void {
    if (!this.data) {
      return;
    }
    this.currentIndex = Math.max(0, Math.min(index, this.data.events.length - 1));
  }

  private scheduleNext(): void {
    if (!this.data || this.state !== "playing") {
      return;
    }

    if (this.currentIndex >= this.data.events.length) {
      this.state = "completed";
      this.pausedAtElapsed = 0;
      this.onProgress?.({
        current: this.currentIndex,
        event: null as unknown as RecordedEvent,
        state: "completed",
        total: this.data.events.length,
      });
      return;
    }

    const event = this.data.events[this.currentIndex]!;
    const elapsed = Date.now() - this.startWallTime;
    const eventTime = event.ts - this.data!.meta.startedAt;

    const delay = Math.max(0, (eventTime - elapsed) / this.speed);

    this.timer = setTimeout(() => {
      if (this.state !== "playing") {
        return;
      }
      this.dispatchEvent(event);
      this.currentIndex++;
      this.onProgress?.({
        current: this.currentIndex,
        event,
        state: "playing",
        total: this.data!.events.length,
      });
      this.scheduleNext();
    }, delay);
  }

  private dispatchEvent(event: RecordedEvent): void {
    const data = event.data as Record<string, unknown>;
    switch (event.type) {
      case "conversation.message.sent": {
        this.eventBus.publish(AppEvent.ConversationMessageSent, {
          content: String(data.content ?? ""),
          role: (data.role as "user" | "assistant") ?? "user",
          sessionId: data.sessionId as string,
        });
        break;
      }
      case "conversation.stream.token": {
        this.eventBus.publish(AppEvent.ConversationStreamToken, {
          content: String(data.content ?? ""),
          sessionId: data.sessionId as string,
          tokenCount: Number(data.tokenCount ?? 1),
        });
        break;
      }
      case "conversation.tool.call": {
        this.eventBus.publish(AppEvent.ConversationToolCall, {
          args: data.args,
          callId: String(data.callId ?? ""),
          sessionId: data.sessionId as string,
          tool: String(data.tool ?? ""),
        });
        break;
      }
      case "tool.result": {
        this.eventBus.publish(AppEvent.ToolResult, {
          callId: String(data.callId ?? ""),
          result: data.result,
          sessionId: data.sessionId as string,
          success: data.success as boolean,
          tool: String(data.tool ?? ""),
        });
        break;
      }
      case "conversation.completed": {
        this.eventBus.publish(AppEvent.ConversationCompleted, {
          durationMs: Number(data.durationMs ?? 0),
          ok: data.ok as boolean,
          sessionId: data.sessionId as string,
          textLength: Number(data.textLength ?? 0),
          toolRounds: Number(data.toolRounds ?? 0),
        });
        break;
      }
    }
  }
}
