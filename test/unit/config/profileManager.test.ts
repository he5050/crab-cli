/**
 * Profile 管理器测试。
 *
 * 测试用例:
 *   - Profile 切换
 *   - Profile 创建
 *   - Profile 删除
 *   - 配置隔离
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { AppConfigSchema } from "@/schema/config";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../helpers/testPaths";

// ─── Subagent Depth Schema 测试(无 mock)───────────────────

describe("Subagent Depth Configuration", () => {
  test("maxSpawnDepth 默认至 3", () => {
    const cfg = AppConfigSchema.parse({});
    expect(cfg.maxSpawnDepth).toBe(3);
  });

  test("maxSpawnDepth 遵守自定义值", () => {
    const cfg = AppConfigSchema.parse({ maxSpawnDepth: 5 });
    expect(cfg.maxSpawnDepth).toBe(5);
  });

  test("maxSpawnDepth 拒绝值以下 1", () => {
    const result = AppConfigSchema.safeParse({ maxSpawnDepth: 0 });
    expect(result.success).toBe(false);
  });

  test("maxSpawnDepth 拒绝值以上 10", () => {
    const result = AppConfigSchema.safeParse({ maxSpawnDepth: 11 });
    expect(result.success).toBe(false);
  });
});

// ─── Profile Manager 测试 ─────────────────────────────────
// 使用 XDG_CONFIG_HOME 环境变量控制路径 + 真实 file-utils，无 mock.module。

describe("Profile Manager", () => {
  let tmpDir: string;
  let configDir: string;
  let profilesDir: string;
  let origXdgConfig: string | undefined;

  beforeEach(() => {
    origXdgConfig = process.env.XDG_CONFIG_HOME;
    tmpDir = createGlobalTmpTestDir("crab-profile-");
    configDir = path.join(tmpDir, "crab");
    profilesDir = path.join(configDir, "profiles");
    fs.mkdirSync(profilesDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = tmpDir;

    // 写入一个空的全局 config.json，让 loadConfig 有文件可读
    fs.writeFileSync(path.join(configDir, "config.json"), JSON.stringify({}));
  });

  afterEach(async () => {
    if (origXdgConfig !== undefined) {
      process.env.XDG_CONFIG_HOME = origXdgConfig;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }

    const { resetConfigCache } = await import("@/config/loader/config");
    resetConfigCache();
    const { resetProfileManager } = await import("@/config/settings/profileManager");
    resetProfileManager();
    cleanupTestDir(tmpDir);
  });

  test("createProfile rejects 'default'", async () => {
    const { createProfile } = await import("@/config/settings/configManager");
    const ok = await createProfile("default");
    expect(ok).toBe(false);
  });

  test("createProfile 写入配置文件", async () => {
    const { resetConfigCache } = await import("@/config/loader/config");
    resetConfigCache();
    const { createProfile } = await import("@/config/settings/configManager");
    const ok = await createProfile("work");
    expect(ok).toBe(true);

    const fp = path.join(profilesDir, "work.json");
    expect(fs.existsSync(fp)).toBe(true);
    const data = JSON.parse(fs.readFileSync(fp, "utf8"));
    expect(data.defaultProvider).toBeDefined();
    expect(data.theme).toBeDefined();
  });

  test("deleteProfile rejects 'default'", async () => {
    const { deleteProfile } = await import("@/config/settings/configManager");
    const ok = await deleteProfile("default");
    expect(ok).toBe(false);
  });

  test("deleteProfile fails for nonexistent profile", async () => {
    const { deleteProfile } = await import("@/config/settings/configManager");
    const ok = await deleteProfile("nonexistent");
    expect(ok).toBe(false);
  });

  test("deleteProfile 移除配置文件", async () => {
    const fp = path.join(profilesDir, "temp.json");
    fs.writeFileSync(fp, JSON.stringify({ theme: "dark" }));

    const { deleteProfile } = await import("@/config/settings/configManager");
    const ok = await deleteProfile("temp");
    expect(ok).toBe(true);
    expect(fs.existsSync(fp)).toBe(false);
  });

  test("listProfiles 返回默认当无文件", async () => {
    const { resetConfigCache } = await import("@/config/loader/config");
    resetConfigCache();
    const { listProfiles } = await import("@/config/settings/configManager");
    const profiles = await listProfiles();
    expect(profiles.length).toBe(1);
    expect(profiles[0]!.name).toBe("default");
    expect(profiles[0]!.active).toBe(true);
  });

  test("listProfiles 扫描配置文件与标记活跃", async () => {
    fs.writeFileSync(path.join(profilesDir, "work.json"), JSON.stringify({}));
    fs.writeFileSync(path.join(profilesDir, "personal.json"), JSON.stringify({}));

    const { resetConfigCache } = await import("@/config/loader/config");
    resetConfigCache();
    const { listProfiles } = await import("@/config/settings/configManager");
    const profiles = await listProfiles();
    expect(profiles.length).toBe(3);

    const byName = (n: string) => profiles.find((p) => p.name === n);
    expect(byName("default")).toBeDefined();
    expect(byName("work")).toBeDefined();
    expect(byName("personal")).toBeDefined();
  });
});

// ─── Profile 命令注册测试 ──────────────────────────────────

describe("Profile Commands Registration", () => {
  test("profile-create and profile-delete commands exist", async () => {
    const { createAppCommands } = await import("@/commandPalette/appCommands");
    const cmds = createAppCommands({
      back: () => {},
      navigate: () => {},
      requestExit: () => {},
    });
    const names = cmds.map((c) => c.name);
    expect(names).toContain("config.profileCreate");
    expect(names).toContain("config.profileDelete");

    const create = cmds.find((c) => c.name === "config.profileCreate");
    expect(create).toBeDefined();
    expect(create!.slashName).toBe("profile-create");
    expect(create!.category).toBeTruthy();

    const del = cmds.find((c) => c.name === "config.profileDelete");
    expect(del).toBeDefined();
    expect(del!.slashName).toBe("profile-delete");
    expect(del!.category).toBeTruthy();
  });

  test("profile-create without args shows usage toast", async () => {
    const toasts: string[] = [];
    const { createAppCommands } = await import("@/commandPalette/appCommands");
    const cmds = createAppCommands({
      back: () => {},
      navigate: () => {},
      requestExit: () => {},
      showToast: (msg: string) => toasts.push(msg),
    });
    const cmd = cmds.find((c) => c.name === "config.profileCreate")!;
    await cmd.run();
    expect(toasts.length).toBeGreaterThan(0);
  });

  test("profile-delete without args shows usage toast", async () => {
    const toasts: string[] = [];
    const { createAppCommands } = await import("@/commandPalette/appCommands");
    const cmds = createAppCommands({
      back: () => {},
      navigate: () => {},
      requestExit: () => {},
      showToast: (msg: string) => toasts.push(msg),
    });
    const cmd = cmds.find((c) => c.name === "config.profileDelete")!;
    await cmd.run();
    expect(toasts.length).toBeGreaterThan(0);
  });
});
