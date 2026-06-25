#!/usr/bin/env bun
/**
 * Crab-cli 本地开发入口脚本 — 自动开启开发模式。
 *
 * 职责:
 *   - 调用 `runCli` 启动主流程
 *   - 自动注入 `--dev` 参数，启用开发模式(更详细的日志、调试工具等)
 *   - 捕获顶层错误并以非零退出码终止进程
 *
 * 使用场景:
 *   - 仓库内本地调试与开发
 *   - 验证 `--dev` 行为路径
 */

import { runCli } from "../src/index";

const args = process.argv.slice(2);

if (!args.includes("--dev")) {
  args.push("--dev");
}

try {
  await runCli(args);
} catch (error) {
  console.error("crab-local 启动失败:", error);
  process.exit(1);
}
