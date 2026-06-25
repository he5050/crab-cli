/**
 * FirstRunState 守卫测试 [P2-21]
 *
 * 覆盖:
 *   - 文件不存在 → readFirstRunState 返回 { dismissed: false }
 *   - markDismissed 写入后 → readFirstRunState 返回 dismissed=true
 *   - dismissed 后 shape 包含 ISO 时间戳
 *   - markDismissed 幂等(连续两次写入产生等价最终态)
 *   - markDismissed 自动创建父目录
 *   - 文件内容是稳定的 JSON 形态
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { markDismissed, readFirstRunState, readFirstRunStateSync } from "@/ui/utils/firstRunState";

/** 创建唯一临时目录作为 baseDir；测试结束后自动清理 */
function makeTempBaseDir(): string {
  const dir = path.join(os.tmpdir(), `crab-test-firstrun-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fsSync.mkdirSync(dir, { recursive: true });
  return dir;
}

let baseDir: string;

beforeEach(() => {
  baseDir = makeTempBaseDir();
});

afterEach(async () => {
  await fs.rm(baseDir, { force: true, recursive: true }).catch(() => {});
});

describe("firstRunState.readFirstRunState", () => {
  test("文件不存在时返回 { dismissed: false }", async () => {
    const state = await readFirstRunState(baseDir);
    expect(state.dismissed).toBe(false);
  });

  test("markDismissed 写入后 readFirstRunState 返回 { dismissed: true }", async () => {
    await markDismissed(baseDir);
    const state = await readFirstRunState(baseDir);
    expect(state.dismissed).toBe(true);
  });

  test("dismissed 后 shape 包含 ISO 8601 时间戳", async () => {
    await markDismissed(baseDir);
    const state = await readFirstRunState(baseDir);
    expect(state.dismissedAt).toBeDefined();
    expect(typeof state.dismissedAt).toBe("string");
    // ISO 8601 形态:YYYY-MM-DDTHH:mm:ss.sssZ
    expect(state.dismissedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe("firstRunState.markDismissed", () => {
  test("幂等:连续两次写入产生等价最终态", async () => {
    await markDismissed(baseDir);
    const first = await readFirstRunState(baseDir);
    // 等一拍确保时间戳可能不同
    await new Promise((r) => setTimeout(r, 5));
    await markDismissed(baseDir);
    const second = await readFirstRunState(baseDir);

    expect(first.dismissed).toBe(true);
    expect(second.dismissed).toBe(true);
    // 两次都应包含 ISO 时间戳
    expect(first.dismissedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(second.dismissedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("父目录不存在时自动创建", async () => {
    const nestedBase = path.join(baseDir, "deep", "nested", "dir");
    expect(fsSync.existsSync(nestedBase)).toBe(false);
    await markDismissed(nestedBase);
    expect(fsSync.existsSync(nestedBase)).toBe(true);
    const state = await readFirstRunState(nestedBase);
    expect(state.dismissed).toBe(true);
  });

  test("写入内容是稳定 JSON 形态", async () => {
    await markDismissed(baseDir);
    const file = path.join(baseDir, "firstRun.json");
    const content = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(content);
    expect(parsed.dismissed).toBe(true);
    expect(typeof parsed.dismissedAt).toBe("string");
  });
});

describe("firstRunState.readFirstRunStateSync", () => {
  test("文件不存在时返回 { dismissed: false }", () => {
    const state = readFirstRunStateSync(baseDir);
    expect(state.dismissed).toBe(false);
  });

  test("写入后同步读取返回 dismissed=true", async () => {
    await markDismissed(baseDir);
    const state = readFirstRunStateSync(baseDir);
    expect(state.dismissed).toBe(true);
    expect(state.dismissedAt).toBeDefined();
  });

  test("JSON 损坏时降级返回 { dismissed: false }", () => {
    const file = path.join(baseDir, "firstRun.json");
    fsSync.writeFileSync(file, "{ this is not valid json", "utf8");
    const state = readFirstRunStateSync(baseDir);
    expect(state.dismissed).toBe(false);
  });
});
