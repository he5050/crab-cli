/**
 * 首页(Home Page)测试。
 *
 * 测试目标:
 *   - 验证首页组件、SLOT_NAMES、getWorkspaceLabel 的行为
 *
 * 测试用例:
 *   - 关键 slot 名存在
 *   - 工作区标签渲染正确
 */
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { SLOT_NAMES } from "@/ui/plugins/slots";
import { getWorkspaceLabel } from "@/ui/pages/home";

const ROOT = path.join(import.meta.dir, "../../../..");

describe("Phase 21 Home Page", () => {
  test("Home exposes opencode slot layout and workspace prompt contract", () => {
    const source = fs.readFileSync(path.join(ROOT, "src/ui/pages/home.tsx"), "utf8");

    expect(source).toContain('Slot name="home_logo"');
    expect(source).toContain('Slot name="home_prompt"');
    expect(source).toContain('Slot name="home_prompt_right"');
    expect(source).toContain('Slot name="home_bottom"');
    expect(source).toContain('Slot name="home_footer"');
    expect(source).toContain("promptMaxWidth");
    expect(source).toContain("Math.max(75, Math.floor(dimensions().width * 0.7))");
    expect(source).toContain("workspace");
    expect(source).toContain("Enter 开始会话 · Ctrl+P 命令面板 · Ctrl+X 快捷入口");
    expect(source).toContain("registry.executeSlash(slashCmd, slashArgs)");
  });

  test("Home 槽是已注册在槽目录", () => {
    expect(SLOT_NAMES).toContain("home_prompt_right");
    expect(SLOT_NAMES).toContain("home_bottom");
    expect(SLOT_NAMES).toContain("home_footer");
  });

  test("workspace label derives project name from cwd", () => {
    expect(getWorkspaceLabel("/tmp/crab-cli")).toEqual({
      name: "crab-cli",
      path: "/tmp/crab-cli",
    });
  });
});
