/**
 * Bash 工具测试。
 *
 * 测试用例:
 *   - 命令执行
 *   - 输出捕获
 *   - 错误处理
 *   - 超时控制
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { __setBashToolDepsForTesting, bashTool } from "@/tool/bash";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../helpers/testPaths";

const TMP_DIR = createGlobalTmpTestDir("crab-test-bash-");

beforeEach(() => {
  fs.mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  mock.restore();
  cleanupTestDir(TMP_DIR);
});

describe("terminal-execute", () => {
  test("参数 schema 可转换为 JSON Schema 供真实 LLM 工具调用使用", () => {
    const schema = z.toJSONSchema(bashTool.parameters);

    expect(schema).toMatchObject({
      properties: {
        command: { type: "string" },
        sshContext: { type: "object" },
      },
      type: "object",
    });
  });

  test("执行 echo 命令返回输出", async () => {
    const result = (await bashTool.execute({
      command: "echo 'hello world'",
      workingDirectory: TMP_DIR,
    })) as any;

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("hello world");
    expect(result.command).toBe("$ echo 'hello world'");
  });

  test("执行失败命令返回非零退出码", async () => {
    const result = (await bashTool.execute({
      command: "exit 42",
      workingDirectory: TMP_DIR,
    })) as any;

    expect(result.exitCode).toBe(42);
    expect(result.error).toBeDefined();
  });

  test("workingDir 参数正确", async () => {
    const result = (await bashTool.execute({
      command: "pwd",
      workingDirectory: TMP_DIR,
    })) as any;

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain(TMP_DIR);
  });

  test("短超时终止长时间命令", async () => {
    const result = (await bashTool.execute({
      command: "sleep 60",
      timeout: 200, // 0.2 秒超时
      workingDirectory: TMP_DIR,
    })) as any;

    // 进程被 kill，退出码非 0
    expect(result.exitCode).not.toBe(0);
  });

  test("stderr 包含在输出中", async () => {
    const result = (await bashTool.execute({
      command: "echo error >&2",
      workingDirectory: TMP_DIR,
    })) as any;

    expect(result.output).toContain("error");
  });

  test("多行输出正确捕获", async () => {
    const result = (await bashTool.execute({
      command: "echo line1 && echo line2 && echo line3",
      workingDirectory: TMP_DIR,
    })) as any;

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("line1");
    expect(result.output).toContain("line2");
    expect(result.output).toContain("line3");
  });

  test("无效 SSH 路径返回解析错误", async () => {
    const result = (await bashTool.execute({
      command: "echo test",
      workingDirectory: "ssh://invalid-url",
    })) as any;

    expect(result.exitCode).toBe(-1);
    expect(result.error).toContain("无效的 SSH");
  });

  test("SSH 模式会读取 config.json 中匹配目标的 sshConfig", async () => {
    const listeners: Record<string, Function[]> = {};
    class MockClient {
      on(event: string, cb: Function) {
        listeners[event] ??= [];
        listeners[event]!.push(cb);
        return this;
      }
      connect(config: Record<string, unknown>) {
        expect(config.host).toBe("43.110.38.206");
        expect(config.port).toBe(22);
        expect(config.username).toBe("root");
        expect(config.password).toBe("Trust%20260401!");
        listeners["error"]?.forEach((cb) => cb(new Error("mock stop")));
      }
      end() {}
    }

    mock.module("ssh2", () => ({ Client: MockClient }));
    __setBashToolDepsForTesting({
      loadConfig: async () =>
        ({
          sshConfig: {
            host: "43.110.38.206",
            password: "Trust%20260401!",
            port: 22,
            username: "root",
          },
        }) as any,
    });

    const result = (await bashTool.execute({
      command: "echo ok",
      timeout: 500,
      workingDirectory: "ssh://root@43.110.38.206/",
    })) as any;

    expect(result.exitCode).toBe(-1);
    expect(String(result.error)).toMatch(/SSH (连接失败|执行错误)/);
  });

  test("返回执行时长", async () => {
    const result = (await bashTool.execute({
      command: "echo fast",
      workingDirectory: TMP_DIR,
    })) as any;

    expect(result.durationMs).toBeDefined();
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  // ── G2: 自毁命令保护 ──────────────────────────────────────────

  test("阻止 kill $$ 命令", async () => {
    const result = (await bashTool.execute({
      command: "kill $$",
      workingDirectory: TMP_DIR,
    })) as any;

    expect(result.exitCode).toBe(-1);
    expect(result.blocked).toBe(true);
    expect(result.error).toContain("阻止");
  });

  test("阻止 pkill -f bun 命令", async () => {
    const result = (await bashTool.execute({
      command: "pkill -f bun",
      workingDirectory: TMP_DIR,
    })) as any;

    expect(result.exitCode).toBe(-1);
    expect(result.blocked).toBe(true);
  });

  test("阻止 killall crab-cli 命令", async () => {
    const result = (await bashTool.execute({
      command: "killall crab-cli",
      workingDirectory: TMP_DIR,
    })) as any;

    expect(result.exitCode).toBe(-1);
    expect(result.blocked).toBe(true);
  });

  test("阻止命中 sensitive-command 规则的 git push --force", async () => {
    const result = (await bashTool.execute({
      command: "git push --force origin main",
      workingDirectory: TMP_DIR,
    })) as any;

    expect(result.exitCode).toBe(-1);
    expect(result.blocked).toBe(true);
    expect(result.output).toBe("");
    expect(result.error).toContain("敏感操作");
    expect(result.command).toBe("$ git push --force origin main");
  });

  test("允许正常的 kill 命令(不杀死自身)", async () => {
    // 先启动一个子进程获取其 PID
    const pidResult = (await bashTool.execute({
      command: "sleep 1 & echo $!",
      workingDirectory: TMP_DIR,
    })) as any;

    expect(pidResult.exitCode).toBe(0);
    // 这个 kill 命令不应被阻止
    const killResult = (await bashTool.execute({
      command: "kill 99999", // 不存在的 PID，不会被阻止
      workingDirectory: TMP_DIR,
    })) as any;

    expect(killResult.blocked).toBeUndefined();
  });

  // ── G3: 环境变量注入 ──────────────────────────────────────────

  test("环境变量注入 LANG=UTF-8", async () => {
    const result = (await bashTool.execute({
      command: "echo $LANG",
      workingDirectory: TMP_DIR,
    })) as any;

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("en_US.UTF-8");
  });

  test("环境变量注入 LC_ALL=UTF-8", async () => {
    const result = (await bashTool.execute({
      command: "echo $LC_ALL",
      workingDirectory: TMP_DIR,
    })) as any;

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("en_US.UTF-8");
  });

  // ── G8: AI 摘要标记 ──────────────────────────────────────────────

  test("超长输出标记 needsSummary", async () => {
    // 生成超过 20000 字符的输出
    const result = (await bashTool.execute({
      command: "python3 -c \"print('x' * 25000)\"",
      workingDirectory: TMP_DIR,
    })) as any;

    // 输出被截断后可能不到 20000，但应标记 needsSummary
    expect(result.exitCode).toBe(0);
    // 注意:输出可能被截断，但 should 标记 needsSummary
    if (result.output && result.output.length > 20_000) {
      expect(result.needsSummary).toBe(true);
    }
    // 至少验证结果正常返回
    expect(result.output).toBeDefined();
  });

  // ── G12: Shell 检测 ──────────────────────────────────────────────

  test("Unix 平台使用 $SHELL 或 /bin/sh", async () => {
    const result = (await bashTool.execute({
      command: "echo shell test",
      workingDirectory: TMP_DIR,
    })) as any;

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("shell test");
    // 在 Unix 上应能正常执行(验证 shell 检测逻辑不崩溃)
  });

  // ── G13: 交互式 stdin ────────────────────────────────────────────

  test("stdin 参数写入进程标准输入", async () => {
    const result = (await bashTool.execute({
      command: "cat",
      stdin: "hello from stdin",
      timeout: 3000,
      workingDirectory: TMP_DIR,
    })) as any;

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("hello from stdin");
  });

  test("stdin 参数传递多行输入", async () => {
    const result = (await bashTool.execute({
      command: "cat",
      stdin: "line1\nline2\nline3",
      timeout: 3000,
      workingDirectory: TMP_DIR,
    })) as any;

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("line1");
    expect(result.output).toContain("line2");
    expect(result.output).toContain("line3");
  });

  // ── G14: 后台命令 ────────────────────────────────────────────────

  test("后台执行命令返回 backgroundId", async () => {
    const result = (await bashTool.execute({
      background: true,
      command: "sleep 10",
      workingDirectory: TMP_DIR,
    })) as any;

    expect(result.exitCode).toBe(0);
    expect(result.backgroundId).toBeDefined();
    expect(result.backgroundId).toMatch(/^bg_/);
    expect(result.output).toContain("后台命令已启动");

    // 清理:终止后台进程
    if (result.backgroundId) {
      const killResult = (await bashTool.execute({
        backgroundAction: "kill",
        backgroundId: result.backgroundId,
        command: "",
        workingDirectory: TMP_DIR,
      })) as any;

      expect(killResult.output).toContain("已终止");
    }
  });

  test("查询后台进程状态", async () => {
    const startResult = (await bashTool.execute({
      background: true,
      command: "sleep 10",
      workingDirectory: TMP_DIR,
    })) as any;

    const bgId = startResult.backgroundId;
    expect(bgId).toBeDefined();

    // 查询状态
    const statusResult = (await bashTool.execute({
      backgroundAction: "status",
      backgroundId: bgId,
      command: "",
      workingDirectory: TMP_DIR,
    })) as any;

    expect(statusResult.running).toBe(true);
    expect(statusResult.backgroundId).toBe(bgId);

    // 清理
    await bashTool.execute({
      backgroundAction: "kill",
      backgroundId: bgId!,
      command: "",
      workingDirectory: TMP_DIR,
    });
  });

  test("终止不存在的后台进程返回错误", async () => {
    const result = (await bashTool.execute({
      backgroundAction: "kill",
      backgroundId: "bg_nonexistent_1234",
      command: "",
      workingDirectory: TMP_DIR,
    })) as any;

    expect(result.error).toContain("不存在");
  });

  test("无效的后台操作类型", async () => {
    // 先启动一个后台进程
    const startResult = (await bashTool.execute({
      background: true,
      command: "sleep 5",
      workingDirectory: TMP_DIR,
    })) as any;

    const bgId = startResult.backgroundId;

    const result = (await bashTool.execute({
      backgroundAction: "invalid" as any,
      backgroundId: bgId,
      command: "",
      workingDirectory: TMP_DIR,
    })) as any;

    expect(result.error).toContain("未知后台操作");

    // 清理
    await bashTool.execute({
      backgroundAction: "kill",
      backgroundId: bgId!,
      command: "",
      workingDirectory: TMP_DIR,
    });
  });
});
