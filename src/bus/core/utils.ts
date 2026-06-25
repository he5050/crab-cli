import type { EventDefinition, EventHistoryItem } from "./types";

export function defineEvent<T>(type: string): EventDefinition<T> {
  return { type };
}

export function filterExpiredEvents(snapshot: EventHistoryItem[], cutoff: number, maxSize: number): EventHistoryItem[] {
  if (snapshot.length === 0) {
    return snapshot;
  }

  let firstValidIndex = -1;
  for (let i = 0; i < snapshot.length; i++) {
    if (snapshot[i]!.timestamp >= cutoff) {
      firstValidIndex = i;
      break;
    }
  }

  if (firstValidIndex === -1) {
    return [];
  }

  let result = firstValidIndex > 0 ? snapshot.slice(firstValidIndex) : snapshot;
  if (result.length > maxSize) {
    result = result.slice(-maxSize);
  }

  return result;
}
