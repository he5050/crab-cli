/**
 * Crab-cli 生产环境入口脚本 — 启动 CLI 主流程。
 *
 * 职责:
 *   - 解析命令行参数并调用 `runCli` 派发执行
 *   - 捕获顶层错误并以友好提示输出到 stderr
 *   - 在发生错误时以非零退出码终止进程
 *
 * 使用场景:
 *   - 用户通过 `npx crab` 或全局 `crab` 命令调用
 *   - npm scripts 中作为 `bin` 字段入口
 */
import { runCli } from "../src/index";

runCli(process.argv.slice(2)).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("发生错误:", message);
  console.error("请使用 --verbose 参数运行以获取更多详细信息");
  process.exit(1);
});
