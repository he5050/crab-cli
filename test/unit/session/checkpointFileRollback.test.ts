/**
 * 检查点文件回滚测试。
 *
 * 测试目标:
 *   - 验证 checkpoint 机制在文件层面的回滚行为
 *
 * 测试用例:
 *   - 创建 checkpoint 后文件被快照
 *   - 回滚到 checkpoint 时文件被还原
 *   - 临时目录与 env 状态在测试结束后清理
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createSession, addTextMessage, getSessionMessages, createCheckpoint, restoreCheckpoint } from "@/session";
import { recordFileMutation } from "@/tool/rollback";
import { fsWriteTool } from "@/tool/filesystem/write";
import { installDbIsolation } from "../../helpers/dbIsolation";

installDbIsolation("checkpoint-file-rollback-");

describe("无 git 的 checkpoint 文件回滚", () => {
  const roots: string[] = [];
  let originalCwd = process.cwd();

  afterEach(() => {
    process.chdir(originalCwd);
    for (const root of roots.splice(0)) {
      rmSync(root, { force: true, recursive: true });
    }
  });

  function makeProject(): string {
    originalCwd = process.cwd();
    const root = mkdtempSync(join(tmpdir(), "crab-checkpoint-files-"));
    roots.push(root);
    mkdirSync(join(root, "src"), { recursive: true });
    process.chdir(root);
    return root;
  }

  test("restores session-linked file mutations when project is not a git worktree", async () => {
    const projectDir = makeProject();
    const session = createSession({ projectDir, title: "no git rollback" });
    const filePath = join(projectDir, "src", "example.txt");
    writeFileSync(filePath, "before\n");
    addTextMessage(session.id, "user", "before checkpoint");
    const checkpoint = createCheckpoint(session.id, "before edit");

    const writeResult = (await fsWriteTool.execute(
      { content: "after\n", path: "src/example.txt" },
      { messageId: "msg_test", sessionId: session.id },
    )) as any;
    expect(writeResult.success).toBe(true);
    expect(writeResult.rollbackId).toBeDefined();
    addTextMessage(session.id, "assistant", "after checkpoint");

    const restored = restoreCheckpoint(checkpoint.id);

    expect(restored).toHaveLength(1);
    expect(getSessionMessages(session.id)).toHaveLength(1);
    expect(readFileSync(filePath, "utf8")).toBe("before\n");
  });

  test("does not restore files from checkpoint when project is a git worktree", () => {
    const projectDir = makeProject();
    execFileSync("git", ["init"], { cwd: projectDir, stdio: "ignore" });
    const session = createSession({ projectDir, title: "git rollback" });
    const filePath = join(projectDir, "src", "example.txt");
    writeFileSync(filePath, "before\n");
    const checkpoint = createCheckpoint(session.id, "before edit");

    writeFileSync(filePath, "after\n");
    recordFileMutation({
      after: "after\n",
      before: "before\n",
      filePath,
      projectDir,
      reason: "test-git",
    });

    restoreCheckpoint(checkpoint.id);

    expect(readFileSync(filePath, "utf8")).toBe("after\n");
  });

  test("refuses checkpoint file rollback when current file changed after the recorded mutation", () => {
    const projectDir = makeProject();
    const session = createSession({ projectDir, title: "conflict rollback" });
    const filePath = join(projectDir, "src", "example.txt");
    writeFileSync(filePath, "before\n");
    const checkpoint = createCheckpoint(session.id, "before edit");

    writeFileSync(filePath, "after\n");
    recordFileMutation({
      after: "after\n",
      before: "before\n",
      filePath,
      projectDir,
      reason: "test-conflict",
    });
    writeFileSync(filePath, "after plus user edit\n");

    restoreCheckpoint(checkpoint.id);

    expect(readFileSync(filePath, "utf8")).toBe("after plus user edit\n");
  });

  test("removes files created after the checkpoint when project is not a git worktree", async () => {
    const projectDir = makeProject();
    const session = createSession({ projectDir, title: "created file rollback" });
    const filePath = join(projectDir, "src", "created.txt");
    const checkpoint = createCheckpoint(session.id, "before create");

    const writeResult = (await fsWriteTool.execute(
      { content: "created\n", path: "src/created.txt" },
      { messageId: "msg_test", sessionId: session.id },
    )) as any;
    expect(writeResult.success).toBe(true);
    expect(writeResult.rollbackId).toBeDefined();

    restoreCheckpoint(checkpoint.id);

    expect(existsSync(filePath)).toBe(false);
  });
});
