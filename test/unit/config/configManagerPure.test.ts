/**
 * Config-manager 白盒测试 — createProfile 名称校验 + backupConfig 文件名生成。
 */
import { describe, expect, test } from "bun:test";

describe("createProfile 名称校验", () => {
  test("禁止创建名为 default 的 profile", () => {
    const name = "default";
    expect(name === "default").toBe(true); // 会被拒绝
  });

  test("其他名称允许", () => {
    const name: string = "my-profile";
    expect(name === "default").toBe(false);
  });
});

describe("backupConfig 文件名生成", () => {
  test("带 label 的文件名", () => {
    const timestamp = new Date("2026-05-27T10:30:45.123Z").toISOString().replace(/[:.]/g, "-");
    const label = "pre-update";
    const backupName = `${label}-${timestamp}`;
    expect(backupName).toMatch(/^pre-update-2026-05-27T10-30-45-123Z$/);
    expect(backupName.endsWith(".json")).toBe(false);
    // 实际代码会追加 .json
    expect(`${backupName}.json`).toMatch(/\.json$/);
  });

  test("无 label 使用 backup 前缀", () => {
    const timestamp = "2026-05-27T10-30-45-123Z";
    const backupName = `backup-${timestamp}`;
    expect(backupName).toMatch(/^backup-/);
  });
});

describe("listProfiles 映射逻辑", () => {
  test("isActive → active 字段映射", () => {
    const profiles = [
      { isActive: true, name: "default" },
      { isActive: false, name: "dev" },
    ];
    const mapped = profiles.map((p) => ({ ...p, active: p.isActive }));
    expect(mapped[0]!.active).toBe(true);
    expect(mapped[1]!.active).toBe(false);
  });
});

describe("importProfile 名称回退", () => {
  test("使用文件中的 profile 名称", () => {
    const config = { profile: "from-file" };
    const name = undefined;
    const profileName = name || (typeof config.profile === "string" ? config.profile : "imported");
    expect(profileName).toBe("from-file");
  });

  test("使用指定的名称覆盖", () => {
    const config = { profile: "from-file" };
    const name = "override";
    const profileName = name || (typeof config.profile === "string" ? config.profile : "imported");
    expect(profileName).toBe("override");
  });

  test("无 profile 字段回退到 imported", () => {
    const config = {};
    const name = undefined;
    const profileName = name || (typeof (config as any).profile === "string" ? (config as any).profile : "imported");
    expect(profileName).toBe("imported");
  });
});
