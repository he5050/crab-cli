/**
 * CLI 命令实现 — 所有运行模式的具体执行逻辑。
 *
 * 每个命令包含:
 *   - mode: 对应的 CLI 模式
 *   - description: 命令描述
 *   - execute: 执行函数
 *   - validate: 可选的参数验证
 */

import { fileURLToPath } from "node:url";
import { safeImport } from "./orchestrator";
import { exitWithError } from "../errors";
import { registerCommand } from "./commandRegistry";
import type { CliCommand } from "./commandRegistry";

/**
 * Setup 命令 — 交互式配置向导
 */
export const setupCommand: CliCommand = {
  mode: "setup",
  description: "交互式配置向导（首次使用）",
  usage: "crab setup",
  async execute(_parsed, _deps) {
    const { setupCommand: runSetup } = await safeImport(
      () => import("@/command/config/setup"),
      "@/command/config/setup",
    );
    await runSetup();
  },
};

/**
 * Config Test 命令 — 测试 Provider 连接
 */
export const configTestCommand: CliCommand = {
  mode: "config-test",
  description: "测试 Provider 连接可用性",
  usage: "crab config test [<provider-id>]",
  validate(parsed) {
    const providerId = parsed.positionals[2];
    if (providerId !== undefined && providerId.trim() === "") {
      exitWithError("invalid-parameter", "Provider ID 不能为空", { usage: "crab config test [<provider-id>]" });
    }
  },
  async execute(parsed, _deps) {
    const providerId = parsed.positionals[2];
    const { configTestCommand: runTest } = await safeImport(
      () => import("@/command/config/test"),
      "@/command/config/test",
    );
    await runTest(providerId);
  },
};

/**
 * Config Export 命令 — 导出配置为 JSON
 */
export const configExportCommand: CliCommand = {
  mode: "config-export",
  description: "导出配置为 JSON",
  usage: "crab config export [--output <path>] [--sanitize] [--format json]",
  async execute(parsed, _deps) {
    const v = parsed.values;
    const { configExportCommand: runExport } = await safeImport(
      () => import("@/command/config/export"),
      "@/command/config/export",
    );
    await runExport({
      output: v.output as string | undefined,
      sanitize: Boolean(v.sanitize),
      format: (v.format as "json" | "pretty") || "pretty",
    });
  },
};

/**
 * Config Import 命令 — 从 JSON 导入配置
 */
export const configImportCommand: CliCommand = {
  mode: "config-import",
  description: "从 JSON 文件导入配置",
  usage: "crab config import <path> [--force] [--no-merge]",
  validate(parsed) {
    const inputPath = parsed.positionals[2];
    if (!inputPath) {
      exitWithError("invalid-parameter", "请指定要导入的配置文件路径", { usage: "crab config import <path>" });
    }
  },
  async execute(parsed, _deps) {
    const inputPath = parsed.positionals[2]!;
    const v = parsed.values;
    const { configImportCommand: runImport } = await safeImport(
      () => import("@/command/config/import"),
      "@/command/config/import",
    );
    await runImport(inputPath, {
      force: Boolean(v.force),
      merge: !v["no-merge"],
    });
  },
};

/**
 * Check Update 命令 — 检查更新
 */
export const checkUpdateCommand: CliCommand = {
  mode: "check-update",
  description: "检查更新",
  usage: "crab --update",
  async execute(_parsed, _deps) {
    const { VERSION } = await safeImport(() => import("@/config/version"), "@/config/version");
    console.log(`当前版本: crab v${VERSION}`);
    console.log("检查更新...");

    const { checkForUpdate } = await safeImport(() => import("@/core/update"), "@/core/update");
    const notice = await checkForUpdate();
    if (notice) {
      console.log(`发现新版本: v${notice.latestVersion}`);
      console.log("\n升级命令: npm install -g crab-cli@latest");
    } else {
      console.log("已是最新版本");
    }
    process.exit(0);
  },
};

/**
 * Update 命令 — 一键自动更新
 */
export const updateCommand: CliCommand = {
  mode: "update",
  description: "一键自动更新到最新版本",
  usage: "crab update",
  async execute(_parsed, _deps) {
    const { VERSION } = await safeImport(() => import("@/config/version"), "@/config/version");
    console.log(`当前版本: crab v${VERSION}`);
    console.log("正在执行自动更新...");

    const { performUpdate } = await safeImport(() => import("@/core/update"), "@/core/update");
    const result = await performUpdate();

    if (result.success) {
      console.log(`\n✓ ${result.message}`);
      if (result.toVersion) {
        console.log(`  ${result.fromVersion} → ${result.toVersion}`);
      }
    } else {
      console.log(`\n✗ ${result.message}`);
      if (result.error) {
        console.log(`  错误: ${result.error}`);
      }
      process.exit(1);
    }
    process.exit(0);
  },
};

/**
 * Schedule 命令 — 创建定时任务
 */
export const scheduleCommand: CliCommand = {
  mode: "schedule",
  description: "创建定时任务(cron 表达式)",
  usage: 'crab --schedule "0 9 * * *" "检查 PR 状态"',
  validate(parsed) {
    const cron = parsed.values.schedule as string;
    if (!cron) {
      exitWithError("invalid-parameter", "请提供 cron 表达式", {
        usage: 'crab --schedule "0 9 * * *" "任务描述"',
      });
    }
    const prompt = parsed.positionals[0];
    if (!prompt) {
      exitWithError("invalid-parameter", "请提供任务提示词", {
        usage: 'crab --schedule "0 9 * * *" "任务描述"',
      });
    }
  },
  async execute(parsed, deps) {
    const cron = parsed.values.schedule as string;
    const prompt = parsed.positionals[0]!;
    const { validateCron } = await safeImport(() => import("@/mission"), "@/mission");
    const validation = validateCron(cron);
    if (!validation.valid) {
      exitWithError("invalid-parameter", `Cron 表达式无效: ${validation.error}`, { cron });
    }

    const { createSchedule, listSchedules } = await safeImport(
      () => import("@/command/schedule/scheduleManager"),
      "@/command/schedule/scheduleManager",
    );

    const schedule = await createSchedule(cron, prompt);
    console.log(`定时任务已创建:`);
    console.log(`  ID: ${schedule.id}`);
    console.log(`  Cron: ${cron}`);
    console.log(`  提示词: ${prompt}`);
    console.log(`  下次执行: ${new Date(schedule.nextRunAt).toLocaleString("zh-CN")}`);
    console.log(`\n查看所有定时任务: crab --schedule-list`);
    process.exit(0);
  },
};

/**
 * ACP 命令 — 启动 ACP 协议服务
 */
export const acpCommand: CliCommand = {
  mode: "acp",
  description: "启动 ACP 协议服务",
  usage: "crab --acp",
  async execute(_parsed, _deps) {
    const { startAcpStdio } = await safeImport(() => import("../../server/acpStdio"), "../../server/acpStdio");
    await startAcpStdio();
  },
};

/**
 * Task List 命令 — 列出后台任务
 */
export const taskListCommand: CliCommand = {
  mode: "task-list",
  description: "列出后台任务",
  usage: "crab --task-list",
  async execute(_parsed, _deps) {
    const { listTasks, formatTaskRecordLine } = await safeImport(
      () => import("../../server/taskRunner"),
      "../../server/taskRunner",
    );
    const tasks = await listTasks();
    if (tasks.length === 0) {
      console.log("暂无后台任务");
    } else {
      for (const task of tasks) {
        console.log(formatTaskRecordLine(task));
      }
    }
    process.exit(0);
  },
};

/**
 * Task Status 命令 — 查看任务详情
 */
export const taskStatusCommand: CliCommand = {
  mode: "task-status",
  description: "查看后台任务详情",
  usage: "crab --task-status <task-id>",
  validate(parsed) {
    const taskId = parsed.values["task-status"] as string;
    if (!taskId) {
      exitWithError("invalid-parameter", "请指定任务 ID", { usage: "crab --task-status <task-id>" });
    }
  },
  async execute(parsed, _deps) {
    const taskId = parsed.values["task-status"] as string;
    const { getTask, formatTaskRecordDetail } = await safeImport(
      () => import("../../server/taskRunner"),
      "../../server/taskRunner",
    );
    const task = getTask(taskId);
    if (!task) {
      exitWithError("resource-not-found", `未找到任务: ${taskId}`, { taskId });
    }
    console.log(formatTaskRecordDetail(task));
    process.exit(0);
  },
};

const VALID_FORMATS = ["text", "json"] as const;
type ValidFormat = (typeof VALID_FORMATS)[number];

/**
 * Headless 命令 — 无头模式直接提问
 */
export const headlessCommand: CliCommand = {
  mode: "headless",
  description: "无头模式直接提问",
  usage: 'crab --ask "你的问题"',
  validate(parsed) {
    if (!parsed.values.ask) {
      exitWithError("invalid-parameter", "请提供问题内容", { usage: 'crab --ask "你的问题"' });
    }
    const format = parsed.values.format;
    if (format && !VALID_FORMATS.includes(format as ValidFormat)) {
      exitWithError("invalid-parameter", `无效的输出格式: ${format}，支持: ${VALID_FORMATS.join(", ")}`);
    }
  },
  async execute(parsed, deps) {
    const v = parsed.values;
    const sessionId = parsed.positionals[0] || (v.continue as string | undefined);
    const yolo = v.yolo === true || v["yolo-p"] === true || v["c-yolo"] === true;
    const outputFormat =
      v.format && VALID_FORMATS.includes(v.format as ValidFormat) ? (v.format as ValidFormat) : undefined;

    const { HeadlessRunner } = await safeImport(() => import("../../server/headless"), "../../server/headless");
    const runner = new HeadlessRunner(deps.eventBus);
    try {
      await runner.run(v.ask as string, {
        maxToolRounds: v["max-tool-rounds"] ? Number(v["max-tool-rounds"]) : undefined,
        mcp: v["no-mcp"] ? ("disabled" as const) : ("auto" as const),
        outputFormat,
        sessionId,
        timeout: v.timeout ? Number(v.timeout) : undefined,
        yolo,
      });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    process.exit(0);
  },
};

/**
 * Task Worker 命令 — 任务执行器（内部使用）
 */
export const taskWorkerCommand: CliCommand = {
  mode: "task-worker",
  description: "任务执行器（内部使用）",
  usage: 'crab --task-execute <id> --task "提示词"',
  async execute(parsed, deps) {
    const v = parsed.values;
    const { HeadlessRunner } = await safeImport(() => import("../../server/headless"), "../../server/headless");
    const initTaskRuntime = (await safeImport(() => import("@/mission"), "@/mission")).initTaskRuntime;
    const taskId = v["task-execute"] as string;
    const prompt = v.task as string;
    const sessionId = parsed.positionals[0] || (v.continue as string | undefined);

    initTaskRuntime(taskId);
    const runner = new HeadlessRunner(deps.eventBus);
    try {
      await runner.run(prompt, { mcp: v["no-mcp"] ? ("disabled" as const) : ("auto" as const), sessionId, taskId });
    } catch {
      // HeadlessRunner 内部已通过 headlessDeps.completeTask 处理失败回调
    }
    process.exit(0);
  },
};

/**
 * Task 命令 — 创建并启动后台任务
 */
export const taskCommand: CliCommand = {
  mode: "task",
  description: "执行后台任务",
  usage: 'crab --task "任务描述"',
  validate(parsed) {
    if (!parsed.values.task) {
      exitWithError("invalid-parameter", "请提供任务提示词", { usage: 'crab --task "任务描述"' });
    }
  },
  async execute(parsed, deps) {
    const { registerTask, setTaskPid } = await safeImport(
      () => import("../../server/taskRunner"),
      "../../server/taskRunner",
    );
    const { createId } = await safeImport(() => import("@/core/identity"), "@/core/identity");
    const taskId = createId("task");
    const prompt = parsed.values.task as string;

    registerTask(taskId, prompt);

    const child = deps.spawnProcess([process.execPath, "bin/crab.ts", "--task-execute", taskId, "--task", prompt], {
      cwd: process.cwd(),
      env: { ...process.env },
      stderr: "inherit",
      stdout: "inherit",
    });

    setTaskPid(taskId, child.pid);
    child.unref();

    console.log(`后台任务已启动: ${taskId}`);
    console.log(`查看状态: crab --task-status ${taskId}`);
    process.exit(0);
  },
};

/**
 * SSE 命令 — 启动 SSE 服务器（前台）
 */
export const sseCommand: CliCommand = {
  mode: "sse",
  description: "启动 SSE 服务器（前台）",
  usage: "crab --sse [--sse-port <port>]",
  async execute(parsed, _deps) {
    const { sseMode } = await safeImport(() => import("../../server/sseModes"), "../../server/sseModes");
    await sseMode(false, parsed.ssePort);
  },
};

/**
 * SSE Daemon 命令 — SSE 服务器后台运行
 */
export const sseDaemonCommand: CliCommand = {
  mode: "sse-daemon",
  description: "SSE 服务器后台守护进程",
  usage: "crab --sse-daemon [--sse-port <port>]",
  async execute(parsed, deps) {
    const { sseDaemonMode } = await safeImport(() => import("../../server/sseModes"), "../../server/sseModes");
    await sseDaemonMode(parsed.ssePort, {
      spawnProcess: deps.spawnProcess,
      waitForSseServerReady: deps.waitForSseServerReady,
      entryPath: fileURLToPath(import.meta.url),
    });
  },
};

/**
 * SSE Stop 命令 — 停止 SSE 服务器
 */
export const sseStopCommand: CliCommand = {
  mode: "sse-stop",
  description: "停止 SSE 服务器",
  usage: "crab --sse-stop [--sse-port <port>] [--all]",
  async execute(parsed, _deps) {
    const { sseStopMode } = await safeImport(() => import("../../server/sseModes"), "../../server/sseModes");
    await sseStopMode(parsed.ssePort, parsed.sseAll);
  },
};

/**
 * SSE Status 命令 — 查看 SSE 服务器状态
 */
export const sseStatusCommand: CliCommand = {
  mode: "sse-status",
  description: "查看 SSE 服务器状态",
  usage: "crab --sse-status [--sse-port <port>] [--all]",
  async execute(parsed, _deps) {
    const { sseStatusMode } = await safeImport(() => import("../../server/sseModes"), "../../server/sseModes");
    await sseStatusMode(parsed.ssePort, parsed.sseAll);
  },
};

/**
 * TUI 命令 — 启动 TUI 交互界面（默认模式）
 */
export const tuiCommand: CliCommand = {
  mode: "tui",
  description: "启动 TUI 交互界面",
  usage: "crab",
  async execute(parsed, deps) {
    const { runTui } = await safeImport(() => import("./tuiRunner"), "./tuiRunner");
    await runTui(deps, { parsed });
  },
};

/**
 * MCP Search 命令 — 搜索 MCP 服务器目录
 */
export const mcpSearchCommand: CliCommand = {
  mode: "mcp-search",
  description: "搜索 MCP 服务器目录",
  usage: "crab mcp search [<keyword>]",
  async execute(parsed, _deps) {
    const keyword = parsed.positionals[2];
    const { mcpSearchCommand: runSearch } = await safeImport(
      () => import("@/command/mcp/mcpCommands"),
      "@/command/mcp/mcpCommands",
    );
    await runSearch(keyword);
    process.exit(0);
  },
};

/**
 * MCP Install 命令 — 安装 MCP 服务器到配置
 */
export const mcpInstallCommand: CliCommand = {
  mode: "mcp-install",
  description: "安装 MCP 服务器到配置",
  usage: "crab mcp install <name>",
  validate(parsed) {
    const name = parsed.positionals[2];
    if (!name) {
      exitWithError("invalid-parameter", "请指定要安装的 MCP 服务器名称", { usage: "crab mcp install <name>" });
    }
  },
  async execute(parsed, _deps) {
    const name = parsed.positionals[2]!;
    const { mcpInstallCommand: runInstall } = await safeImport(
      () => import("@/command/mcp/mcpCommands"),
      "@/command/mcp/mcpCommands",
    );
    await runInstall(name);
    process.exit(0);
  },
};

/**
 * Agent Generate 命令 — 通过自然语言描述生成 Agent
 */
export const agentGenerateCommand: CliCommand = {
  mode: "agent-generate",
  description: "通过自然语言描述生成 Agent 配置",
  usage: 'crab agent generate "描述你想要的 Agent"',
  validate(parsed) {
    const description = parsed.positionals[3];
    if (!description) {
      exitWithError("invalid-parameter", "请提供 Agent 描述", {
        usage: 'crab agent generate "描述你想要的 Agent"',
      });
    }
  },
  async execute(parsed, _deps) {
    const description = parsed.positionals[3]!;
    const { generateAgentCommand } = await safeImport(() => import("@/agent/generator"), "@/agent/generator");
    await generateAgentCommand(description);
    process.exit(0);
  },
};

/**
 * 注册所有预定义命令到命令注册表。
 * 在模块导入时自动执行。
 */
function registerAllCommands(): void {
  const commands: CliCommand[] = [
    setupCommand,
    configTestCommand,
    configExportCommand,
    configImportCommand,
    mcpSearchCommand,
    mcpInstallCommand,
    agentGenerateCommand,
    // help 和 version 由 executeMode 硬编码拦截，不走注册表
    checkUpdateCommand,
    updateCommand,
    scheduleCommand,
    acpCommand,
    taskListCommand,
    taskStatusCommand,
    headlessCommand,
    taskWorkerCommand,
    taskCommand,
    sseCommand,
    sseDaemonCommand,
    sseStopCommand,
    sseStatusCommand,
    tuiCommand,
  ];
  for (const cmd of commands) {
    registerCommand(cmd);
  }
}

registerAllCommands();
