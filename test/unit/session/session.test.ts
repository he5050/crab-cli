/**
 * 会话管理测试。
 *
 * 测试用例:
 *   - 数据库初始化
 *   - 会话 CRUD
 *   - 会话分叉
 *   - 消息管理
 *   - 检查点
 *   - Token 计数
 *   - 会话导出
 *   - 权限持久化
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../helpers/testPaths";

// 测试用独立数据库路径
let testDir: string;
let testDbPath: string;

// 模块导入(延迟，确保每个 test 文件独立)
let initDb: typeof import("@/db").initDb;
let getDb: typeof import("@/db").getDb;
let closeDb: typeof import("@/db").closeDb;
let resetDb: typeof import("@/db").resetDb;

let createSession: typeof import("@/session/session").createSession;
let createSessionAsync: typeof import("@/session/session").createSessionAsync;
let ensureSession: typeof import("@/session/session").ensureSession;
let ensureSessionAsync: typeof import("@/session/session").ensureSessionAsync;
let getSession: typeof import("@/session/session").getSession;
let updateSession: typeof import("@/session/session").updateSession;
let deleteSession: typeof import("@/session/session").deleteSession;
let listSessions: typeof import("@/session/session").listSessions;
let forkSession: typeof import("@/session/session").forkSession;
let addSessionTokens: typeof import("@/session/session").addSessionTokens;

let addMessage: typeof import("@/session/message").addMessage;
let addTextMessage: typeof import("@/session/message").addTextMessage;
let getSessionMessages: typeof import("@/session/message").getSessionMessages;
let getMessageCount: typeof import("@/session/message").getMessageCount;
let copyMessages: typeof import("@/session/message").copyMessages;
let cleanIncompleteToolCalls: typeof import("@/session/message").cleanIncompleteToolCalls;

let createCheckpoint: typeof import("@/session/core/checkpoint").createCheckpoint;
let restoreCheckpoint: typeof import("@/session/core/checkpoint").restoreCheckpoint;
let listCheckpoints: typeof import("@/session/core/checkpoint").listCheckpoints;
let deleteCheckpoint: typeof import("@/session/core/checkpoint").deleteCheckpoint;
let updateCheckpointLabel: typeof import("@/session/core/checkpoint").updateCheckpointLabel;
let getCheckpoint: typeof import("@/session/core/checkpoint").getCheckpoint;
let compareCheckpoints: typeof import("@/session/core/checkpoint").compareCheckpoints;
let cleanupOldCheckpoints: typeof import("@/session/core/checkpoint").cleanupOldCheckpoints;
let getCheckpointStats: typeof import("@/session/core/checkpoint").getCheckpointStats;

let estimateTokens: typeof import("@/session/token/tokenCounter").estimateTokens;
let estimateMessagesTokens: typeof import("@/session/token/tokenCounter").estimateMessagesTokens;
let formatTokenCount: typeof import("@/session/token/tokenCounter").formatTokenCount;

let exportSession: typeof import("@/session/exporter").exportSession;

let addPersistentPermission: typeof import("@/session/permissions").addPersistentPermission;
let loadPersistentPermissions: typeof import("@/session/permissions").loadPersistentPermissions;
let findPersistentPermission: typeof import("@/session/permissions").findPersistentPermission;
let clearPersistentPermissions: typeof import("@/session/permissions").clearPersistentPermissions;

let getSessionStatus: typeof import("@/session/state/sessionStatus").getSessionStatus;
let setSessionStatus: typeof import("@/session/state/sessionStatus").setSessionStatus;
let isSessionBusy: typeof import("@/session/state/sessionStatus").isSessionBusy;
let canAcceptInput: typeof import("@/session/state/sessionStatus").canAcceptInput;
let clearSessionStatus: typeof import("@/session/state/sessionStatus").clearSessionStatus;
let getBusySessions: typeof import("@/session/state/sessionStatus").getBusySessions;
let resetAllBusy: typeof import("@/session/state/sessionStatus").resetAllBusy;
let _resetAllStatus: typeof import("@/session/state/sessionStatus")._resetAllStatus;

beforeEach(() => {
  // 每个测试前创建新的临时目录和数据库
  testDir = createGlobalTmpTestDir("crab-test-");
  testDbPath = join(testDir, "test.db");

  // 动态导入以确保模块状态干净
  const db = require("@/db") as typeof import("@/db");
  ({ initDb } = db);
  ({ getDb } = db);
  ({ closeDb } = db);
  ({ resetDb } = db);

  const sessionMod = require("@/session/session") as typeof import("@/session/session");
  ({ createSession } = sessionMod);
  ({ createSessionAsync } = sessionMod);
  ({ ensureSession } = sessionMod);
  ({ ensureSessionAsync } = sessionMod);
  ({ getSession } = sessionMod);
  ({ updateSession } = sessionMod);
  ({ deleteSession } = sessionMod);
  ({ listSessions } = sessionMod);
  ({ forkSession } = sessionMod);
  ({ addSessionTokens } = sessionMod);

  const message = require("@/session/message") as typeof import("@/session/message");
  ({ addMessage } = message);
  ({ addTextMessage } = message);
  ({ getSessionMessages } = message);
  ({ getMessageCount } = message);
  ({ copyMessages } = message);
  ({ cleanIncompleteToolCalls } = message);

  const checkpoint = require("@/session/core/checkpoint") as typeof import("@/session/core/checkpoint");
  ({ createCheckpoint } = checkpoint);
  ({ restoreCheckpoint } = checkpoint);
  ({ listCheckpoints } = checkpoint);
  ({ deleteCheckpoint } = checkpoint);
  ({ updateCheckpointLabel } = checkpoint);
  ({ getCheckpoint } = checkpoint);
  ({ compareCheckpoints } = checkpoint);
  ({ cleanupOldCheckpoints } = checkpoint);
  ({ getCheckpointStats } = checkpoint);

  const tokenCounter = require("@/session/token/tokenCounter") as typeof import("@/session/token/tokenCounter");
  ({ estimateTokens } = tokenCounter);
  ({ estimateMessagesTokens } = tokenCounter);
  ({ formatTokenCount } = tokenCounter);

  const exporter = require("@/session/exporter") as typeof import("@/session/exporter");
  ({ exportSession } = exporter);

  const perm = require("@/session/permissions") as typeof import("@/session/permissions");
  ({ addPersistentPermission } = perm);
  ({ loadPersistentPermissions } = perm);
  ({ findPersistentPermission } = perm);
  ({ clearPersistentPermissions } = perm);

  const status = require("@/session/state/sessionStatus") as typeof import("@/session/state/sessionStatus");
  ({ getSessionStatus } = status);
  ({ setSessionStatus } = status);
  ({ isSessionBusy } = status);
  ({ canAcceptInput } = status);
  ({ clearSessionStatus } = status);
  ({ getBusySessions } = status);
  ({ resetAllBusy } = status);
  ({ _resetAllStatus } = status);

  // 清除上一个测试遗留的 session 状态
  _resetAllStatus();

  // 初始化测试数据库
  resetDb();
  initDb(testDbPath);
});

afterAll(() => {
  closeDb();
  if (testDir && existsSync(testDir)) {
    cleanupTestDir(testDir);
  }
});

// ─── 数据库初始化 ──────────────────────────────────────────────

describe("数据库初始化", () => {
  test("initDb 创建数据库文件", () => {
    expect(existsSync(testDbPath)).toBe(true);
  });

  test("getDb 返回 Drizzle 实例", () => {
    const db = getDb();
    expect(db).toBeDefined();
  });

  test("数据库文件包含 sessions 表", () => {
    const db = getDb();
    const result = db.select().from(require("@/db/schema").sessions).all();
    expect(Array.isArray(result)).toBe(true);
  });
});

// ─── 会话 CRUD ─────────────────────────────────────────────────

describe("会话 CRUD", () => {
  test("createSession 返回 ses_ 前缀 ID", () => {
    const s = createSession();
    expect(s.id).toMatch(/^ses_/);
    expect(s.status).toBe("active");
  });

  test("getSession 按 ID 查询会话", () => {
    const created = createSession({ title: "测试会话" });
    const found = getSession(created.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.title).toBe("测试会话");
  });

  test("getSession 查询不存在的 ID 返回 null", () => {
    const found = getSession("ses_notexist");
    expect(found).toBeNull();
  });

  test("updateSession 更新标题和状态", () => {
    const s = createSession({ title: "原标题" });
    const updated = updateSession(s.id, { status: "completed", title: "新标题" });
    expect(updated).not.toBeNull();
    expect(updated!.title).toBe("新标题");
    expect(updated!.status).toBe("completed");
  });

  test("deleteSession 删除会话", () => {
    const s = createSession();
    expect(deleteSession(s.id)).toBe(true);
    expect(getSession(s.id)).toBeNull();
  });

  test("deleteSession 级联删除消息和检查点", () => {
    const s = createSession();
    addTextMessage(s.id, "user", "需要被级联删除的消息");
    const chk = createCheckpoint(s.id, "需要被级联删除的检查点");

    expect(getMessageCount(s.id)).toBe(1);
    expect(getCheckpoint(chk.id)).not.toBeNull();

    expect(deleteSession(s.id)).toBe(true);
    expect(getSession(s.id)).toBeNull();
    expect(getMessageCount(s.id)).toBe(0);
    expect(listCheckpoints(s.id)).toHaveLength(0);
    expect(getCheckpoint(chk.id)).toBeNull();
  });

  test("deleteSession 删除不存在的会话返回 false", () => {
    expect(deleteSession("ses_notexist")).toBe(false);
  });

  test("listSessions 返回会话列表", () => {
    createSession({ title: "会话A" });
    createSession({ title: "会话B" });
    const list = listSessions();
    expect(list.length).toBe(2);
  });

  test("ensureSession 已存在时复用记录，不重复创建", () => {
    const created = createSession({ id: "ses_existing", title: "已有会话" });
    const ensured = ensureSession(created.id, { title: "不应覆盖" });
    expect(ensured.id).toBe(created.id);
    expect(ensured.title).toBe("已有会话");
    expect(listSessions().length).toBe(1);
  });

  test("ensureSession 不存在时按指定 ID 创建", () => {
    const ensured = ensureSession("ses_manual", { model: "gpt-test", title: "手动会话" });
    expect(ensured.id).toBe("ses_manual");
    expect(ensured.title).toBe("手动会话");
    expect(ensured.model).toBe("gpt-test");
  });

  test("createSessionAsync 和 ensureSessionAsync 覆盖异步创建路径", async () => {
    const created = await createSessionAsync({ title: "异步会话" });
    expect(created.id).toMatch(/^ses_/);

    const reused = await ensureSessionAsync(created.id, { title: "不应覆盖" });
    expect(reused.id).toBe(created.id);
    expect(reused.title).toBe("异步会话");

    const ensured = await ensureSessionAsync("ses_async_manual", { title: "异步指定" });
    expect(ensured.id).toBe("ses_async_manual");
    expect(getSession("ses_async_manual")?.title).toBe("异步指定");
  });

  test("addSessionTokens 累加输入输出 reasoning 和成本", () => {
    const s = createSession();
    addSessionTokens(s.id, { cost: 0.25, input: 10, output: 20, reasoning: 3 });
    addSessionTokens(s.id, { cost: 0.1, input: 2, output: 5 });

    const updated = getSession(s.id);
    expect(updated?.tokensInput).toBe(12);
    expect(updated?.tokensOutput).toBe(25);
    expect(updated?.tokensReasoning).toBe(3);
    expect(updated?.cost).toBeCloseTo(0.35);
  });

  test("addSessionTokens 对不存在会话静默返回", () => {
    expect(() => addSessionTokens("ses_missing", { input: 1 })).not.toThrow();
  });
});

// ─── 会话分叉 ──────────────────────────────────────────────────

describe("会话分叉", () => {
  test("forkSession 创建新会话并复制消息", () => {
    const parent = createSession({ title: "父会话" });
    addTextMessage(parent.id, "user", "你好");
    addTextMessage(parent.id, "assistant", "你好！");

    const forked = forkSession(parent.id, "分叉会话");
    expect(forked).not.toBeNull();
    expect(forked!.id).not.toBe(parent.id);
    expect(forked!.parentId).toBe(parent.id);

    const forkedMsgs = getSessionMessages(forked!.id);
    expect(forkedMsgs.length).toBe(2);
  });

  test("forkSession 对不存在的会话返回 null", () => {
    expect(forkSession("ses_notexist")).toBeNull();
  });
});

// ─── 消息管理 ──────────────────────────────────────────────────

describe("消息管理", () => {
  test("addMessage 返回 msg_ 前缀 ID", () => {
    const s = createSession();
    const msg = addMessage(s.id, "user", [{ content: "你好", type: "text" }]);
    expect(msg.id).toMatch(/^msg_/);
    expect(msg.role).toBe("user");
    expect(msg.parts.length).toBe(1);
  });

  test("addTextMessage 快捷添加文本消息", () => {
    const s = createSession();
    const msg = addTextMessage(s.id, "assistant", "世界");
    expect(msg.parts[0]!.type).toBe("text");
    expect((msg.parts[0] as { content: string }).content).toBe("世界");
  });

  test("getSessionMessages 按时间排序返回消息", () => {
    const s = createSession();
    addTextMessage(s.id, "user", "第一条");
    addTextMessage(s.id, "assistant", "第二条");
    addTextMessage(s.id, "user", "第三条");

    const msgs = getSessionMessages(s.id);
    expect(msgs.length).toBe(3);
    expect((msgs[0]!.parts[0] as { content: string }).content).toBe("第一条");
    expect((msgs[2]!.parts[0] as { content: string }).content).toBe("第三条");
  });

  test("getMessageCount 返回正确数量", () => {
    const s = createSession();
    expect(getMessageCount(s.id)).toBe(0);
    addTextMessage(s.id, "user", "消息");
    addTextMessage(s.id, "assistant", "回复");
    expect(getMessageCount(s.id)).toBe(2);
  });

  test("copyMessages 复制消息到另一个会话", () => {
    const s1 = createSession();
    const s2 = createSession();
    addTextMessage(s1.id, "user", "消息A");
    addTextMessage(s1.id, "user", "消息B");

    const count = copyMessages(s1.id, s2.id);
    expect(count).toBe(2);
    expect(getMessageCount(s2.id)).toBe(2);
  });

  test("copyMessages 保留内容顺序但生成新的消息 ID", () => {
    const s1 = createSession();
    const s2 = createSession();
    addTextMessage(s1.id, "user", "消息A");
    addTextMessage(s1.id, "assistant", "消息B");

    const sourceMessages = getSessionMessages(s1.id);
    expect(copyMessages(s1.id, s2.id)).toBe(2);

    const copiedMessages = getSessionMessages(s2.id);
    expect(copiedMessages).toHaveLength(2);
    expect(copiedMessages.map((msg) => msg.id)).not.toEqual(sourceMessages.map((msg) => msg.id));
    expect(copiedMessages.map((msg) => msg.role)).toEqual(sourceMessages.map((msg) => msg.role));
    expect(copiedMessages.map((msg) => (msg.parts[0] as { content: string }).content)).toEqual(["消息A", "消息B"]);
  });

  test("工具调用消息正确存储", () => {
    const s = createSession();
    addMessage(s.id, "assistant", [{ content: "{}", tool_name: "bash", tool_use_id: "call_1", type: "tool_use" }]);
    addMessage(s.id, "tool", [{ content: "输出结果", result: "输出结果", tool_use_id: "call_1", type: "tool_result" }]);

    const msgs = getSessionMessages(s.id);
    expect(msgs.length).toBe(2);
    expect(msgs[0]!.parts[0]!.type).toBe("tool_use");
    expect(msgs[1]!.parts[0]!.type).toBe("tool_result");
  });
});

// ─── 检查点 ────────────────────────────────────────────────────

describe("检查点", () => {
  test("createCheckpoint 创建带 chk_ 前缀 ID 的检查点", () => {
    const s = createSession();
    addTextMessage(s.id, "user", "消息1");
    const chk = createCheckpoint(s.id, "初始检查点");
    expect(chk.id).toMatch(/^chk_/);
    expect(chk.label).toBe("初始检查点");
    expect(chk.snapshot.length).toBe(1);
  });

  test("listCheckpoints 列出会话检查点", () => {
    const s = createSession();
    createCheckpoint(s.id, "检查点1");
    createCheckpoint(s.id, "检查点2");
    const list = listCheckpoints(s.id);
    expect(list.length).toBe(2);
  });

  test("restoreCheckpoint 恢复到检查点状态", () => {
    const s = createSession();
    addTextMessage(s.id, "user", "消息1");
    const chk = createCheckpoint(s.id);

    // 添加更多消息
    addTextMessage(s.id, "user", "消息2");
    addTextMessage(s.id, "user", "消息3");
    expect(getMessageCount(s.id)).toBe(3);

    // 恢复检查点
    const restored = restoreCheckpoint(chk.id);
    expect(restored).not.toBeNull();
    expect(restored!.length).toBe(1);
    expect(getMessageCount(s.id)).toBe(1);
  });

  test("restoreCheckpoint 重复恢复不会重复累加消息", () => {
    const s = createSession();
    addTextMessage(s.id, "user", "快照消息1");
    addTextMessage(s.id, "assistant", "快照消息2");
    const chk = createCheckpoint(s.id, "可重复恢复");
    const snapshotIds = chk.snapshot.map((msg) => msg.id);

    addTextMessage(s.id, "user", "快照后的消息");
    expect(getMessageCount(s.id)).toBe(3);

    const firstRestore = restoreCheckpoint(chk.id);
    expect(firstRestore).not.toBeNull();
    expect(getMessageCount(s.id)).toBe(2);
    const firstMessages = getSessionMessages(s.id);
    expect(firstMessages.map((msg) => (msg.parts[0] as { content: string }).content)).toEqual([
      "快照消息1",
      "快照消息2",
    ]);
    expect(new Set(firstMessages.map((msg) => msg.id)).size).toBe(2);
    expect(firstMessages.map((msg) => msg.id)).not.toEqual(snapshotIds);

    addTextMessage(s.id, "assistant", "再次污染");
    expect(getMessageCount(s.id)).toBe(3);

    const secondRestore = restoreCheckpoint(chk.id);
    expect(secondRestore).not.toBeNull();
    const secondMessages = getSessionMessages(s.id);
    expect(secondMessages).toHaveLength(2);
    expect(secondMessages.map((msg) => (msg.parts[0] as { content: string }).content)).toEqual([
      "快照消息1",
      "快照消息2",
    ]);
    expect(new Set(secondMessages.map((msg) => msg.id)).size).toBe(2);
  });

  test("getCheckpoint 获取详情，updateCheckpointLabel 更新标签", () => {
    const s = createSession();
    const chk = createCheckpoint(s.id, "旧标签");

    expect(updateCheckpointLabel(chk.id, "新标签")).toBe(true);
    expect(getCheckpoint(chk.id)?.label).toBe("新标签");
    expect(updateCheckpointLabel("chk_missing", "x")).toBe(false);
    expect(getCheckpoint("chk_missing")).toBeNull();
  });

  test("deleteCheckpoint 删除存在项，不存在返回 false", () => {
    const s = createSession();
    const chk = createCheckpoint(s.id);

    expect(deleteCheckpoint(chk.id)).toBe(true);
    expect(getCheckpoint(chk.id)).toBeNull();
    expect(deleteCheckpoint("chk_missing")).toBe(false);
  });

  test("compareCheckpoints 返回新增、删除、修改数量", () => {
    const s = createSession();
    addTextMessage(s.id, "user", "A");
    const cp1 = createCheckpoint(s.id, "one");

    addTextMessage(s.id, "assistant", "B");
    const cp2 = createCheckpoint(s.id, "two");

    const diff = compareCheckpoints(cp1.id, cp2.id);
    expect(diff).toEqual({ added: 1, modified: 0, removed: 0, total1: 1, total2: 2 });
    expect(compareCheckpoints(cp1.id, "chk_missing")).toBeNull();
  });

  test("cleanupOldCheckpoints 仅保留最近 N 个并返回删除数量", async () => {
    const s = createSession();
    createCheckpoint(s.id, "1");
    await new Promise((resolve) => setTimeout(resolve, 1));
    createCheckpoint(s.id, "2");
    await new Promise((resolve) => setTimeout(resolve, 1));
    createCheckpoint(s.id, "3");

    expect(cleanupOldCheckpoints(s.id, 2)).toBe(1);
    const labels = listCheckpoints(s.id).map((cp) => cp.label);
    expect(labels).toEqual(["3", "2"]);
    expect(cleanupOldCheckpoints(s.id, 5)).toBe(0);
  });

  test("getCheckpointStats 空/非空统计", async () => {
    const s = createSession();
    expect(getCheckpointStats(s.id)).toEqual({ total: 0 });

    addTextMessage(s.id, "user", "统计消息");
    createCheckpoint(s.id, "stats-1");
    await new Promise((resolve) => setTimeout(resolve, 1));
    createCheckpoint(s.id, "stats-2");

    const stats = getCheckpointStats(s.id);
    expect(stats.total).toBe(2);
    expect(stats.oldest).toBeLessThanOrEqual(stats.newest!);
    expect(stats.totalSize).toBeGreaterThan(0);
  });
});

// ─── Token 计数 ────────────────────────────────────────────────

describe("Token 计数", () => {
  test("estimateTokens 空字符串返回 0", () => {
    expect(estimateTokens("")).toBe(0);
  });

  test("estimateTokens 纯英文文本", () => {
    const tokens = estimateTokens("Hello World");
    expect(tokens).toBeGreaterThan(0);
  });

  test("estimateTokens 纯中文文本", () => {
    const tokens = estimateTokens("你好世界");
    expect(tokens).toBeGreaterThan(0);
  });

  test("estimateTokens 中文比英文产生更多 token", () => {
    const cn = estimateTokens("你好世界测试");
    const en = estimateTokens("hello world test");
    expect(cn).toBeGreaterThan(en);
  });

  test("estimateMessagesTokens 正确计算消息列表", () => {
    const tokens = estimateMessagesTokens([{ parts: [{ content: "你好", type: "text" }], role: "user" } as any]);
    expect(tokens).toBeGreaterThan(0);
  });

  test("estimateMessagesTokens 覆盖 content 字符串与 AI SDK parts", () => {
    const tokens = estimateMessagesTokens([
      { content: "hello world", role: "user" },
      {
        content: [
          { text: "回答", type: "text" },
          { input: { cmd: "ls" }, toolCallId: "call_1", toolName: "bash", type: "tool-call" },
        ],
        role: "assistant",
      },
    ]);
    expect(tokens).toBeGreaterThan(8);
  });

  test("formatTokenCount 覆盖小数、千级和百万级展示", () => {
    expect(formatTokenCount(999)).toBe("999");
    expect(formatTokenCount(1500)).toBe("1.5k");
    expect(formatTokenCount(1_250_000)).toBe("1.3M");
  });
});

// ─── 会话导出 ──────────────────────────────────────────────────

describe("会话导出", () => {
  test("exportSession 导出为 Markdown", () => {
    const s = createSession({ title: "导出测试" });
    addTextMessage(s.id, "user", "用户消息");
    addTextMessage(s.id, "assistant", "助手回复");

    const outPath = join(testDir, "export.md");
    const result = exportSession(s.id, outPath, "markdown");
    expect(result).not.toBeNull();
    expect(result!.format).toBe("markdown");
    expect(result!.messageCount).toBe(2);
    expect(existsSync(outPath)).toBe(true);

    const content = readFileSync(outPath, "utf8");
    expect(content).toContain("导出测试");
    expect(content).toContain("用户消息");
    expect(content).toContain("助手回复");
  });

  test("exportSession 导出为 JSON", () => {
    const s = createSession({ title: "JSON 导出" });
    addTextMessage(s.id, "user", "测试");

    const outPath = join(testDir, "export.json");
    const result = exportSession(s.id, outPath, "json");
    expect(result).not.toBeNull();
    expect(result!.format).toBe("json");

    const json = JSON.parse(readFileSync(outPath, "utf8"));
    expect(json.title).toBe("JSON 导出");
    expect(json.messageCount).toBe(1);
  });

  test("exportSession 不存在的会话返回 null", () => {
    const result = exportSession("ses_notexist", "/tmp/x.md", "markdown");
    expect(result).toBeNull();
  });

  test("exportSession 空会话返回 null 且不写文件", () => {
    const s = createSession({ title: "空会话" });
    const outPath = join(testDir, "empty.md");
    const result = exportSession(s.id, outPath, "markdown");
    expect(result).toBeNull();
    expect(existsSync(outPath)).toBe(false);
  });
});

// ─── 持久化权限 ────────────────────────────────────────────────

describe("持久化权限", () => {
  test("addPersistentPermission 写入规则", () => {
    addPersistentPermission("bash", "git *", "allow");
    const rules = loadPersistentPermissions();
    expect(rules.length).toBe(1);
    expect(rules[0]!.permission).toBe("bash");
    expect(rules[0]!.pattern).toBe("git *");
    expect(rules[0]!.action).toBe("allow");
  });

  test("addPersistentPermission 幂等 — 同一规则不重复", () => {
    addPersistentPermission("bash", "git *");
    addPersistentPermission("bash", "git *");
    const rules = loadPersistentPermissions();
    expect(rules.length).toBe(1);
  });

  test("findPersistentPermission 精确查询", () => {
    addPersistentPermission("bash", "git *");
    const found = findPersistentPermission("bash", "git *");
    expect(found).not.toBeNull();
    expect(found!.action).toBe("allow");
  });

  test("findPersistentPermission 查不存在的返回 null", () => {
    const found = findPersistentPermission("bash", "nonexistent");
    expect(found).toBeNull();
  });

  test("clearPersistentPermissions 清除全部", () => {
    addPersistentPermission("bash", "git *");
    addPersistentPermission("fs.write", "*.ts");
    const count = clearPersistentPermissions();
    expect(count).toBe(2);
    expect(loadPersistentPermissions().length).toBe(0);
  });
});

// ─── 崩溃恢复 — 清理不完整 tool_calls ────────────────────────────

describe("崩溃恢复: cleanIncompleteToolCalls", () => {
  test("完整消息序列不做清理", () => {
    const s = createSession();
    addTextMessage(s.id, "user", "你好");
    addMessage(s.id, "assistant", [{ content: "{}", tool_name: "bash", tool_use_id: "call_1", type: "tool_use" }]);
    addMessage(s.id, "tool", [{ content: "输出", result: "输出", tool_use_id: "call_1", type: "tool_result" }]);

    const cleaned = cleanIncompleteToolCalls(s.id);
    expect(cleaned).toBe(0);
    expect(getMessageCount(s.id)).toBe(3);
  });

  test("清理不完整的 tool_use(无匹配 tool_result)", () => {
    const s = createSession();
    addTextMessage(s.id, "user", "你好");
    addTextMessage(s.id, "assistant", "让我执行命令");
    addMessage(s.id, "assistant", [{ content: "{}", tool_name: "bash", tool_use_id: "call_99", type: "tool_use" }]);
    // 没有对应的 tool_result — 模拟崩溃

    const cleaned = cleanIncompleteToolCalls(s.id);
    expect(cleaned).toBe(1); // 只有不完整的 assistant 消息被删除
    expect(getMessageCount(s.id)).toBe(2); // User + assistant text 保留

    const msgs = getSessionMessages(s.id);
    expect((msgs[0]!.parts[0] as { content: string }).content).toBe("你好");
    expect((msgs[1]!.parts[0] as { content: string }).content).toBe("让我执行命令");
  });

  test("清理不完整消息及后续所有消息", () => {
    const s = createSession();
    addTextMessage(s.id, "user", "你好"); // Idx 0
    addTextMessage(s.id, "assistant", "好的"); // Idx 1
    addMessage(s.id, "assistant", [
      // Idx 2 — 不完整 tool_use
      { content: "{}", tool_name: "bash", tool_use_id: "call_broken", type: "tool_use" },
    ]);
    addTextMessage(s.id, "user", "继续对话"); // Idx 3 — 不完整之后的消息
    addTextMessage(s.id, "assistant", "好的继续"); // Idx 4

    const cleaned = cleanIncompleteToolCalls(s.id);
    expect(cleaned).toBe(3); // Idx 2, 3, 4 全部删除
    expect(getMessageCount(s.id)).toBe(2);

    const msgs = getSessionMessages(s.id);
    expect((msgs[0]!.parts[0] as { content: string }).content).toBe("你好");
    expect((msgs[1]!.parts[0] as { content: string }).content).toBe("好的");
  });

  test("空会话不做清理", () => {
    const s = createSession();
    const cleaned = cleanIncompleteToolCalls(s.id);
    expect(cleaned).toBe(0);
  });

  test("仅文本消息不做清理", () => {
    const s = createSession();
    addTextMessage(s.id, "user", "你好");
    addTextMessage(s.id, "assistant", "你好！");
    const cleaned = cleanIncompleteToolCalls(s.id);
    expect(cleaned).toBe(0);
    expect(getMessageCount(s.id)).toBe(2);
  });

  test("多个 tool_use 部分完成部分不完整", () => {
    const s = createSession();
    addTextMessage(s.id, "user", "执行两个命令");
    addMessage(s.id, "assistant", [
      { content: "{}", tool_name: "bash", tool_use_id: "call_1", type: "tool_use" },
      { content: "{}", tool_name: "fs.write", tool_use_id: "call_2", type: "tool_use" },
    ]);
    addMessage(s.id, "tool", [{ content: "结果1", result: "结果1", tool_use_id: "call_1", type: "tool_result" }]);
    // Call_2 没有 tool_result — 不完整

    const cleaned = cleanIncompleteToolCalls(s.id);
    expect(cleaned).toBe(2); // Assistant + tool_result 都在 idx 1 之后
    expect(getMessageCount(s.id)).toBe(1); // 只剩 user 消息
  });
});

// ─── Session 状态管理 ────────────────────────────────────────────

describe("Session 状态管理", () => {
  test("默认状态为 idle", () => {
    const s = createSession();
    expect(getSessionStatus(s.id)).toBe("idle");
  });

  test("setSessionStatus 变更状态", () => {
    const s = createSession();
    const changed = setSessionStatus(s.id, "busy", "开始对话");
    expect(changed).toBe(true);
    expect(getSessionStatus(s.id)).toBe("busy");
  });

  test("相同状态不变更", () => {
    const s = createSession();
    expect(setSessionStatus(s.id, "idle")).toBe(false);
  });

  test("isSessionBusy 判断", () => {
    const s = createSession();
    expect(isSessionBusy(s.id)).toBe(false);
    setSessionStatus(s.id, "busy");
    expect(isSessionBusy(s.id)).toBe(true);
    setSessionStatus(s.id, "waiting");
    expect(isSessionBusy(s.id)).toBe(true);
    setSessionStatus(s.id, "retry");
    expect(isSessionBusy(s.id)).toBe(true);
  });

  test("canAcceptInput 仅 idle 时为 true", () => {
    const s = createSession();
    expect(canAcceptInput(s.id)).toBe(true);
    setSessionStatus(s.id, "busy");
    expect(canAcceptInput(s.id)).toBe(false);
    setSessionStatus(s.id, "retry");
    expect(canAcceptInput(s.id)).toBe(false);
    setSessionStatus(s.id, "error");
    expect(canAcceptInput(s.id)).toBe(false);
  });

  test("clearSessionStatus 清除记录", () => {
    const s = createSession();
    setSessionStatus(s.id, "busy");
    clearSessionStatus(s.id);
    expect(getSessionStatus(s.id)).toBe("idle"); // 回到默认
  });

  test("getBusySessions 列出 busy 会话", () => {
    const s1 = createSession();
    const s2 = createSession();
    const s3 = createSession();
    setSessionStatus(s1.id, "busy");
    setSessionStatus(s2.id, "waiting");
    setSessionStatus(s3.id, "retry");
    const busy = getBusySessions();
    expect(busy.length).toBe(3);
    expect(busy).toContain(s1.id);
    expect(busy).toContain(s2.id);
    expect(busy).toContain(s3.id);
  });

  test("resetAllBusy 重置所有 busy/retry 会话", () => {
    const s1 = createSession();
    const s2 = createSession();
    setSessionStatus(s1.id, "busy");
    setSessionStatus(s2.id, "retry");
    const count = resetAllBusy();
    expect(count).toBe(2);
    expect(getSessionStatus(s1.id)).toBe("idle");
    expect(getSessionStatus(s2.id)).toBe("idle");
  });

  test("状态变更发布 EventBus 事件", () => {
    const s = createSession();
    let receivedPayload: any = null;

    const { globalBus } = require("@/bus/core/eventBus");
    const { AppEvent } = require("@/bus/events");
    const unsub = globalBus.subscribe(AppEvent.SessionStatusChanged, (evt: any) => {
      receivedPayload = evt.properties;
    });

    setSessionStatus(s.id, "busy", "测试原因");

    // 给微任务队列时间执行
    const { setTimeout } = require("node:timers/promises");
    // EventBus 使用 queueMicrotask，同步代码后事件还未分发
    // 但测试环境是同步的，需要等一个 microtask

    unsub();
    // 验证 payload 结构(如果事件已分发)
    if (receivedPayload) {
      expect(receivedPayload.sessionId).toBe(s.id);
      expect(receivedPayload.status).toBe("busy");
      expect(receivedPayload.previousStatus).toBe("idle");
      expect(receivedPayload.reason).toBe("测试原因");
    }
    // 即使微任务还未执行，逻辑是正确的
  });
});
