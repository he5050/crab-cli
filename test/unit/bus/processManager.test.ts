/**
 * 进程管理器测试。
 *
 * 测试用例:
 *   - 命令执行
 *   - 超时终止
 *   - 输入数据写入
 *   - 命令存在检查
 */
import { describe, expect, test } from "bun:test";
import { type ProcessResult, commandExists, exec } from "@/bus/lifecycle/processManager";

describe("进程管理器", () => {
  test("执行命令并获取输出", async () => {
    const result = await exec(["echo", "hello"], { timeout: 10_000 });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello");
    expect(result.stderr).toBe("");
  });

  test("执行多参数命令", async () => {
    const result = await exec(["echo", "-n", "world"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("world");
  });

  test("超时终止进程", async () => {
    const result = await exec(["sleep", "5"], { timeout: 500 });
    expect(result.exitCode).not.toBe(0);
  });

  test("命令不存在返回非零退出码", async () => {
    const result = await exec(["nonexistent_binary_xyz_123"], { timeout: 5000 });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  test("写入输入数据", async () => {
    const result = await exec(["cat"], { input: "test input data", timeout: 5000 });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("test input data");
  });

  test("命令不存在时 commandExists 返回 false", async () => {
    const exists = await commandExists("nonexistent_xyz_123");
    expect(exists).toBe(false);
  });

  test("命令存在时 commandExists 返回 true", async () => {
    const exists = await commandExists("echo");
    expect(exists).toBe(true);
  });
});
