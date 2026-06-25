/**
 * 待办列表扫描测试。
 *
 * 测试目标:
 *   - 验证命令面板中的 todo 列表扫描逻辑
 *
 * 测试用例:
 *   - 扫描到带 TODO 标记的文件/行
 *   - 空目录与无 TODO 时的行为
 *   - 临时目录清理
 */
import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAppCommands } from "@/commandPalette/appCommands";
import { globalBus } from "@/bus";
import { AppEvent } from "@/bus";
import { cleanupTestDir } from "../../helpers/testPaths";
import { formatTodoContext, scanProjectTodos } from "@/core/scanning";

let tempDir = "";
const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
  globalBus.setThrottleEnabled(true);
  globalBus.clearHistory();
  if (tempDir) {
    cleanupTestDir(tempDir);
    tempDir = "";
  }
});

describe("/todo-list scanner integration", () => {
  test("todo-list 会输出扫描得到的项目 TODO 注释", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "todo-list-command-"));
    fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "src", "scanner.ts"), "// TODO: connect command surface", "utf8");
    process.chdir(tempDir);
    globalBus.setThrottleEnabled(false);

    const logs: string[] = [];
    const unsub = globalBus.subscribe(AppEvent.Log, (evt) => {
      logs.push(evt.properties.message);
    });

    const commands = createAppCommands({
      back: () => {},
      navigate: () => {},
      requestExit: () => {},
      showToast: () => {},
    });

    const todoList = commands.find((command) => command.name === "manage.todoList");
    expect(todoList).toBeDefined();

    await todoList!.run();
    await globalBus.flush();
    unsub();

    expect(logs.length).toBeGreaterThan(0);
    expect(logs.at(-1)).toContain("connect command surface");
    expect(logs.at(-1)).toContain("待办列表");
  });

  test("todo scanner 空结果返回明确上下文文案", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "todo-list-empty-"));
    fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "src", "clean.ts"), "export const clean = true;", "utf8");

    const items = scanProjectTodos(tempDir);

    expect(items).toEqual([]);
    expect(formatTodoContext(items)).toBe("No TODO comments found.");
  });
});
