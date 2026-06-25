/**
 * UI 动画工具集 — 提供终端动画和视觉效果。
 *
 * 导出:
 *   - LoadingAnimation: 加载动画 (spinner/dots/bar)
 *   - TypewriterEffect: 打字机效果
 *   - renderProgressBar: 进度条渲染
 *   - PulseEffect: 脉冲效果
 *   - blink: 闪烁文本
 *   - gradient: 渐变文本
 *   - fadeIn: 淡入效果
 *   - Animations: 预设动画集合
 */

// ─── LoadingAnimation ─────────────────────────────────────────────

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const DOTS_FRAMES = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"];
const BAR_FRAMES = ["[=  ]", "[== ]", "[===]", "[ ==]", "[  =]", "[   ]"];

export interface LoadingAnimationOptions {
  prefix?: string;
  suffix?: string;
  interval?: number;
}

export class LoadingAnimation {
  private frames: string[];
  private index = 0;
  private prefix: string;
  private suffix: string;
  private interval: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(style: "spinner" | "dots" | "bar" = "spinner", options: LoadingAnimationOptions = {}) {
    switch (style) {
      case "dots":
        this.frames = DOTS_FRAMES;
        break;
      case "bar":
        this.frames = BAR_FRAMES;
        break;
      default:
        this.frames = SPINNER_FRAMES;
    }
    this.prefix = options.prefix ?? "";
    this.suffix = options.suffix ?? "";
    this.interval = options.interval ?? 80;
  }

  getCurrentFrame(): string {
    return `${this.prefix}${this.frames[this.index % this.frames.length]!}${this.suffix}`;
  }

  start(onTick: (frame: string) => void): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.index++;
      onTick(this.getCurrentFrame());
    }, this.interval);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

// ─── TypewriterEffect ─────────────────────────────────────────────

export class TypewriterEffect {
  private text: string;
  private index = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(text: string) {
    this.text = text;
  }

  getCurrentText(): string {
    return this.text.slice(0, this.index);
  }

  start(onUpdate: (text: string) => void, onComplete?: () => void): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.index++;
      onUpdate(this.getCurrentText());
      if (this.index >= this.text.length) {
        this.stop();
        onComplete?.();
      }
    }, 50);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  complete(): void {
    this.index = this.text.length;
    this.stop();
  }
}

// ─── renderProgressBar ────────────────────────────────────────────

export interface ProgressBarOptions {
  width?: number;
  showPercent?: boolean;
  fillChar?: string;
  emptyChar?: string;
  prefix?: string;
  suffix?: string;
}

export function renderProgressBar(progress: number, options: ProgressBarOptions = {}): string {
  const width = options.width ?? 20;
  const showPercent = options.showPercent ?? true;
  const fillChar = options.fillChar ?? "█";
  const emptyChar = options.emptyChar ?? "░";
  const prefix = options.prefix ?? "";
  const suffix = options.suffix ?? "";

  const clamped = Math.max(0, Math.min(1, progress));
  const filled = Math.round(clamped * width);
  const empty = width - filled;
  const percent = Math.round(clamped * 100);

  let bar = `${prefix}${fillChar.repeat(filled)}${emptyChar.repeat(empty)}`;
  if (showPercent) {
    bar += ` ${percent}%`;
  }
  bar += suffix;

  return bar;
}

// ─── PulseEffect ──────────────────────────────────────────────────

export class PulseEffect {
  private chars: string[];
  private index = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(chars: string[] = ["●", "○"]) {
    this.chars = chars;
  }

  getCurrentChar(): string {
    return this.chars[this.index % this.chars.length]!;
  }

  start(onTick: (char: string) => void): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.index++;
      onTick(this.getCurrentChar());
    }, 500);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

// ─── 文本效果函数 ─────────────────────────────────────────────────

/** 闪烁文本 */
export function blink(text: string, on: boolean): string {
  if (on) {
    return `\x1b[5m${text}\x1b[0m`;
  }
  return text;
}

/** 渐变文本 — 从 startColor 到 endColor 的 256 色渐变 */
export function gradient(text: string, startColor: number, endColor: number): string {
  if (text.length === 0) return "";
  const chars = text.split("");
  const range = endColor - startColor;
  const result = chars.map((char, i) => {
    const color = Math.round(startColor + (range * i) / Math.max(1, chars.length - 1));
    return `\x1b[38;5;${color}m${char}`;
  });
  return `${result.join("")}\x1b[0m`;
}

/** 淡入效果 — 根据强度返回不同亮度的文本 */
export function fadeIn(text: string, intensity: number): string {
  const clamped = Math.max(0, Math.min(1, intensity));
  if (clamped < 0.33) {
    return `\x1b[2m${text}\x1b[0m`;
  }
  if (clamped > 0.66) {
    return `\x1b[1m${text}\x1b[0m`;
  }
  return text;
}

// ─── Animations 预设 ──────────────────────────────────────────────

export const Animations = {
  thinking: () => new LoadingAnimation("spinner"),
  loading: () => new LoadingAnimation("dots"),
  processing: () => new LoadingAnimation("bar"),
  waiting: () => new PulseEffect(),
  success: ["✓", "done"],
  error: ["✗", "error"],
  warning: ["⚠", "warning"],
};
