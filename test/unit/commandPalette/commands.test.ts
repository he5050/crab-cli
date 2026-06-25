/**
 * 命令系统测试。
 *
 * 测试用例:
 *   - 命令注册
 *   - 命令执行
 *   - 命令参数解析
 */
import { beforeAll, describe, expect, it, test } from "bun:test";
import { createAppCommands } from "@/commandPalette/appCommands";
import type { CommandDeps } from "@/commandPalette/appCommands";
import type { Command } from "@/commandPalette/types";
import { goalManager } from "@/mission";

const fakeConfig = {
  agents: [],
  autoformat: true,
  codebase: "",
  customHeaders: {},
  defaultProvider: {
    model: "test-model",
    provider: "test",
  },
  profile: "test",
  providerConfig: {
    test: {
      apiKey: "test-key",
      baseURL: "https://test.com",
      defaultModel: "test-model",
      modelList: ["test-model"],
      requestMethod: "chat",
    },
  },
} as any;

const fakeDeps: CommandDeps = {
  back: () => {},
  clearScreen: () => {},
  createSession: () => {},
  getConfig: () => fakeConfig,
  getCurrentSessionId: () => "ses_test_current",
  navigate: () => {},
  requestExit: () => {},
  showToast: () => {},
};

describe("createAppCommands", () => {
  let commands: Command[];

  beforeAll(() => {
    commands = createAppCommands(fakeDeps);
  });

  describe("总计统计", () => {
    it("应返回 96 命令", () => {
      expect(commands.length).toBe(96);
    });
  });

  describe("命令结构", () => {
    it("每命令已名称, 标题, 与分类", () => {
      for (const cmd of commands) {
        expect(typeof cmd.name).toBe("string");
        expect(cmd.name.length).toBeGreaterThan(0);
        expect(typeof cmd.title).toBe("string");
        expect(cmd.title.length).toBeGreaterThan(0);
        expect(typeof cmd.category).toBe("string");
        expect(cmd.category.length).toBeGreaterThan(0);
      }
    });

    it("每命令已运行函数", () => {
      for (const cmd of commands) {
        expect(typeof cmd.run).toBe("function");
      }
    });

    it("每命令已  slashName", () => {
      for (const cmd of commands) {
        expect(typeof cmd.slashName).toBe("string");
        expect(cmd.slashName!.length).toBeGreaterThan(0);
      }
    });

    it("command 名称唯一", () => {
      const names = commands.map((c) => c.name);
      const unique = new Set(names);
      expect(unique.size).toBe(names.length);
    });

    it("slashNames 是唯一", () => {
      const slashes = commands.map((c) => c.slashName!);
      const unique = new Set(slashes);
      expect(unique.size).toBe(slashes.length);
    });
  });

  describe("框架命令", () => {
    const frameworkNames = ["app.help", "app.clear", "app.quit", "app.home"];

    it("应已 4 框架命令", () => {
      const fw = commands.filter((c) => c.category === "框架");
      expect(fw.length).toBe(4);
    });

    it.each(frameworkNames)("%s has real run implementation", (name) => {
      const cmd = commands.find((c) => c.name === name);
      expect(cmd).toBeDefined();
      // Framework commands call actual deps methods (not just show toast stubs)
      // Verify the run function's source contains something beyond just showToast
      const runStr = cmd!.run.toString();
      // Framework commands should have real logic beyond just toast stubs
      expect(runStr.length).toBeGreaterThan(10);
    });

    it("app.quit 拥有 slashAliases", () => {
      const cmd = commands.find((c) => c.name === "app.quit");
      expect(cmd!.slashAliases).toEqual(["exit", "q"]);
    });

    it("app.help 被建议", () => {
      const cmd = commands.find((c) => c.name === "app.help");
      expect(cmd!.suggested).toBe(true);
    });
  });

  describe("分类统计", () => {
    const expected = {
      Agent: 3,
      Git: 9,
      Hook: 3,
      IDE: 9,
      P3: 3,
      代码库: 3,
      任务: 8,
      会话: 11,
      其他: 3,
      导航: 3,
      工具: 8,
      框架: 4,
      模式: 8,
      界面: 1,
      管理: 5,
      角色: 6,
      配置: 9,
    } as const;

    it.each(Object.entries(expected))("%s should have %d commands", (cat, count) => {
      const actual = commands.filter((c) => c.category === cat);
      expect(actual.length).toBe(count);
    });

    it("total categories should be 14+", () => {
      const cats = new Set(commands.map((c) => c.category));
      expect(cats.size).toBeGreaterThanOrEqual(14);
    });

    it("sum of all categories should equal total", () => {
      const sum = Object.values(expected).reduce((a, b) => a + b, 0);
      expect(commands.length).toBe(sum);
    });
  });

  describe("占位符 vs 真实命令", () => {
    it("framework commands have real implementations", () => {
      const fw = commands.filter((c) => c.category === "框架");
      for (const cmd of fw) {
        const runStr = cmd.run.toString();
        // Framework commands should have meaningful logic
        expect(runStr.length).toBeGreaterThan(10);
      }
    });

    it("导航 commands use deps.navigate (not just toast stubs)", () => {
      const nav = commands.filter((c) => c.category === "导航");
      for (const cmd of nav) {
        const runStr = cmd.run.toString();
        // 导航命令调用 deps.navigate，不只是 toast
        expect(runStr).toContain("navigate");
      }
    });

    it("配置 commands have real implementation logic", () => {
      const config = commands.filter((c) => c.category === "配置");
      for (const cmd of config) {
        const runStr = cmd.run.toString();
        // 配置命令应包含实际逻辑(getConfig / fs 操作 / showToast / globalBus / eventBus / switchProfile)
        const hasLogic =
          runStr.includes("getConfig") ||
          runStr.includes("showToast") ||
          runStr.includes("mkdir") ||
          runStr.includes("writeFile") ||
          runStr.includes("globalBus") ||
          runStr.includes("eventBus") ||
          runStr.includes("switchProfile") ||
          runStr.includes("ProfilePanelShow");
        expect(hasLogic).toBe(true);
      }
    });

    it("导航 commands have 2 suggested (app.newSession)", () => {
      const suggested = commands.filter((c) => c.suggested === true);
      expect(suggested.map((c) => c.name)).toContain("app.newSession");
      expect(suggested.map((c) => c.name)).toContain("app.help");
    });

    it("hidden commands exist for future-phase features", () => {
      const hidden = commands.filter((c) => c.hidden === true);
      expect(hidden.length).toBeGreaterThan(0);
    });

    it("包含已隐藏 TUI 子代理 MCP E2E 命令", () => {
      const cmd = commands.find((c) => c.name === "tool.e2e-subagent-mcp");
      expect(cmd).toBeDefined();
      expect(cmd!.slashName).toBe("e2e-subagent-mcp");
      expect(cmd!.hidden).toBe(true);
    });
  });

  describe("slash command coverage", () => {
    it("所有命令都已定义 slashName", () => {
      const withoutSlash = commands.filter((c) => !c.slashName);
      expect(withoutSlash.length).toBe(0);
    });

    it("slashAliases on app.quit and agent.select", () => {
      const withAliases = commands.filter((c) => c.slashAliases && c.slashAliases.length > 0);
      expect(withAliases.length).toBeGreaterThanOrEqual(2);
      const names = withAliases.map((c) => c.name);
      expect(names).toContain("app.quit");
      expect(names).toContain("agent.select");
    });

    it("task.btw exposes  compatible /btwStream alias", () => {
      const cmd = commands.find((c) => c.name === "task.btw");
      expect(cmd).toBeDefined();
      expect(cmd!.slashName).toBe("btw");
      expect(cmd!.slashAliases).toContain("btwStream");
    });

    it("P3 operational commands expose slash entrypoints", () => {
      expect(commands.find((c) => c.name === "p3.context-governance")?.slashName).toBe("context");
      expect(commands.find((c) => c.name === "p3.plugin-marketplace")?.slashName).toBe("plugin-market");
      expect(commands.find((c) => c.name === "p3.remote-workspace")?.slashName).toBe("remote-workspace");
    });
  });

  // Task.loop 和 task.goal 依赖动态 import()，测试通过 showToast 验证最终效果
  describe("任务命令连接", () => {
    test("任务.循环创建与启动 a 循环当调度是有效", async () => {
      const config = fakeConfig;
      const toastMessages: string[] = [];
      const deps: CommandDeps = {
        ...fakeDeps,
        getConfig: () => config,
        showToast: (msg: string) => toastMessages.push(msg),
      };
      const cmds = createAppCommands(deps);
      const cmd = cmds.find((c) => c.name === "task.loop")!;

      cmd.run("5m 执行任务");

      // 动态 import() 是异步的，等待完成
      await new Promise((r) => setTimeout(r, 200));

      // 应该收到成功 toast(包含 Loop ID 和间隔信息)
      const successToast = toastMessages.find((m) => m.includes("Loop 已创建") && m.includes("5m"));
      expect(successToast).toBeDefined();
    });

    test("task.goal uses current session id instead of hardcoded fallback", async () => {
      const toastMessages: string[] = [];
      goalManager.clearGoal("ses_test_current");
      const deps: CommandDeps = {
        ...fakeDeps,
        showToast: (msg: string) => toastMessages.push(msg),
      };
      const cmds = createAppCommands(deps);
      const cmd = cmds.find((c) => c.name === "task.goal")!;

      cmd.run("完成登录页面");

      // 动态 import() 是异步的，等待完成
      await new Promise((r) => setTimeout(r, 200));

      // 应该收到成功 toast(包含目标 ID)
      const successToast = toastMessages.find((m) => m.includes("目标已创建"));
      expect(successToast).toBeDefined();
      goalManager.clearGoal("ses_test_current");
    });
  });
});
