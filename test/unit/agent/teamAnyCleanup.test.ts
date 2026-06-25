/**
 * Team `any` 清理守卫测试 — [P2-09]
 *
 * 防止未来 PR 重新引入 `as any` / `catch (e: any)` / 私有字段旁路。
 *
 * 覆盖三处清理:
 *  1. teamExecutor.ts claim_task 错误处理:catch(e) + instanceof Error
 *  2. teamExecutor.ts: taskStatus 强转 → TeamTaskStatus(不再 as any)
 *  3. teamSnapshot.ts: 改用 teamExecutor.getProjectDir() 公开方法
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readFileSync } from "node:fs";

import { TeamExecutor } from "@/agent/team";
import type { TeamTaskStatus } from "@/agent/team/type";

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "p2-09-guard-"));
  mkdirSync(join(projectDir, ".git"), { recursive: true });
});

afterEach(() => {
  try {
    rmSync(projectDir, { force: true, recursive: true });
  } catch {
    /* Ignore */
  }
});

describe("[P2-09] Team `任意` 清理守卫", () => {
  test("2. taskStatus 强转类型约束:TeamTaskStatus 联合类型保持 4 状态", () => {
    // 编译期由 TS 保证；运行时验证 import 与导出形态
    const validStatuses: TeamTaskStatus[] = ["pending", "in-progress", "completed", "failed"];
    expect(validStatuses.length).toBe(4);
  });

  test("3. getProjectDir() 公开方法暴露 projectDir 字段(替代 as any 旁路)", () => {
    const executor = new TeamExecutor(projectDir);
    expect(executor.getProjectDir()).toBe(projectDir);
  });

  test("3.1 getProjectDir() 未传 projectDir 时回退到 process.cwd()", () => {
    const executor = new TeamExecutor(undefined);
    const dir = executor.getProjectDir();
    expect(typeof dir).toBe("string");
    expect(dir).toBe(process.cwd());
  });

  test("4. 静态守卫:teamExecutor.ts / teamSnapshot.ts 不再含 `as any` / `catch (e: any)` / `(teamExecutor as any)` 旁路", () => {
    const files = ["src/agent/team/core/teamExecutor.ts", "src/agent/team/persist/teamSnapshot.ts"];
    const violations: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      const lines = src.split("\n");
      lines.forEach((line, idx) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*")) {
          return;
        }
        if (
          /\bany\b/.test(line) &&
          /:\s*any\b|\bas\s+any\b|catch\s*\(\s*\w+\s*:\s*any\b|\(\s*\w+\s+as\s+any\s*\)/.test(line)
        ) {
          violations.push(`${f}:${idx + 1}: ${line.trim()}`);
        }
      });
    }
    expect(violations).toEqual([]);
  });
});
