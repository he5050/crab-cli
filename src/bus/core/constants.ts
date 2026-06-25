export const HISTORY_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

export const MAX_EVENT_QUEUE_SIZE = 10_000;

export const DEFAULT_THROTTLED_EVENT_TYPES = new Set<string>([
  "app.log",
  "tool.result",
  "conversation.stream.token",
  "resource.update",
]);
