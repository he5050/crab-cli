import { ThrottlePriority } from "@/core/concurrency/throttleQueue";

export interface EventDefinition<T = unknown> {
  type: string;
}

export interface EventPayload<T = unknown> {
  id: string;
  type: string;
  properties: T;
}

export type EventHandler<T = unknown> = (data: EventPayload<T>) => void;

export interface EventQueueItem {
  type: string;
  payload: EventPayload<unknown>;
  priority: ThrottlePriority;
}

export interface EventHistoryItem {
  type: string;
  payload: EventPayload<unknown>;
  timestamp: number;
}
