/**
 * unifiedSettings 单元测试。
 *
 * 覆盖:
 *   - readSettings / writeSettings / updateSettings
 *   - 三作用域 (global / project / session)
 *   - readMergedSettings 合并优先级
 *   - 边界条件（空文件、损坏 JSON、空目录）
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// 在模块加载前设置临时目录
let tempDir = "";
let originalXdgConfigHome: string | undefined;
let originalCwd: string;

// 延迟导入，确保环境变量先设置
let mod: typeof import("@/config/settings/unifiedSettings");

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "crab-settings-"));
  originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  originalCwd = process.cwd();
  process.env.XDG_CONFIG_HOME = tempDir;
  process.chdir(tempDir);
});

afterEach(() => {
  if (originalXdgConfigHome !== undefined) {
    process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
  } else {
    delete process.env.XDG_CONFIG_HOME;
  }
  process.chdir(originalCwd);
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("unifiedSettings", () => {
  test("readSettings: session 作用域返回内存副本", async () => {
    mod = await import("@/config/settings/unifiedSettings");
    const s1 = mod.readSettings("session");
    expect(s1).toEqual({});

    // 写入 session
    mod.updateSettings("session", (s: any) => {
      s.yoloMode = true;
    });
    const s2 = mod.readSettings("session");
    expect(s2.yoloMode).toBe(true);

    // 验证是副本（非引用）
    const s3 = mod.readSettings("session");
    (s3 as any).yoloMode = false;
    expect(mod.readSettings("session").yoloMode).toBe(true);

    // 清理
    mod.resetSessionSettings();
  });

  test("writeSettings: global 作用域持久化到文件", async () => {
    mod = await import("@/config/settings/unifiedSettings");
    const ok = mod.writeSettings("global", { yoloMode: true });
    expect(ok).toBe(true);

    const globalDir = path.join(tempDir, "crab");
    const filePath = path.join(globalDir, "settings.json");
    expect(fs.existsSync(filePath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(content.yoloMode).toBe(true);
  });

  test("writeSettings: project 作用域写入 .crab/settings.json", async () => {
    mod = await import("@/config/settings/unifiedSettings");
    const ok = mod.writeSettings("project", { planMode: true }, tempDir);
    expect(ok).toBe(true);

    const filePath = path.join(tempDir, ".crab", "settings.json");
    expect(fs.existsSync(filePath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(content.planMode).toBe(true);
  });

  test("writeSettings: session 作用域不写文件", async () => {
    mod = await import("@/config/settings/unifiedSettings");
    const ok = mod.writeSettings("session", { yoloMode: false });
    expect(ok).toBe(true);

    const files = fs.readdirSync(tempDir);
    expect(files.length).toBe(0);
  });

  test("updateSettings: 加载 → 修改 → 保存", async () => {
    mod = await import("@/config/settings/unifiedSettings");
    mod.writeSettings("global", { teamMode: false });

    const result = mod.updateSettings("global", (s: any) => {
      s.teamMode = true;
    });
    expect(result.teamMode).toBe(true);

    const reloaded = mod.readSettings("global");
    expect(reloaded.teamMode).toBe(true);
  });

  test("readMergedSettings: 优先级 session > project > global", async () => {
    mod = await import("@/config/settings/unifiedSettings");
    mod.writeSettings("global", { yoloMode: false, planMode: false, teamMode: false });
    mod.writeSettings("project", { yoloMode: true, planMode: true }, tempDir);
    mod.updateSettings("session", (s: any) => {
      s.yoloMode = false; // session 最高优先级
    });

    const merged = mod.readMergedSettings(tempDir);
    expect(merged.yoloMode).toBe(false); // session 覆盖
    expect(merged.planMode).toBe(true); // project 覆盖 global
    expect(merged.teamMode).toBe(false); // global 默认

    mod.resetSessionSettings();
  });

  test("readSettings: 损坏的 JSON 返回空对象", async () => {
    mod = await import("@/config/settings/unifiedSettings");
    const globalDir = path.join(tempDir, "crab");
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(path.join(globalDir, "settings.json"), "{invalid json", "utf8");

    const settings = mod.readSettings("global");
    expect(settings).toEqual({});
  });

  test("readSettings: 空文件返回空对象", async () => {
    mod = await import("@/config/settings/unifiedSettings");
    const globalDir = path.join(tempDir, "crab");
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(path.join(globalDir, "settings.json"), "", "utf8");

    const settings = mod.readSettings("global");
    expect(settings).toEqual({});
  });

  test("readSettings: 非对象 JSON 返回空对象", async () => {
    mod = await import("@/config/settings/unifiedSettings");
    const globalDir = path.join(tempDir, "crab");
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(path.join(globalDir, "settings.json"), '"a string"', "utf8");

    const settings = mod.readSettings("global");
    expect(settings).toEqual({});
  });

  test("readSettings: 数组 JSON 返回空对象", async () => {
    mod = await import("@/config/settings/unifiedSettings");
    const globalDir = path.join(tempDir, "crab");
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(path.join(globalDir, "settings.json"), "[1,2,3]", "utf8");

    const settings = mod.readSettings("global");
    expect(settings).toEqual({});
  });

  test("readMergedSettings: 深层合并而非浅覆盖", async () => {
    mod = await import("@/config/settings/unifiedSettings");
    mod.writeSettings("global", {
      codebase: { enabled: false, batch: { maxLines: 100 } },
    });
    mod.writeSettings(
      "project",
      {
        codebase: { enabled: true },
      },
      tempDir,
    );

    const merged = mod.readMergedSettings(tempDir);
    expect(merged.codebase?.enabled).toBe(true); // project 覆盖
    expect((merged.codebase as any)?.batch).toBeDefined(); // global 保留
  });

  test("resetSessionSettings: 清空 session 级设置", async () => {
    mod = await import("@/config/settings/unifiedSettings");
    mod.updateSettings("session", (s: any) => {
      s.yoloMode = true;
    });
    expect(mod.readSettings("session").yoloMode).toBe(true);

    mod.resetSessionSettings();
    expect(mod.readSettings("session")).toEqual({});
  });

  test("getSettingsPath: 返回正确路径", async () => {
    mod = await import("@/config/settings/unifiedSettings");
    const globalPath = mod.getSettingsPath("global");
    expect(globalPath).toContain("settings.json");
    expect(globalPath).toContain("crab");

    const projectPath = mod.getSettingsPath("project", "/tmp/myproject");
    expect(projectPath).toContain(".crab");
    expect(projectPath).toContain("settings.json");
  });
});
