/**
 * Buddy 通知 — 孵化引导气泡
 *
 */

import { onMount, onCleanup } from "solid-js";
import { getCompanion, isCompanionMuted } from "./companion";
import { companionReaction } from "./events";

// ─── 时间窗口 ──────────────────────────────────────────────────

const TEASER_START = Date.UTC(2026, 3, 1, 0, 0, 0);
const TEASER_END = Date.UTC(2026, 3, 8, 0, 0, 0);
const LIVE_START = Date.UTC(2026, 3, 1, 0, 0, 0);

export function isBuddyTeaserWindow(now = Date.now()): boolean {
  return now >= TEASER_START && now < TEASER_END;
}

export function isBuddyLive(now = Date.now()): boolean {
  return now >= LIVE_START;
}

export function findBuddyTriggerPositions(text: string): number[] {
  const positions: number[] = [];
  const pattern = /\/buddy\b/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    positions.push(match.index);
  }
  return positions;
}

// ─── 通知 hook ──────────────────────────────────────────────────

const TEASER_TEXT = "You can adopt a terminal companion! Type /buddy hatch to meet yours.";

export function useBuddyNotification(): void {
  onMount(() => {
    if (getCompanion() || !isBuddyTeaserWindow() || isCompanionMuted()) {
      return;
    }
    const timer = setTimeout(() => {
      companionReaction(TEASER_TEXT);
    }, 1200);
    onCleanup(() => clearTimeout(timer));
  });
}
