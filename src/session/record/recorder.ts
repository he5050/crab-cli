/**
 * 会话录制器 — 录制会话事件到文件。
 *
 * 职责:
 *   - 订阅 EventBus 对话事件
 *   - 按时间顺序记录事件到 JSON 文件
 *   - 支持 start/stop/pause/resume
 *   - 录制文件存储在 .crab/recordings/
 *
 * 录制文件格式:
 *   {
 *     meta: { sessionId, startedAt, endedAt, eventCount, durationMs, fileSize },
 *     events: [
 *       { ts, type, data },
 *       ...
 *     ]
 *   }
 */

import { createLogger } from "@/core/logging/logger";
import { createId } from "@/core/identity";
import { globalBus, type EventBus } from "@/bus";
import { AppEvent } from "@/bus";
import * as fs from "node:fs";
import * as path from "node:path";

const log = createLogger("session:recorder");

const RECORDINGS_DIR = ".crab/recordings";

export interface RecordedEvent {
  ts: number;
  type: string;
  data: unknown;
}

export interface RecordingMeta {
  id: string;
  sessionId: string;
  label?: string;
  startedAt: number;
  endedAt?: number;
  eventCount: number;
  durationMs?: number;
  fileSize?: number;
}

export interface RecordingData {
  meta: RecordingMeta;
  events: RecordedEvent[];
}

export class SessionRecorder {
  private recording = false;
  private paused = false;
  private sessionId = "";
  private events: RecordedEvent[] = [];
  private startTs = 0;
  private recordingId = "";
  private subscriptions: (() => void)[] = [];
  private label = "";
  private readonly eventBus: EventBus;

  constructor(eventBus: EventBus = globalBus) {
    this.eventBus = eventBus;
  }

  get isRecording(): boolean {
    return this.recording;
  }
  get isPaused(): boolean {
    return this.paused;
  }
  get eventCount(): number {
    return this.events.length;
  }
  get durationMs(): number {
    return this.recording ? Date.now() - this.startTs : 0;
  }
  get currentRecordingId(): string {
    return this.recordingId;
  }

  start(sessionId: string, label?: string): void {
    if (this.recording) {
      log.warn("录制器已在运行中");
      return;
    }

    this.recording = true;
    this.paused = false;
    this.sessionId = sessionId;
    this.events = [];
    this.startTs = Date.now();
    this.recordingId = createId("rec");
    this.label = label ?? `录制 ${new Date().toISOString().slice(0, 19)}`;

    this.subscribe();

    log.info(`录制已开始: ${this.recordingId} (会话 ${sessionId})`);
  }

  stop(): RecordingMeta | null {
    if (!this.recording) {
      return null;
    }

    this.eventBus.flushSync();
    this.unsubscribe();
    this.recording = false;
    const duration = Date.now() - this.startTs;
    const meta: RecordingMeta = {
      durationMs: duration,
      endedAt: Date.now(),
      eventCount: this.events.length,
      id: this.recordingId,
      label: this.label,
      sessionId: this.sessionId,
      startedAt: this.startTs,
    };

    const data: RecordingData = { events: this.events, meta };

    try {
      const dir = path.join(process.cwd(), RECORDINGS_DIR);
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, `${this.recordingId}.json`);
      const json = JSON.stringify(data, null, 2);
      fs.writeFileSync(filePath, json, "utf8");
      meta.fileSize = json.length;
      log.info(`录制已保存: ${filePath} (${this.events.length} 个事件, ${duration}ms)`);
    } catch (error) {
      log.error(`保存录制文件失败: ${error}`);
    }

    this.events = [];
    return meta;
  }

  pause(): void {
    if (!this.recording || this.paused) {
      return;
    }
    this.paused = true;
    log.info("录制已暂停");
  }

  resume(): void {
    if (!this.recording || !this.paused) {
      return;
    }
    this.paused = false;
    log.info("录制已恢复");
  }

  private subscribe(): void {
    this.subscriptions.push(
      this.eventBus.subscribe(AppEvent.ConversationMessageSent, (evt) => {
        if (this.paused) {
          return;
        }
        this.record("conversation.message.sent", evt.properties);
      }),
    );
    this.subscriptions.push(
      this.eventBus.subscribe(AppEvent.ConversationStreamToken, (evt) => {
        if (this.paused) {
          return;
        }
        this.record("conversation.stream.token", evt.properties);
      }),
    );
    this.subscriptions.push(
      this.eventBus.subscribe(AppEvent.ConversationToolCall, (evt) => {
        if (this.paused) {
          return;
        }
        this.record("conversation.tool.call", evt.properties);
      }),
    );
    this.subscriptions.push(
      this.eventBus.subscribe(AppEvent.ToolResult, (evt) => {
        if (this.paused) {
          return;
        }
        this.record("tool.result", {
          callId: evt.properties.callId,
          success: evt.properties.success,
          tool: evt.properties.tool,
        });
      }),
    );
    this.subscriptions.push(
      this.eventBus.subscribe(AppEvent.ConversationCompleted, (evt) => {
        if (this.paused) {
          return;
        }
        this.record("conversation.completed", evt.properties);
      }),
    );
  }

  private unsubscribe(): void {
    for (const unsub of this.subscriptions) {
      unsub();
    }
    this.subscriptions = [];
  }

  private record(type: string, data: unknown): void {
    this.events.push({ data, ts: Date.now(), type });
  }
}

export function listRecordings(): RecordingMeta[] {
  const dir = path.join(process.cwd(), RECORDINGS_DIR);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const entries = fs.readdirSync(dir);
    return entries
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          const raw = fs.readFileSync(path.join(dir, f), "utf8");
          const data = JSON.parse(raw) as RecordingData;
          return { ...data.meta, fileSize: raw.length };
        } catch {
          return null;
        }
      })
      .filter(Boolean) as RecordingMeta[];
  } catch {
    return [];
  }
}

export function loadRecording(id: string): RecordingData | null {
  const filePath = path.join(process.cwd(), RECORDINGS_DIR, `${id}.json`);
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as RecordingData;
  } catch {
    return null;
  }
}

export function deleteRecording(id: string): boolean {
  const filePath = path.join(process.cwd(), RECORDINGS_DIR, `${id}.json`);
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}
