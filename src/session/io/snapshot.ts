/**
 * 会话快照管理 — 创建/恢复/对比会话快照。
 *
 * 职责:
 *   - 创建会话快照(消息状态的完整副本或增量 diff)
 *   - 列出/恢复/删除快照
 *   - 对比两个快照的差异
 *
 * 模块功能:
 *   - createSnapshot:创建会话快照
 *   - listSnapshots:列出会话的所有快照
 *   - restoreSnapshot:恢复快照
 *   - deleteSnapshot:删除快照
 *   - compareSnapshots:对比两个快照的差异
 *
 * 使用场景:
 *   - 保存会话状态快照
 *   - 回滚到历史状态
 *   - 比较不同版本差异
 *
 * 边界:
 *   1. 快照存储在 ~/.crab/snapshots/ 目录
 *   2. 快照包含消息的完整副本(full)或增量 diff(incremental)
 *   3. 支持 JSON 格式存储
 *   4. 自动创建目录
 *   5. 增量快照依赖 baseSnapshot；base 缺失时 restoreSnapshot 返回 null
 *
 * 流程:
 *   1. 调用 createSnapshot 创建快照
 *   2. 使用 listSnapshots 查看快照列表
 *   3. 调用 restoreSnapshot 恢复快照
 *   4. 使用 deleteSnapshot 删除快照
 */
import path from "node:path";
import fs from "node:fs/promises";
import { getDataDir } from "@/config";
import { createLogger } from "@/core/logging/logger";
import type { MessageRecord, MessageRole } from "../core/message";
import { createId } from "@/core/identity";
import { extractPlainText } from "../adapter";

const log = createLogger("session:snapshot");

export type SnapshotMode = "full" | "incremental";

export interface SnapshotMeta {
  id: string;
  sessionId: string;
  label: string;
  createdAt: number;
  messageCount: number;
  mode?: SnapshotMode;
  baseSnapshotId?: string;
}

export interface Snapshot extends SnapshotMeta {
  messages: MessageRecord[];
}

type SnapshotMessageInput = MessageRecord | { role: string; content: string; timestamp: number };

export interface CreateSnapshotOptions {
  baseSnapshotId?: string;
}

function getSnapshotsDir(): string {
  return path.join(getDataDir(), "snapshots");
}

import { prefixedId } from "@/core/id";

/** 快照 ID 生成 */
function generateSnapshotId(): string {
  return prefixedId("snap");
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(getSnapshotsDir(), { recursive: true });
}

/**
 * 将消息列表按 id 索引为 Map，便于按 id 维度的增删改查对比。
 * 重复 id 取首次出现(写入层保证唯一)。
 */
function indexById(messages: MessageRecord[]): Map<string, MessageRecord> {
  const map = new Map<string, MessageRecord>();
  for (const m of messages) {
    if (!map.has(m.id)) {
      map.set(m.id, m);
    }
  }
  return map;
}

/** 创建快照 */
export async function createSnapshot(
  sessionId: string,
  messages: SnapshotMessageInput[],
  label?: string,
  options?: CreateSnapshotOptions,
): Promise<Snapshot> {
  await ensureDir();
  const id = generateSnapshotId();
  const normalized = messages.map((message, index) => {
    if ("parts" in message) {
      return message;
    }

    return {
      createdAt: message.timestamp ?? Date.now() + index,
      id: createId("msg"),
      parts: [{ content: message.content, type: "text" }],
      role: message.role as MessageRole,
      sessionId,
    } satisfies MessageRecord;
  });
  const createdAt = Date.now();
  const baseSnapshotId = options?.baseSnapshotId;

  // Full 模式(无 baseSnapshotId): 维持原行为，整对象序列化写盘
  if (!baseSnapshotId) {
    const snapshot: Snapshot = {
      createdAt,
      id,
      label: label ?? `快照 ${new Date(createdAt).toLocaleString("zh-CN")}`,
      messageCount: normalized.length,
      messages: structuredClone(normalized),
      mode: "full",
      sessionId,
    };

    const filePath = path.join(getSnapshotsDir(), `${id}.json`);
    await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), "utf8");
    log.info(`快照已创建: ${id} (full, ${messages.length} 条消息)`);
    return snapshot;
  }

  // Incremental 模式: 写盘仅含 added + changed 消息的子集
  const base = await readSnapshotFile(baseSnapshotId);
  if (!base) {
    log.warn(`增量快照基链断裂: baseSnapshotId=${baseSnapshotId} 不可读`);
  }
  const baseMessages = base?.messages ?? [];
  const baseMap = indexById(baseMessages);

  const patch: MessageRecord[] = [];
  for (const m of normalized) {
    const prev = baseMap.get(m.id);
    if (!prev || prev.role !== m.role || extractPlainText(prev.parts) !== extractPlainText(m.parts)) {
      patch.push(structuredClone(m));
    }
  }

  const snapshot: Snapshot = {
    baseSnapshotId,
    createdAt,
    id,
    label: label ?? `快照 ${new Date(createdAt).toLocaleString("zh-CN")}`,
    messageCount: normalized.length,
    messages: patch,
    mode: "incremental",
    sessionId,
  };

  const filePath = path.join(getSnapshotsDir(), `${id}.json`);
  await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), "utf8");
  log.info(`快照已创建: ${id} (incremental, base=${baseSnapshotId}, ${patch.length}/${normalized.length} 写入)`);
  return snapshot;
}

/** 列出某个会话的所有快照 */
export async function listSnapshots(sessionId?: string): Promise<SnapshotMeta[]> {
  const dir = getSnapshotsDir();
  try {
    await fs.access(dir);
  } catch {
    return [];
  }

  const files = await fs.readdir(dir);
  const results: SnapshotMeta[] = [];

  for (const file of files) {
    if (!file.endsWith(".json")) {
      continue;
    }
    const filePath = path.join(dir, file);
    const content = await fs.readFile(filePath, "utf8");
    const snap = JSON.parse(content) as Snapshot;
    if (sessionId && snap.sessionId !== sessionId) {
      continue;
    }
    results.push({
      baseSnapshotId: snap.baseSnapshotId,
      createdAt: snap.createdAt,
      id: snap.id,
      label: snap.label,
      messageCount: snap.messageCount,
      mode: snap.mode,
      sessionId: snap.sessionId,
    });
  }

  return results.toSorted((a, b) => b.createdAt - a.createdAt);
}

/** 读取快照文件原始内容(不递归展开) */
async function readSnapshotFile(snapshotId: string): Promise<Snapshot | null> {
  const filePath = path.join(getSnapshotsDir(), `${snapshotId}.json`);
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content) as Snapshot;
  } catch {
    return null;
  }
}

/** 恢复快照 */
export async function restoreSnapshot(snapshotId: string): Promise<Snapshot | null> {
  const snap = await readSnapshotFile(snapshotId);
  if (!snap) {
    return null;
  }

  // 向后兼容:旧 .json 无 mode 字段视为 full
  const mode: SnapshotMode = snap.mode ?? "full";

  if (mode === "incremental" && snap.baseSnapshotId) {
    const base = await readSnapshotFile(snap.baseSnapshotId);
    if (!base) {
      log.warn(`快照恢复失败: 增量快照 ${snapshotId} 的 baseSnapshotId=${snap.baseSnapshotId} 不可读`);
      return null;
    }
    // 递归展开 base(base 自身也可能是 incremental)
    const baseResolved = await resolveSnapshotChain(base);
    const merged = applyPatch(baseResolved.messages, snap.messages);
    const result: Snapshot = {
      baseSnapshotId: snap.baseSnapshotId,
      createdAt: snap.createdAt,
      id: snap.id,
      label: snap.label,
      messageCount: snap.messageCount,
      messages: merged,
      mode: "incremental",
      sessionId: snap.sessionId,
    };
    return result;
  }

  return snap;
}

/** 递归将增量基链解析为完整消息列表 */
async function resolveSnapshotChain(snap: Snapshot): Promise<Snapshot> {
  const mode: SnapshotMode = snap.mode ?? "full";
  if (mode === "incremental" && snap.baseSnapshotId) {
    const base = await readSnapshotFile(snap.baseSnapshotId);
    if (!base) {
      log.warn(`增量基链断裂: ${snap.id} 引用 baseSnapshotId=${snap.baseSnapshotId} 不可读`);
      return snap;
    }
    const resolvedBase = await resolveSnapshotChain(base);
    return {
      ...snap,
      messages: applyPatch(resolvedBase.messages, snap.messages),
    };
  }
  return snap;
}

/** 将 patch 消息按 id 覆盖到 base，返回合并后的有序列表 */
function applyPatch(base: MessageRecord[], patch: MessageRecord[]): MessageRecord[] {
  const map = indexById(base);
  for (const m of patch) {
    map.set(m.id, m);
  }
  return [...map.values()];
}

/** 删除快照 */
export async function deleteSnapshot(snapshotId: string): Promise<boolean> {
  const filePath = path.join(getSnapshotsDir(), `${snapshotId}.json`);
  try {
    await fs.unlink(filePath);
    log.info(`快照已删除: ${snapshotId}`);
    return true;
  } catch {
    return false;
  }
}

/** 对比两个快照 */
export async function diffSnapshots(
  snapshotIdA: string,
  snapshotIdB: string,
): Promise<{ added: number; removed: number; changed: number; changedIds: string[] } | null> {
  const snapA = await restoreSnapshot(snapshotIdA);
  const snapB = await restoreSnapshot(snapshotIdB);
  if (!snapA || !snapB) {
    return null;
  }

  const mapA = indexById(snapA.messages);
  const mapB = indexById(snapB.messages);

  let added = 0;
  let removed = 0;
  let changed = 0;
  const changedIds: string[] = [];

  for (const [id, msgB] of mapB.entries()) {
    const msgA = mapA.get(id);
    if (!msgA) {
      added++;
      continue;
    }
    if (msgA.role !== msgB.role || extractPlainText(msgA.parts) !== extractPlainText(msgB.parts)) {
      changed++;
      changedIds.push(id);
    }
  }
  for (const id of mapA.keys()) {
    if (!mapB.has(id)) {
      removed++;
    }
  }

  return { added, changed, changedIds, removed };
}
