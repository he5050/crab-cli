/**
 * PromptHistory 持久化守卫测试 [P2-23]
 *
 * 覆盖 usePromptHistory Hook 的核心行为:
 *   - 挂载时从 ~/.crab/prompt-history.jsonl 加载历史
 *   - push():去重、空/纯空白拒绝、JSONL 追加
 *   - MAX_HISTORY=50:超出上限仅保留最后 50 条
 *   - move(-1/+1):上下浏览历史，savedInput 暂存与恢复
 *   - JSONL 损坏自修复:跳过坏行 / 重写文件
 *
 * 测试策略:备份并恢复 ~/.crab/prompt-history.jsonl；不修改实现文件。
 * 文件路径在实现中硬编码为 os.homedir() + "/.crab/prompt-history.jsonl"。
 *
 * Solid 时序说明:onMount 在 createRoot 内是异步触发的(微任务)，
 * 因此"读取 onMount 后的 history"必须 yield 一次。withHookMounted 包装了
 * 双重 queueMicrotask 等待 microtask flush；withHook 仍然用于纯 push/move 测试，
 * 这些路径不依赖 onMount。
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createRoot } from "solid-js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { type HistoryEntry, usePromptHistory } from "@/ui/components/prompt/history";

// ─── 测试夹具:备份/恢复 ~/.crab/prompt-history.jsonl ───────────

const HOME = os.homedir();
const CRAB_DIR = path.join(HOME, ".crab");
const HISTORY_FILE = path.join(CRAB_DIR, "prompt-history.jsonl");
const BACKUP_FILE = path.join(
  os.tmpdir(),
  `crab-test-prompt-history-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.bak`,
);

let backupExisted = false;
let backupContent = "";

beforeAll(() => {
  fs.mkdirSync(CRAB_DIR, { recursive: true });
  if (fs.existsSync(HISTORY_FILE)) {
    backupExisted = true;
    backupContent = fs.readFileSync(HISTORY_FILE, "utf8");
    fs.copyFileSync(HISTORY_FILE, BACKUP_FILE);
  }
});

afterAll(() => {
  if (backupExisted) {
    fs.writeFileSync(HISTORY_FILE, backupContent, "utf8");
    try {
      fs.unlinkSync(BACKUP_FILE);
    } catch {
      /* Ignore */
    }
  } else {
    try {
      fs.unlinkSync(HISTORY_FILE);
    } catch {
      /* Ignore */
    }
  }
});

function clearHistoryFile() {
  try {
    fs.unlinkSync(HISTORY_FILE);
  } catch {
    /* Ignore */
  }
}

function readHistoryFileLines(): string[] {
  if (!fs.existsSync(HISTORY_FILE)) {
    return [];
  }
  return fs.readFileSync(HISTORY_FILE, "utf8").split("\n").filter(Boolean);
}

/** 同步运行 hook(用于纯 push/move 测试，不依赖 onMount)。 */
function withHook<T>(fn: (h: ReturnType<typeof usePromptHistory>) => T): T {
  return createRoot((dispose) => {
    const hook = usePromptHistory();
    try {
      return fn(hook);
    } finally {
      dispose();
    }
  });
}

/**
 * 等待 onMount 触发后再取数据。Solid 的 onMount 在 createRoot 内通过
 * 微任务异步调度，因此我们 yield 两次微任务确保 onMount 已执行。
 * 使用 queueMicrotask 而非 setTimeout(0) 以获得确定性时序。
 */
function withHookMounted<T>(fn: (h: ReturnType<typeof usePromptHistory>) => T): Promise<T> {
  return new Promise((resolve, reject) => {
    createRoot((dispose) => {
      const h = usePromptHistory();
      // 双 microtask flush:确保 Solid 的 onMount 调度链已跑完
      queueMicrotask(() => {
        queueMicrotask(() => {
          try {
            resolve(fn(h));
          } catch (error) {
            reject(error);
          } finally {
            dispose();
          }
        });
      });
    });
  });
}

// ─── 测试 ─────────────────────────────────────────────────────

describe("usePromptHistory — onMount 加载", () => {
  beforeEach(clearHistoryFile);
  afterEach(clearHistoryFile);

  test("文件不存在时 history 为空数组", async () => {
    const result = await withHookMounted((h) => h.history());
    expect(result).toEqual([]);
  });

  test("预填充 3 条 → history 加载正确", async () => {
    const entries: HistoryEntry[] = [
      { input: "first", timestamp: 1000 },
      { input: "second", timestamp: 2000 },
      { input: "third", timestamp: 3000 },
    ];
    fs.writeFileSync(HISTORY_FILE, `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`, "utf8");

    const result = await withHookMounted((h) => h.history());
    expect(result).toHaveLength(3);
    expect(result[0]?.input).toBe("first");
    expect(result[1]?.input).toBe("second");
    expect(result[2]?.input).toBe("third");
  });

  test("加载时自我修复:JSONL 含一行损坏 → 跳过坏行、保留有效行", async () => {
    const valid1 = JSON.stringify({ input: "good-1", timestamp: 1 });
    const valid2 = JSON.stringify({ input: "good-2", timestamp: 2 });
    const corrupt = "{ this is not valid json";
    const content = `${valid1}\n${corrupt}\n${valid2}\n`;
    fs.writeFileSync(HISTORY_FILE, content, "utf8");

    const result = await withHookMounted((h) => h.history());
    expect(result).toHaveLength(2);
    expect(result[0]?.input).toBe("good-1");
    expect(result[1]?.input).toBe("good-2");
    // Self-heal:文件被重写为仅含有效行
    const lines = readHistoryFileLines();
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? "{}").input).toBe("good-1");
    expect(JSON.parse(lines[1] ?? "{}").input).toBe("good-2");
  });

  test("加载时自我修复:全部行损坏 → 降级为空数组(不抛错)", async () => {
    fs.writeFileSync(HISTORY_FILE, "garbage1\ngarbage2\n{nope\n", "utf8");

    const result = await withHookMounted((h) => h.history());
    expect(result).toEqual([]);
    // Self-heal 仅在 lines.length > 0 时触发；全坏时不重写，避免覆盖用户文件
    const lines = readHistoryFileLines();
    expect(lines.length).toBeGreaterThan(0); // 原文件保留
  });
});

describe("usePromptHistory — 推送()", () => {
  beforeEach(clearHistoryFile);
  afterEach(clearHistoryFile);

  test("push 后 history 增长，文件追加新行(JSONL 形态)", () => {
    withHook((h) => {
      h.push("hello");
      const hist = h.history();
      expect(hist).toHaveLength(1);
      expect(hist[0]?.input).toBe("hello");
      expect(typeof hist[0]?.timestamp).toBe("number");

      const lines = readHistoryFileLines();
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0] ?? "{}");
      expect(parsed.input).toBe("hello");
      expect(typeof parsed.timestamp).toBe("number");
    });
  });

  test('push("") 和 push("   ") 均为 no-op(空/纯空白拒绝)', () => {
    withHook((h) => {
      h.push("");
      h.push("   ");
      h.push("\t\n  ");
      expect(h.history()).toEqual([]);
      expect(readHistoryFileLines()).toEqual([]);
    });
  });

  test("连续 push 相同内容 → 仅保留一条(去重)", () => {
    withHook((h) => {
      h.push("duplicate");
      h.push("duplicate");
      h.push("duplicate");
      expect(h.history()).toHaveLength(1);
      expect(readHistoryFileLines()).toHaveLength(1);
    });
  });

  test("不同内容 push → 全部记录", () => {
    withHook((h) => {
      h.push("alpha");
      h.push("beta");
      h.push("gamma");
      const hist = h.history();
      expect(hist.map((e) => e.input)).toEqual(["alpha", "beta", "gamma"]);
      expect(readHistoryFileLines()).toHaveLength(3);
    });
  });

  test("push 会自动 trim(前后空白不计入 history)", () => {
    withHook((h) => {
      h.push("  spaced  ");
      const hist = h.history();
      expect(hist[0]?.input).toBe("spaced");
    });
  });

  test("MAX_HISTORY=50:第 51 次 push 后仅保留最后 50 条", () => {
    withHook((h) => {
      for (let i = 1; i <= 51; i++) {
        h.push(`entry-${i}`);
      }
      const hist = h.history();
      expect(hist).toHaveLength(50);
      // 最旧的 entry-1 被淘汰，最新的 entry-51 在尾部
      expect(hist[0]?.input).toBe("entry-2");
      expect(hist[49]?.input).toBe("entry-51");
    });
  });
});

describe("usePromptHistory — move() 与 savedInput", () => {
  beforeEach(clearHistoryFile);
  afterEach(clearHistoryFile);

  test("空 history 上 move(-1) → 返回 undefined", () => {
    const r = withHook((h) => h.move(-1, ""));
    expect(r).toBeUndefined();
  });

  test("move(-1) 保存当前输入，连续 move(+1) 走回顶部时恢复 savedInput", () => {
    withHook((h) => {
      h.push("cmd-a");
      h.push("cmd-b");
      // Index=0 → move(-1):保存 "draft"，返回最新条目 cmd-b
      const first = h.move(-1, "draft");
      expect(first).toBe("cmd-b");
      // Index=-1 → move(-1):进入更老条目 cmd-a(仍记录 savedInput 一次)
      const second = h.move(-1, "draft");
      expect(second).toBe("cmd-a");
      // Index=-2 → move(+1):回到 -1，返回 cmd-b(不重置 savedInput)
      const back1 = h.move(1, "draft");
      expect(back1).toBe("cmd-b");
      // Index=-1 → move(+1):回到 0，返回 savedInput
      const back2 = h.move(1, "draft");
      expect(back2).toBe("draft");
    });
  });

  test("move(+1) 在 index=0 时返回 undefined(不超过最新)", () => {
    withHook((h) => {
      h.push("only");
      const r = h.move(1, "anything");
      expect(r).toBeUndefined();
    });
  });

  test("move(+1) 从超出末尾的位置继续向下 → 仍返回 undefined(边界夹紧)", () => {
    withHook((h) => {
      h.push("cmd-a");
      h.push("cmd-b");
      // 向回走到最老:index 0 → -1 → -2
      expect(h.move(-1, "draft")).toBe("cmd-b");
      expect(h.move(-1, "draft")).toBe("cmd-a");
      // 再向前走 3 次:-2 → -1 → 0 → 1
      // 第三次 move(+1) 时 nextIdx=1 > 0，应返回 undefined
      expect(h.move(1, "draft")).toBe("cmd-b");
      expect(h.move(1, "draft")).toBe("draft");
      expect(h.move(1, "draft")).toBeUndefined();
    });
  });

  test("getSavedInput 返回最近一次 move(-1) 保存的内容", () => {
    withHook((h) => {
      h.push("x");
      expect(h.getSavedInput()).toBe(""); // 初始为空
      h.move(-1, "my-draft");
      expect(h.getSavedInput()).toBe("my-draft");
    });
  });

  test("reset() 清除 savedInput 并重置 index", () => {
    withHook((h) => {
      h.push("x");
      h.push("y");
      h.move(-1, "draft");
      expect(h.getSavedInput()).toBe("draft");
      h.reset();
      expect(h.getSavedInput()).toBe("");
      // Reset 后从 0 重新 move(-1) 应能再次保存
      h.move(-1, "new-draft");
      expect(h.getSavedInput()).toBe("new-draft");
    });
  });
});

describe("usePromptHistory — 跨实例持久化", () => {
  beforeEach(clearHistoryFile);
  afterEach(clearHistoryFile);

  test("第一个实例 push → 第二个实例 onMount 加载完整历史", async () => {
    withHook((h) => {
      h.push("persist-1");
      h.push("persist-2");
    });

    // 第二个实例:等待 onMount 完成后再读取
    const loaded = await withHookMounted((h) => h.history());
    expect(loaded).toHaveLength(2);
    expect(loaded[0]?.input).toBe("persist-1");
    expect(loaded[1]?.input).toBe("persist-2");
  });
});
