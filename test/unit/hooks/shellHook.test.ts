/**
 * Shell Hook 执行器单元测试。
 *
 * 覆盖场景:
 *   - 环境变量正确构建（CRAB_HOOK_EVENT, CRAB_TOOL_NAME 等）
 *   - stdin JSON 上下文传递
 *   - stdout JSON 决策解析（pass / block / replace）
 *   - 非 JSON stdout 默认放行
 *   - 空 stdout 默认放行
 *   - 非零退出码返回错误
 *   - 超时自动终止进程
 *   - 异常处理（命令不存在）
 *
 * 注意: executeShellHook 使用 command.split(/\s+/) 分割命令，
 * 因此测试中避免使用带引号的 shell 语法，改用 printenv/cat 等简单命令
 * 或临时脚本文件。
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { HookDefinition } from "@/hooks/types";
import { executeShellHook } from "@/hooks/shellHook";

/** 创建测试用 shell hook 定义 */
function makeShellHook(overrides: Partial<HookDefinition> = {}): HookDefinition {
  return {
    command: "echo '{}'",
    enabled: true,
    event: "PreToolUse",
    id: "test-shell-hook",
    name: "Test Shell Hook",
    priority: 100,
    type: "shell",
    ...overrides,
  };
}

// ─── 临时脚本目录 ─────────────────────────────────────────
const tmpDir = join(process.cwd(), ".crab", "tmp", "tests", "hook-scripts");

beforeAll(() => {
  mkdirSync(tmpDir, { recursive: true });
});

afterAll(() => {
  // 清理临时脚本
  try {
    unlinkSync(join(tmpDir, "pass.sh"));
    unlinkSync(join(tmpDir, "block.sh"));
    unlinkSync(join(tmpDir, "replace.sh"));
    unlinkSync(join(tmpDir, "fail.sh"));
    unlinkSync(join(tmpDir, "env_event.sh"));
    unlinkSync(join(tmpDir, "env_tool.sh"));
    unlinkSync(join(tmpDir, "env_session.sh"));
    unlinkSync(join(tmpDir, "env_agent.sh"));
    unlinkSync(join(tmpDir, "env_error.sh"));
  } catch {
    // 忽略清理失败
  }
});

/** 写入临时可执行脚本 */
function writeScript(name: string, content: string): string {
  const path = join(tmpDir, name);
  writeFileSync(path, content, { mode: 0o755 });
  return path;
}

describe("executeShellHook", () => {
  describe("环境变量", () => {
    test("传递 CRAB_HOOK_EVENT", async () => {
      const script = writeScript("env_event.sh", "#!/bin/bash\nprintenv CRAB_HOOK_EVENT\n");
      const hook = makeShellHook({ command: script });

      const result = await executeShellHook(hook, { event: "PreToolUse" });
      expect(result.output?.trim()).toBe("PreToolUse");
    });

    test("传递 CRAB_TOOL_NAME", async () => {
      const script = writeScript("env_tool.sh", "#!/bin/bash\nprintenv CRAB_TOOL_NAME\n");
      const hook = makeShellHook({ command: script });

      const result = await executeShellHook(hook, { event: "PreToolUse", toolName: "filesystem-write" });
      expect(result.output?.trim()).toBe("filesystem-write");
    });

    test("传递 CRAB_SESSION_ID", async () => {
      const script = writeScript("env_session.sh", "#!/bin/bash\nprintenv CRAB_SESSION_ID\n");
      const hook = makeShellHook({ command: script });

      const result = await executeShellHook(hook, { event: "SessionStart", sessionId: "Ses_abc123" });
      expect(result.output?.trim()).toBe("Ses_abc123");
    });

    test("传递 CRAB_AGENT_ID 和 CRAB_AGENT_NAME", async () => {
      const script = writeScript("env_agent.sh", "#!/bin/bash\necho $CRAB_AGENT_ID $CRAB_AGENT_NAME\n");
      const hook = makeShellHook({ command: script });

      const result = await executeShellHook(hook, {
        agentId: "agent-1",
        agentName: "researcher",
        event: "SubAgentStart",
      });
      expect(result.output?.trim()).toBe("agent-1 researcher");
    });

    test("传递 CRAB_IS_ERROR", async () => {
      const script = writeScript("env_error.sh", "#!/bin/bash\nprintenv CRAB_IS_ERROR\n");
      const hook = makeShellHook({ command: script });

      const result = await executeShellHook(hook, { event: "PostToolUse", isError: true });
      expect(result.output?.trim()).toBe("true");
    });
  });

  describe("stdin 上下文", () => {
    test("通过 stdin 传递 JSON 上下文", async () => {
      const hook = makeShellHook({ command: "cat" });

      const result = await executeShellHook(hook, {
        event: "PreToolUse",
        sessionId: "session-x",
        toolArgs: { command: "ls -la" },
        toolName: "bash",
      });

      // cat 应该将 stdin 内容原样输出到 stdout
      const parsed = JSON.parse(result.output?.trim() || "{}");
      expect(parsed.toolName).toBe("bash");
      expect(parsed.sessionId).toBe("session-x");
      expect(parsed.toolArgs.command).toBe("ls -la");
    });
  });

  describe("stdout JSON 决策解析", () => {
    test("pass 决策", async () => {
      const script = writeScript("pass.sh", '#!/bin/bash\necho \'{"decision":"pass"}\'\n');
      const hook = makeShellHook({ command: script });

      const result = await executeShellHook(hook, { event: "PreToolUse" });
      expect(result.decision.action).toBe("pass");
      expect(result.error).toBeUndefined();
    });

    test("block 决策（含 reason）", async () => {
      const script = writeScript("block.sh", '#!/bin/bash\necho \'{"decision":"block","reason":"安全检查未通过"}\'\n');
      const hook = makeShellHook({ command: script });

      const result = await executeShellHook(hook, { event: "PreToolUse" });
      expect(result.decision.action).toBe("block");
      if (result.decision.action === "block") {
        expect(result.decision.reason).toBe("安全检查未通过");
      }
    });

    test("replace 决策（含 output）", async () => {
      const script = writeScript(
        "replace.sh",
        '#!/bin/bash\necho \'{"decision":"replace","output":{"replaced":true}}\'\n',
      );
      const hook = makeShellHook({ command: script });

      const result = await executeShellHook(hook, { event: "PostToolUse" });
      expect(result.decision.action).toBe("replace");
      if (result.decision.action === "replace") {
        expect(result.decision.output).toEqual({ replaced: true });
      }
    });

    test("非 JSON stdout 默认放行", async () => {
      const hook = makeShellHook({ command: "echo some_plain_text" });

      const result = await executeShellHook(hook, { event: "PreToolUse" });
      expect(result.decision.action).toBe("pass");
      expect(result.error).toBeUndefined();
    });

    test("空 stdout 默认放行", async () => {
      const hook = makeShellHook({ command: "true" });

      const result = await executeShellHook(hook, { event: "PreToolUse" });
      expect(result.decision.action).toBe("pass");
      expect(result.error).toBeUndefined();
    });

    test("无效 JSON stdout 默认放行", async () => {
      const hook = makeShellHook({ command: "echo not_valid_json" });

      const result = await executeShellHook(hook, { event: "PreToolUse" });
      expect(result.decision.action).toBe("pass");
    });
  });

  describe("非零退出码", () => {
    test("退出码非零返回错误信息", async () => {
      const hook = makeShellHook({ command: "false" }); // false 命令退出码 1

      const result = await executeShellHook(hook, { event: "PreToolUse" });
      expect(result.error).toBeTruthy();
      expect(result.decision.action).toBe("pass"); // 容错：非零退出码默认放行
    });

    test("退出码 2 的脚本返回错误", async () => {
      const script = writeScript("fail.sh", "#!/bin/bash\nexit 2\n");
      const hook = makeShellHook({ command: script });

      const result = await executeShellHook(hook, { event: "PreToolUse" });
      expect(result.error).toBeTruthy();
      expect(result.decision.action).toBe("pass"); // 容错
    });
  });

  describe("超时控制", () => {
    test("超时自动终止进程并返回错误", async () => {
      const hook = makeShellHook({
        command: "sleep 10",
        timeout: 50, // 50ms
      });

      const result = await executeShellHook(hook, { event: "PreToolUse" });
      expect(result.error).toContain("超时");
      expect(result.decision.action).toBe("pass"); // 容错
    }, 10000);
  });

  describe("异常处理", () => {
    test("不存在的命令返回错误", async () => {
      const hook = makeShellHook({
        command: "nonexistent_command_12345",
      });

      const result = await executeShellHook(hook, { event: "PreToolUse" });
      expect(result.error).toBeTruthy();
      expect(result.decision.action).toBe("pass"); // 容错
    });
  });
});
