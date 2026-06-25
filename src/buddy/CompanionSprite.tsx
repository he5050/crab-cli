/**
 * Buddy 宠物伴侣 — SolidJS 精灵组件
 *
 */

import { createSignal, createMemo, onCleanup, For, Show } from "solid-js";
import { visualWidth } from "@/core/utilities/textUtils";
import { getCompanion, isCompanionMuted } from "./companion";
import { companionEvents } from "./events";
import type { CompanionEventPayload } from "./events";
import {
  renderFace,
  renderPetSprite,
  renderSleepFace,
  renderSleepSprite,
  renderSprite,
  speciesColor,
  spriteFrameCount,
} from "./sprites";
import type { Companion } from "./types";

// ─── 常量 ──────────────────────────────────────────────────────

const TICK_MS = 500;
const BUBBLE_SHOW = 20;
const FADE_WINDOW = 6;
const PET_BURST_MS = 2500;
const SLEEP_TIMEOUT_MS = 3 * 60 * 1000;
const MIN_COLS_FOR_FULL_SPRITE = 64;
const MAX_RESERVED_COLUMNS = 30;
const SPEAKING_RESERVED_COLUMNS = 18;
const DIALOGUE_MAX_WIDTH = 36;
const IDLE_SEQUENCE = [0, 0, 0, 0, 1, 0, 0, 0, -1, 0, 0, 2, 0, 0, 0];
const PET_SEQUENCE = [2, 1, 0, 1, 2, 0];

// ─── 命名色 → hex 映射 ────────────────────────────────────────

const NAMED_COLORS: Record<string, string> = {
  yellow: "#d4a017",
  white: "#b0b0b0",
  magenta: "#c864c8",
  yellowBright: "#ffd700",
  green: "#3cb371",
  gray: "#6e7681",
  whiteBright: "#e0e0e0",
  cyan: "#17a2b8",
  red: "#e74c3c",
  blue: "#3498db",
  cyanBright: "#00ced1",
};

function speciesColorHex(species: Companion["species"]): string {
  return NAMED_COLORS[speciesColor(species)] ?? "#b0b0b0";
}

// ─── 文本工具 ──────────────────────────────────────────────────

function maxLineWidth(lines: string[]): number {
  return lines.reduce((max, line) => Math.max(max, visualWidth(line)), 0);
}

function padRight(value: string, width: number): string {
  return `${value}${" ".repeat(Math.max(0, width - visualWidth(value)))}`;
}

function wrapText(value: string, maxWidth: number): string[] {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return [];

  const lines: string[] = [];
  let current = "";

  for (const word of normalized.split(" ")) {
    if (visualWidth(word) > maxWidth) {
      if (current) {
        lines.push(current);
        current = "";
      }
      let chunk = "";
      for (const char of word) {
        const nextChunk = `${chunk}${char}`;
        if (chunk && visualWidth(nextChunk) > maxWidth) {
          lines.push(chunk);
          chunk = char;
        } else {
          chunk = nextChunk;
        }
      }
      if (chunk) current = chunk;
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if (visualWidth(next) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);
  return lines;
}

function renderDialogueBox(value: string, maxWidth: number): string[] {
  const contentLines = wrapText(value, maxWidth);
  if (contentLines.length === 0) return [];

  const contentWidth = Math.max(...contentLines.map((l) => visualWidth(l)));
  const horizontal = "─".repeat(contentWidth + 2);
  return [`┌${horizontal}┐`, ...contentLines.map((l) => `│ ${padRight(l, contentWidth)} │`), `└${horizontal}┘`];
}

// ─── 布局工具 ──────────────────────────────────────────────────

export function companionReservedColumns(terminalColumns: number, speaking = false): number {
  const companion = getCompanion();
  if (!companion || isCompanionMuted() || terminalColumns < MIN_COLS_FOR_FULL_SPRITE) {
    return 0;
  }
  const spriteWidth = maxLineWidth(renderSprite(companion, 0));
  const nameWidth = visualWidth(companion.name) + 2;
  const bubbleWidth = speaking ? SPEAKING_RESERVED_COLUMNS : 0;
  return Math.min(MAX_RESERVED_COLUMNS, Math.max(spriteWidth, nameWidth, bubbleWidth) + 2);
}

// ─── CompanionSprite 组件 ──────────────────────────────────────

interface CompanionSpriteProps {
  terminalColumns: number;
}

export function CompanionSprite(props: CompanionSpriteProps) {
  const [tick, setTick] = createSignal(0);
  const [reaction, setReaction] = createSignal<string | undefined>(undefined);
  const [reactionStartedAt, setReactionStartedAt] = createSignal(0);
  const [petAt, setPetAt] = createSignal<number | undefined>(undefined);
  const [lastInteractionAt, setLastInteractionAt] = createSignal(Date.now());
  const [companion, setCompanion] = createSignal<Companion | undefined>(getCompanion());

  // 定时器：驱动动画帧
  const timer = setInterval(() => setTick((v) => v + 1), TICK_MS);
  onCleanup(() => clearInterval(timer));

  // 事件订阅：reaction / pet / refresh
  onCleanup(
    companionEvents.onChange((payload: CompanionEventPayload) => {
      if (payload.refresh) {
        setCompanion(getCompanion());
      }
      if (payload.reaction !== undefined) {
        setReaction(payload.reaction);
        setReactionStartedAt(Date.now());
        setLastInteractionAt(Date.now());
      }
      if (payload.petAt !== undefined) {
        setPetAt(payload.petAt);
        setLastInteractionAt(Date.now());
      }
    }),
  );

  // ─── 派生状态 ─────────────────────────────────────────────

  const muted = createMemo(() => isCompanionMuted());

  const isPetting = createMemo(() => {
    const t = petAt();
    return t !== undefined && Date.now() - t < PET_BURST_MS;
  });

  const isSleeping = createMemo(() => !isPetting() && Date.now() - lastInteractionAt() >= SLEEP_TIMEOUT_MS);

  const petFrame = createMemo(() => PET_SEQUENCE[tick() % PET_SEQUENCE.length] ?? 0);

  const frameLines = createMemo(() => {
    const c = companion();
    if (!c) return [];
    const frameCount = spriteFrameCount(c.species);
    if (isPetting()) {
      return renderPetSprite({ ...c, eye: c.eye === "✦" ? "◉" : "✦" }, petFrame() % frameCount);
    }
    if (isSleeping()) {
      return renderSleepSprite(c, tick());
    }
    const sequenceFrame = IDLE_SEQUENCE[tick() % IDLE_SEQUENCE.length] ?? 0;
    if (sequenceFrame === -1) {
      return renderSprite({ ...c, eye: "-" }, 0);
    }
    return renderSprite(c, sequenceFrame % frameCount);
  });

  const companionColor = createMemo(() => {
    const c = companion();
    if (!c) return "#b0b0b0";
    return c.shiny ? "#ffd700" : speciesColorHex(c.species);
  });

  // ─── 对话气泡 ─────────────────────────────────────────────

  const visibleReaction = createMemo(() => {
    const r = reaction();
    if (!r) return undefined;
    const age = Math.floor((Date.now() - reactionStartedAt()) / TICK_MS);
    return age < BUBBLE_SHOW ? r : undefined;
  });

  const fade = createMemo(() => {
    const r = visibleReaction();
    if (!r) return false;
    const age = Math.floor((Date.now() - reactionStartedAt()) / TICK_MS);
    return age >= BUBBLE_SHOW - FADE_WINDOW;
  });

  // ─── 渲染 ─────────────────────────────────────────────────

  const c = companion();
  if (!c || muted()) return null;

  if (props.terminalColumns < MIN_COLS_FOR_FULL_SPRITE) {
    // 窄终端：仅显示 face
    return (
      <box marginLeft={1}>
        <text fg={isPetting() ? "#ffd700" : companionColor()}>
          {isSleeping() ? renderSleepFace(c, tick()) : renderFace(isPetting() ? { ...c, eye: "✦" } : c)}
        </text>
      </box>
    );
  }

  // 完整精灵 + 对话框
  const reserved = companionReservedColumns(props.terminalColumns, false);
  const dialogueMaxWidth = Math.min(DIALOGUE_MAX_WIDTH, props.terminalColumns - reserved - 4);
  const dialogueLines =
    visibleReaction() && dialogueMaxWidth >= 20 ? renderDialogueBox(visibleReaction()!, dialogueMaxWidth) : [];
  const spriteWidth = Math.max(maxLineWidth(frameLines()), visualWidth(c.name));

  return (
    <box width="100%" justifyContent="flex-end">
      <box flexDirection="row" alignItems="flex-end" flexShrink={0}>
        <Show when={dialogueLines.length > 0}>
          <box flexDirection="column" marginRight={2} flexShrink={0}>
            <For each={dialogueLines}>{(line) => <text fg={fade() ? "#6e7681" : "#17a2b8"}>{line}</text>}</For>
          </box>
        </Show>
        <box flexDirection="column" width={reserved} flexShrink={0}>
          <box flexDirection="column">
            <For each={frameLines()}>
              {(line) => <text fg={isPetting() ? "#ffd700" : companionColor()}>{line}</text>}
            </For>
          </box>
          <box width={spriteWidth} justifyContent="center">
            <text fg="#6e7681">{c.name}</text>
          </box>
        </box>
      </box>
    </box>
  );
}

// ─── CompanionFloatingBubble 组件 ─────────────────────────────

export function CompanionFloatingBubble() {
  const [reaction, setReaction] = createSignal<string | undefined>(undefined);

  onCleanup(
    companionEvents.onChange((payload: CompanionEventPayload) => {
      if (payload.reaction !== undefined) {
        setReaction(payload.reaction);
      }
    }),
  );

  const companion = getCompanion();
  const bubbleText = reaction();
  if (!companion || !bubbleText || isCompanionMuted()) return null;

  return (
    <box>
      <text fg="#17a2b8">{`${companion.name}: ${bubbleText}`}</text>
    </box>
  );
}
