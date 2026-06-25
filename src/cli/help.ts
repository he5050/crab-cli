/**
 * CLI 帮助模块 — 构造 CLI 顶层帮助文本。
 *
 * 职责:
 *   - 输出 crab 命令的完整使用说明
 *   - "用法"部分从命令注册表动态生成（自动同步新增命令）
 *   - "选项"部分为静态内容（CLI 标志不属于命令）
 *
 * 模块功能:
 *   - getHelpText: 返回帮助字符串
 */
import { getAllCommands } from "./core/commandRegistry";

/**
 * 硬编码的命令 — help 和 version 由 executeMode 硬编码拦截，不经过注册表。
 * 为保持 help 文本完整性，在此补充。
 */
const HARDCODED_COMMANDS: Array<{ usage: string; description: string }> = [
  { usage: "crab", description: "启动 TUI 界面" },
  { usage: "crab -h / --help", description: "显示帮助" },
  { usage: "crab --version", description: "显示版本" },
  { usage: "crab setup", description: "初始化配置向导" },
  { usage: "crab update", description: "一键自动更新到最新版本" },
  { usage: "crab config test", description: "测试当前模型配置" },
  { usage: "crab config export", description: "导出配置" },
  { usage: "crab config import", description: "导入配置" },
  { usage: "crab mcp search [<keyword>]", description: "搜索 MCP 服务器目录" },
  { usage: "crab mcp install <name>", description: "安装 MCP 服务器到配置" },
  { usage: 'crab agent generate "描述"', description: "通过自然语言描述生成 Agent" },
  { usage: 'crab --schedule "0 9 * * *" "任务"', description: "创建定时任务(cron)" },
  { usage: "crab --ask <prompt>", description: "直接提问(无头模式)" },
  { usage: "crab --sse", description: "启动 SSE 服务器" },
  { usage: "crab --acp", description: "启动 ACP 协议服务" },
  { usage: "crab --task <prompt>", description: "执行后台任务" },
  { usage: "crab --continue <id>", description: "继续上次会话" },
  { usage: "crab --plan", description: "以 Plan 模式启动 TUI" },
  { usage: "crab --c-yolo [id]", description: "恢复指定/最近会话并启用 YOLO" },
  { usage: "crab --yolo", description: "YOLO 模式(自动确认所有工具调用)" },
  { usage: "crab --dev", description: "开发模式(显示调试信息)" },
];

/**
 * 动态生成命令用法行列表。
 * 按照固定顺序排列：TUI → 硬编码辅助命令 → 注册命令。
 */
function generateCommandLines(): string[] {
  const lines: string[] = [];
  const maxLen = 36; // 用法列最大宽度，用于对齐描述

  // 1. 硬编码命令
  for (const cmd of HARDCODED_COMMANDS) {
    lines.push(`  ${cmd.usage.padEnd(maxLen)}${cmd.description}`);
  }

  // 2. 从注册表动态获取已注册命令
  const registered = getAllCommands();
  for (const cmd of registered) {
    const usage = cmd.usage || `crab --${cmd.mode}`;
    lines.push(`  ${usage.padEnd(maxLen)}${cmd.description}`);
  }

  return lines;
}

/** 静态选项列表（CLI 标志，不属于命令） */
const OPTIONS_TEXT = `  --ask <prompt>           直接提问(无头模式)
  --sse                    启动 SSE 服务器
  --sse-daemon             SSE 服务器后台运行
  --sse-stop               停止 SSE 服务器
  --sse-status             查看 SSE 服务器状态
  --sse-port <port>        指定 SSE 端口，适用于 --sse / --sse-daemon / --sse-stop / --sse-status
  --all                    配合 --sse-stop / --sse-status 批量操作所有端口级 daemon
  --acp                    启动 ACP 协议服务
  --task <prompt>          执行后台任务
  --task-execute <task-id>  任务 worker 兼容执行入口
  --task-list              列出后台任务
  --task-status <task-id>  查看后台任务详情
  --continue <session-id>  继续上次会话
  --plan                   以 Plan 模式启动 TUI
  --work-dir <path>        切换工作目录后运行
  --max-tool-rounds <n>    无头模式最大工具调用轮次(默认 50)
  --timeout <ms>           无头模式超时时间(毫秒)
  --format <text|json>     无头模式输出格式
  --output <path>          配置导出输出路径(配合 config export)
  --sanitize               配置导出时脱敏敏感信息
  --force                  配置导入时强制覆盖
  --no-merge               配置导入时不合并，直接替换
  --no-mcp                 无头模式跳过 MCP runtime 启动
  --c-yolo [session-id]    恢复指定/最近会话并启用 YOLO
  --yolo                   YOLO 模式(自动确认所有工具调用)
  --yolo-p                 YOLO 模式(仅本次确认)
  --dev                    开发模式(显示调试信息)
  --update                 检查更新
  --version                显示版本
  -h, --help               显示帮助`;

export function getHelpText(version: string): string {
  const commandLines = generateCommandLines().join("\n");

  return `Crab CLI v${version} — crab-cli — AI 编程助手(Bun + OpenTUI)

用法:
${commandLines}

选项:
${OPTIONS_TEXT}`;
}

export function printHelp(version: string): void {
  console.log(getHelpText(version));
}
