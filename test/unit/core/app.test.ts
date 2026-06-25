/**
 * 应用初始化测试。
 *
 * 测试用例:
 *   - TUI 函数导出
 *   - createTuiApp 导出
 *   - package.json 配置验证
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";

const ROOT = `${import.meta.dir}/../../..`;

describe("Phase 01 — 项目初始化 + 基础 TUI", () => {
  test("runCli 函数从 index.ts 正确导出", async () => {
    const mod = await import("@/index");
    expect(mod.runCli).toBeDefined();
    expect(typeof mod.runCli).toBe("function");
  }, 15_000);

  test("createTuiApp 从 app.tsx 正确导出", async () => {
    const mod = await import("@/app");
    expect(mod.createTuiApp).toBeDefined();
    expect(typeof mod.createTuiApp).toBe("function");
  });

  test("package.json 配置正确", async () => {
    const pkg = JSON.parse(readFileSync(`${ROOT}/package.json`, "utf8"));
    expect(pkg.name).toBe("crab-cli");
    expect(pkg.version).toBe("0.5.0");
    expect(pkg.type).toBe("module");
    expect(pkg.bin.crab).toBe("./bin/crab.ts");
    expect(pkg.dependencies["@opentui/core"]).toBeDefined();
    expect(pkg.dependencies["@opentui/solid"]).toBeDefined();
    expect(pkg.dependencies["solid-js"]).toBeDefined();
    expect(pkg.dependencies.zod).toBeDefined();
  });

  test("tsconfig 配置了 @opentui/solid JSX", async () => {
    const ts = JSON.parse(readFileSync(`${ROOT}/tsconfig.json`, "utf8"));
    expect(ts.compilerOptions.jsx).toBe("preserve");
    expect(ts.compilerOptions.jsxImportSource).toBe("@opentui/solid");
    expect(ts.compilerOptions.strict).toBe(true);
    expect(ts.compilerOptions.paths["@security"]).toEqual(["./src/security"]);
  });

  test("bunfig.toml 使用官方推荐的 preload 和测试根目录", () => {
    const bunfig = readFileSync(`${ROOT}/bunfig.toml`, "utf8");
    expect(bunfig).toContain("preload");
    expect(bunfig).toContain("@opentui/solid/preload");
    expect(bunfig).toContain("root");
    expect(bunfig).toContain("./test");
  });

  test("test/setup.ts 支持真实环境测试模式", () => {
    const setup = readFileSync(`${ROOT}/test/setup.ts`, "utf8");
    expect(setup).toContain("CRAB_REAL_ENV_TESTS");
    expect(setup).toContain("if (!realEnvTests)");
    expect(setup).toContain("process.env.XDG_CONFIG_HOME = testConfigHome");
    expect(setup).toContain("process.env.XDG_DATA_HOME = testDataHome");
  });

  test("bin/crab.ts 通过统一 CLI 入口分发参数", () => {
    const bin = readFileSync(`${ROOT}/bin/crab.ts`, "utf8");
    expect(bin).toContain("runCli");
    expect(bin).toContain("process.argv.slice(2)");
    expect(bin).not.toContain("--version");
    expect(bin).not.toContain("--help");
  });

  test("所有 Context 模块正确导出", async () => {
    const helper = await import("@/ui/contexts/helper");
    expect(helper.createSimpleContext).toBeDefined();

    const route = await import("@/ui/contexts/route");
    expect(route.useRoute).toBeDefined();
    expect(route.RouteProvider).toBeDefined();

    const theme = await import("@/ui/contexts/theme");
    expect(theme.useTheme).toBeDefined();
    expect(theme.ThemeProvider).toBeDefined();

    const exit = await import("@/ui/contexts/exit");
    expect(exit.useExit).toBeDefined();
    expect(exit.ExitProvider).toBeDefined();

    const kv = await import("@/ui/contexts/kv");
    expect(kv.useKV).toBeDefined();
    expect(kv.KVProvider).toBeDefined();

    const dialog = await import("@/ui/contexts/dialog");
    expect(dialog.useDialog).toBeDefined();
    expect(dialog.DialogProvider).toBeDefined();

    const toast = await import("@/ui/contexts/toast");
    expect(toast.useToast).toBeDefined();
    expect(toast.ToastProvider).toBeDefined();
  });

  test("活跃页面组件正确导出", async () => {
    const home = await import("@/ui/pages/home");
    expect(home.Home).toBeDefined();

    const session = await import("@/ui/pages/session");
    expect(session.Session).toBeDefined();

    const help = await import("@/ui/pages/help");
    expect(help.Help).toBeDefined();

    const pixel = await import("@/ui/pages/pixelEditor");
    expect(pixel.PixelEditor).toBeDefined();
  });

  test("CrabApp 路由分支挂载 PixelEditor 页面", () => {
    const appSource = readFileSync(`${ROOT}/src/app.tsx`, "utf8");
    expect(appSource).toContain('route.data.type === "pixel-editor"');
    expect(appSource).toContain("<PixelEditor />");
  });

  test("废弃 LogsPage 仅保留兼容导出", async () => {
    const logs = await import("@/ui/pages/logs");
    expect(logs.LogsPage).toBeDefined();

    const logsSource = readFileSync(`${ROOT}/src/ui/pages/logs.tsx`, "utf8");
    expect(logsSource).toContain("已废弃");
    expect(logsSource).toContain("不应在新代码中使用");
  });

  test("Welcome 页面仅保留兼容包装，Home 是唯一启动面", async () => {
    const welcome = await import("@/ui/pages/welcome");
    expect(welcome.Welcome).toBeDefined();

    const welcomeSource = readFileSync(`${ROOT}/src/ui/pages/welcome.tsx`, "utf8");
    expect(welcomeSource).toContain("已废弃");
    expect(welcomeSource).toContain("Home");
    expect(welcomeSource).toContain("向后兼容");
  });

  test("通用组件正确导出", async () => {
    const logo = await import("@/ui/components/logo");
    expect(logo.Logo).toBeDefined();

    const spinner = await import("@/ui/components/spinner");
    expect(spinner.Spinner).toBeDefined();

    const border = await import("@/ui/components/border");
    expect(border.Border).toBeDefined();
  });

  test("index.ts 仅在 direct run 时自动启动 tui()", () => {
    const index = readFileSync(`${ROOT}/src/index.ts`, "utf8");
    expect(index).toContain("import.meta.main");
    expect(index).toMatch(/runCli\(\)\.catch|main\(\)\.catch/);
  });

  test("index.ts 使用 createCliRenderer 渲染器", () => {
    const index = readFileSync(`${ROOT}/src/index.ts`, "utf8");
    expect(index).toContain("createCliRenderer");
    expect(index).toContain("createTuiApp");
  });

  test("UI 文案使用中文", () => {
    const session = readFileSync(`${ROOT}/src/ui/pages/session/index.tsx`, "utf8");
    expect(session).toContain("新对话");
    expect(session).toContain("输入消息，Enter 发送，@ 添加上下文");

    const messageList = readFileSync(`${ROOT}/src/ui/pages/session/panels/MessageListView.tsx`, "utf8");
    expect(messageList).toContain("输入消息开始对话");

    const promptArea = readFileSync(`${ROOT}/src/ui/pages/session/panels/SessionPromptArea.tsx`, "utf8");
    expect(promptArea).toContain("session_prompt");

    const promptInput = readFileSync(`${ROOT}/src/ui/pages/session/components/promptInput.tsx`, "utf8");
    expect(promptInput).toContain("Enter 发送");

    const logo = readFileSync(`${ROOT}/src/ui/components/logo.tsx`, "utf8");
    expect(logo).toContain("终端智能编程助手");
  });

  test("Logo 使用 VERSION 常量而非硬编码", () => {
    const logo = readFileSync(`${ROOT}/src/ui/components/logo.tsx`, "utf8");
    expect(logo).toContain("VERSION");
    expect(logo).not.toContain("v0.1.0");
  });

  test("index.ts 使用 deps 对象组装依赖", () => {
    const index = readFileSync(`${ROOT}/src/index.ts`, "utf8");
    expect(index).toContain("const deps: CliOrchestratorDeps");
    expect(index).toContain("setOrchestratorDeps(deps)");
  });

  test("index.ts 接入全局清理", () => {
    const index = readFileSync(`${ROOT}/src/index.ts`, "utf8");
    expect(index).toContain("runCleanup");
  });

  test("README 反映当前真实 CLI / TUI / VSIX 能力面", () => {
    const readme = readFileSync(`${ROOT}/README.md`, "utf8");
    expect(readme).toContain("Crab CLI");
    expect(readme).toContain("bun run build");
    expect(readme).toContain("bun test");
    expect(readme).toContain("crab --ask");
    expect(readme).toContain("crab --task");
    expect(readme).toContain("crab --task-list");
    expect(readme).toContain("SSE");
    expect(readme).toContain("ACP");
    expect(readme).toContain("VSIX");
    expect(readme).not.toContain("This project was created using `bun init`");
    expect(readme).not.toContain("bun run index.ts");
  });
});
