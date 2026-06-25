/**
 * Buddy/Pet 宠物伴侣系统 — Companion 生成、持久化、CRUD
 *
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { Companion, CompanionBones, CompanionStats, Rarity, Species, StoredCompanion } from "./types";
import { COMPANION_STATS, EYES, HATS, SPECIES } from "./types";

// ─── 常量 ──────────────────────────────────────────────────────

const SALT = "crab-cli-buddy-v1";
const BUDDY_STATE_VERSION = 1;
const CONFIG_DIR = join(homedir(), ".crab");
const BUDDY_STATE_FILE = join(CONFIG_DIR, "buddy.json");

interface BuddyState {
  version: number;
  companion?: StoredCompanion;
  muted?: boolean;
  aiProfile?: string;
}

const RARITY_WEIGHTS: Array<[Rarity, number]> = [
  ["common", 60],
  ["uncommon", 25],
  ["rare", 10],
  ["epic", 4],
  ["legendary", 1],
];

const DEFAULT_NAMES = [
  "Pebble",
  "Noodle",
  "Pixel",
  "Mochi",
  "Biscuit",
  "Waffle",
  "Pip",
  "Tofu",
  "Bean",
  "Juniper",
  "Sprout",
  "Orbit",
];

const DEFAULT_PERSONALITIES = [
  "curious, loyal, and gently chaotic",
  "patient, observant, and fond of tiny victories",
  "snarky in a warm way, especially around bugs",
  "calm under pressure and suspicious of flaky tests",
  "playful, brave, and easily impressed by good refactors",
  "quietly wise and very interested in terminal output",
];

// ─── PRNG ──────────────────────────────────────────────────────

export function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// ─── 内部工具函数 ────────────────────────────────────────────

function ensureBuddyDirectory(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function roll<T>(items: T[], random: () => number): T {
  return items[Math.floor(random() * items.length)] ?? items[0]!;
}

function rollRarity(random: () => number): Rarity {
  const total = RARITY_WEIGHTS.reduce((sum, [, weight]) => sum + weight, 0);
  let cursor = random() * total;
  for (const [rarity, weight] of RARITY_WEIGHTS) {
    cursor -= weight;
    if (cursor <= 0) {
      return rarity;
    }
  }
  return "common";
}

function rollStats(random: () => number): CompanionStats {
  return COMPANION_STATS.reduce((stats, stat) => {
    stats[stat] = 1 + Math.floor(random() * 10);
    return stats;
  }, {} as CompanionStats);
}

// ─── 验证函数 ────────────────────────────────────────────────

function isValidRarity(value: unknown): value is Rarity {
  return value === "common" || value === "uncommon" || value === "rare" || value === "epic" || value === "legendary";
}

function isValidSpecies(value: unknown): value is Species {
  return typeof value === "string" && SPECIES.includes(value as Species);
}

function isValidEye(value: unknown): boolean {
  return typeof value === "string" && (EYES as readonly string[]).includes(value as string);
}

function isValidHat(value: unknown): boolean {
  return typeof value === "string" && (HATS as readonly string[]).includes(value as string);
}

function isValidStats(value: unknown): value is CompanionStats {
  if (!value || typeof value !== "object") {
    return false;
  }
  const stats = value as Partial<Record<keyof CompanionStats, unknown>>;
  return COMPANION_STATS.every((stat) => typeof stats[stat] === "number");
}

function isStoredCompanion(value: unknown): value is StoredCompanion {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<StoredCompanion>;
  return (
    typeof candidate.name === "string" &&
    typeof candidate.personality === "string" &&
    typeof candidate.hatchedAt === "number" &&
    isValidRarity(candidate.rarity) &&
    isValidSpecies(candidate.species) &&
    isValidEye(candidate.eye) &&
    isValidHat(candidate.hat) &&
    typeof candidate.shiny === "boolean" &&
    isValidStats(candidate.stats)
  );
}

// ─── 状态文件读写 ──────────────────────────────────────────────

function readBuddyStateFile(): BuddyState {
  ensureBuddyDirectory();
  if (!existsSync(BUDDY_STATE_FILE)) {
    return { version: BUDDY_STATE_VERSION };
  }
  try {
    const parsed = JSON.parse(readFileSync(BUDDY_STATE_FILE, "utf8")) as Partial<BuddyState>;
    const aiProfile =
      typeof parsed.aiProfile === "string" && parsed.aiProfile.trim() ? parsed.aiProfile.trim() : undefined;
    return {
      version: parsed.version ?? BUDDY_STATE_VERSION,
      companion: isStoredCompanion(parsed.companion) ? parsed.companion : undefined,
      muted: Boolean(parsed.muted),
      aiProfile,
    };
  } catch {
    return { version: BUDDY_STATE_VERSION };
  }
}

function writeBuddyStateFile(state: BuddyState): void {
  ensureBuddyDirectory();
  writeFileSync(BUDDY_STATE_FILE, JSON.stringify({ ...state, version: BUDDY_STATE_VERSION }, null, 2), "utf8");
}

// ─── 公开 API ──────────────────────────────────────────────────

/** 获取用于 Companion 生成种子化的用户标识 */
export function companionUserId(): string {
  return process.env["CRAB_USER_ID"] || process.env["USERNAME"] || process.env["USER"] || "anon";
}

/** 使用种子确定性生成 CompanionBones（不含 name/personality） */
export function rollWithSeed(seed: string): CompanionBones {
  const random = mulberry32(hashString(`${SALT}:${seed}`));
  const rarity = rollRarity(random);
  return {
    rarity,
    species: roll(SPECIES, random),
    eye: roll(EYES, random),
    hat: rarity === "common" && random() < 0.75 ? "none" : roll(HATS, random),
    shiny: random() < (rarity === "legendary" ? 0.12 : 0.025),
    stats: rollStats(random),
  };
}

/** 创建默认 Companion（含 name + personality） */
export function createDefaultCompanion(species?: Species): StoredCompanion {
  const hatchedAt = Date.now();
  const seed = `${companionUserId()}:${hatchedAt}:${randomUUID()}`;
  const random = mulberry32(hashString(`${SALT}:soul:${seed}`));
  const bones = rollWithSeed(seed);
  return {
    ...bones,
    species: species ?? bones.species,
    name: roll(DEFAULT_NAMES, random),
    personality: roll(DEFAULT_PERSONALITIES, random),
    hatchedAt,
  };
}

/** 获取持久化的 Companion */
export function getStoredCompanion(): StoredCompanion | undefined {
  return readBuddyStateFile().companion;
}

/** 获取 Companion（同 getStoredCompanion） */
export function getCompanion(): Companion | undefined {
  return getStoredCompanion();
}

/** 是否静音 */
export function isCompanionMuted(): boolean {
  return Boolean(readBuddyStateFile().muted);
}

/** 获取 AI Profile 名 */
export function getBuddyAiProfile(): string | undefined {
  return readBuddyStateFile().aiProfile;
}

/** 设置 AI Profile */
export function setBuddyAiProfile(profileName: string | undefined): void {
  const state = readBuddyStateFile();
  const trimmedProfileName = profileName?.trim();
  if (trimmedProfileName) {
    state.aiProfile = trimmedProfileName;
  } else {
    delete state.aiProfile;
  }
  writeBuddyStateFile(state);
}

/** 保存 Companion */
export function saveCompanion(companion: StoredCompanion | undefined): void {
  const state = readBuddyStateFile();
  if (companion) {
    state.companion = companion;
  } else {
    delete state.companion;
  }
  writeBuddyStateFile(state);
}

/** 设置静音 */
export function setCompanionMuted(muted: boolean): void {
  const state = readBuddyStateFile();
  state.muted = muted;
  writeBuddyStateFile(state);
}

/** 孵化新 Companion */
export function hatchCompanion(name?: string, personality?: string, species?: Species): Companion {
  const stored = createDefaultCompanion(species);
  const trimmedName = name?.trim();
  const trimmedPersonality = personality?.trim();
  const finalStored: StoredCompanion = {
    ...stored,
    name: trimmedName || stored.name,
    personality: trimmedPersonality || stored.personality,
  };
  saveCompanion(finalStored);
  return finalStored;
}

/** 重命名 Companion */
export function renameCompanion(name: string): Companion | undefined {
  const companion = getStoredCompanion();
  const trimmedName = name.trim();
  if (!companion || !trimmedName) {
    return companion;
  }
  const renamedCompanion: StoredCompanion = { ...companion, name: trimmedName };
  saveCompanion(renamedCompanion);
  return renamedCompanion;
}

/** 重置 Companion（删除） */
export function resetCompanion(): void {
  saveCompanion(undefined);
}
