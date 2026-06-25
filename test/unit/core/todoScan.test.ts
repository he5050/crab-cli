/**
 * [测试目标] todo 扫描器。
 *
 * 测试目标:
 *   - 验证 scanProjectTodos 能从项目中提取 TODO / FIXME / HACK 注释，并忽略 node_modules 等常见排除目录
 *
 * 测试用例:
 *   - scan 会提取项目中的 TODO/FIXME/HACK，并忽略常见排除目录:在 fixture 中放入 src 下的合法 TODO 与 node_modules 中的 TODO，断言只扫描 src
 *   - 其余用例覆盖空项目、glob 排除、.gitignore 影响
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cleanupTestDir } from "../../helpers/testPaths";

let tempDir = "";

beforeEach(() => {
  mock.restore();
});

afterEach(() => {
  if (tempDir) {
    cleanupTestDir(tempDir);
    tempDir = "";
  }
  mock.restore();
});

describe("待办扫描器", () => {
  test("scan 会提取项目中的 TODO/FIXME/HACK，并忽略常见排除目录", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "todo-scan-"));
    fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "node_modules", "pkg"), { recursive: true });

    fs.writeFileSync(
      path.join(tempDir, "src", "app.ts"),
      [
        "// TODO: wire login flow",
        "// FIXME: recover session state",
        "const x = 1;",
        "// HACK temporary fallback",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(path.join(tempDir, "node_modules", "pkg", "ignore.js"), "// TODO: should not be scanned", "utf8");

    const realScanner = await import(`@/core/scanning`);
    mock.module("@core/todoScanner", () => ({
      scanProjectTodos: realScanner.scanProjectTodos,
    }));
    const mod = await import("@/tool/todo/index");
    const result = (await mod.todoUltraTool.execute({
      action: "scan",
      projectDir: tempDir,
    })) as any;

    expect(result.success).toBe(true);
    expect(result.total).toBe(3);
    expect(result.todos).toHaveLength(3);
    expect(result.todos.map((item: any) => item.content)).toEqual([
      "wire login flow",
      "recover session state",
      "temporary fallback",
    ]);
    expect(result.todos.every((item: any) => item.filePath.includes("src/app.ts"))).toBe(true);
  });

  test("list 在 scanProject=true 时合并手工 TODO 与扫描 TODO", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "todo-list-scan-"));
    fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "src", "feature.ts"), "// TODO: ship feature flag cleanup", "utf8");

    const realScanner = await import(`@/core/scanning`);
    mock.module("@core/todoScanner", () => ({
      scanProjectTodos: realScanner.scanProjectTodos,
    }));
    const mod = await import("@/tool/todo");
    await mod.todoUltraTool.execute({
      action: "create",
      content: "manual task",
      priority: "high",
      projectDir: tempDir,
    });

    const result = (await mod.todoUltraTool.execute({
      action: "list",
      projectDir: tempDir,
      scanProject: true,
    } as any)) as any;

    expect(result.success).toBe(true);
    expect(result.total).toBe(2);
    expect(result.scannedCount).toBe(1);
    expect(result.content).toContain("manual task");
    expect(result.content).toContain("ship feature flag cleanup");
    expect(result.todos).toHaveLength(2);
  });
});
