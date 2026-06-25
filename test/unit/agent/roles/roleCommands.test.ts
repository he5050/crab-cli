/**
 * 角色命令面板测试。
 *
 * 测试目标:
 *   - 验证 createAppCommands 在角色(role)相关命令的注册与可用性
 *
 * 测试用例:
 *   - 角色相关的命令出现在命令面板
 *   - 不同角色下的命令集合稳定
 */
import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAppCommands } from "@/commandPalette/appCommands";
import { getCommandRegistry } from "@/commandPalette/registry";
import { readSettings } from "@/config/settings/unifiedSettings";

const originalCwd = process.cwd();
let tempProject: string | undefined;
let toasts: string[] = [];

function setupProjectCommands() {
  tempProject = fs.mkdtempSync(path.join(os.tmpdir(), "crab-role-commands-"));
  process.chdir(tempProject);
  toasts = [];
  const registry = getCommandRegistry();
  registry.clear();
  registry.registerAll(
    createAppCommands({
      back: () => {},
      getConfig: () => ({ defaultProvider: { model: "test", provider: "test" }, providerConfig: {} }) as any,
      navigate: () => {},
      requestExit: () => {},
      showToast: (msg) => toasts.push(msg),
    }),
  );
  return registry;
}

describe("role slash commands", () => {
  afterEach(() => {
    process.chdir(originalCwd);
    if (tempProject) {
      fs.rmSync(tempProject, { force: true, recursive: true });
      tempProject = undefined;
    }
    const registry = getCommandRegistry();
    registry.clear();
  });

  test("/role-create creates project .crab/ROLE.md by default", async () => {
    const registry = setupProjectCommands();

    const ok = await registry.executeSlash("role-create");

    expect(ok).toBe(true);
    expect(fs.existsSync(path.join(tempProject!, ".crab", "ROLE.md"))).toBe(true);
    expect(toasts).toContain("角色文件已创建");
  });

  test("/role-override toggles only role settings for the active project role", async () => {
    const registry = setupProjectCommands();
    await registry.executeSlash("role-create");

    const ok = await registry.executeSlash("role-override");
    const settings = readSettings("project", tempProject);

    expect(ok).toBe(true);
    expect(settings.role?.overrideRoleIds).toEqual(["active"]);
    expect(toasts.some((toast) => toast.includes("Override 模式: 已启用"))).toBe(true);
  });
});
