/**
 * 命令注册表测试。
 *
 * 测试用例:
 *   - 命令发现
 *   - 命令列表
 *   - 命令元数据
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { getCommandRegistry } from "@/commandPalette/registry";
import type { Command } from "@/commandPalette/types";
import { globalBus } from "@/bus";
import { AppEvent } from "@/bus";

function mkCmd(
  name: string,
  category: string,
  opts?: { slashName?: string; slashAliases?: string[]; run?: () => void },
): Command {
  return {
    category,
    name,
    run: opts?.run ?? (() => {}),
    slashAliases: opts?.slashAliases,
    slashName: opts?.slashName,
    title: name.toUpperCase(),
  };
}

describe("CommandRegistry", () => {
  beforeEach(() => {
    getCommandRegistry().clear();
  });

  describe("注册 / 注销 / 获取", () => {
    it("should register and retrieve a command", () => {
      const cmd = mkCmd("foo", "test");
      getCommandRegistry().register(cmd);
      expect(getCommandRegistry().get("foo")).toBe(cmd);
    });

    it("should return undefined for unregistered command", () => {
      expect(getCommandRegistry().get("nonexistent")).toBeUndefined();
    });

    it("应注销命令", () => {
      const cmd = mkCmd("bar", "test");
      getCommandRegistry().register(cmd);
      getCommandRegistry().unregister("bar");
      expect(getCommandRegistry().get("bar")).toBeUndefined();
    });

    it("should remove slash index on unregister", () => {
      const cmd = mkCmd("help", "framework", { slashName: "help" });
      getCommandRegistry().register(cmd);
      expect(getCommandRegistry().getBySlash("/help")).toBe(cmd);
      getCommandRegistry().unregister("help");
      expect(getCommandRegistry().getBySlash("/help")).toBeUndefined();
    });
  });

  describe("registerAll", () => {
    it("应注册多个命令", () => {
      const cmds = [mkCmd("a", "cat1"), mkCmd("b", "cat2"), mkCmd("c", "cat1")];
      getCommandRegistry().registerAll(cmds);
      expect(getCommandRegistry().get("a")).toBe(cmds[0]);
      expect(getCommandRegistry().get("b")).toBe(cmds[1]);
      expect(getCommandRegistry().get("c")).toBe(cmds[2]);
    });

    it("应处理空数组", () => {
      getCommandRegistry().registerAll([]);
      expect(getCommandRegistry().listAll().length).toBe(0);
    });
  });

  describe("getBySlash", () => {
    it("should find command by slashName (with leading /)", () => {
      const cmd = mkCmd("help", "framework", { slashName: "help" });
      getCommandRegistry().register(cmd);
      expect(getCommandRegistry().getBySlash("/help")).toBe(cmd);
    });

    it("should find command by slashName (without leading /)", () => {
      const cmd = mkCmd("build", "build", { slashName: "build" });
      getCommandRegistry().register(cmd);
      expect(getCommandRegistry().getBySlash("build")).toBe(cmd);
    });

    it("应匹配通过 slashAliases", () => {
      const cmd = mkCmd("verbose", "test", { slashAliases: ["v"], slashName: "verbose" });
      getCommandRegistry().register(cmd);
      expect(getCommandRegistry().getBySlash("/v")).toBe(cmd);
    });

    it("should return undefined for unknown slash", () => {
      expect(getCommandRegistry().getBySlash("/unknown")).toBeUndefined();
    });
  });

  describe("listByCategory", () => {
    it("应列表命令通过分类", () => {
      getCommandRegistry().registerAll([mkCmd("a", "cat1"), mkCmd("b", "cat2"), mkCmd("c", "cat1")]);
      const cat1 = getCommandRegistry().listByCategory("cat1");
      expect(cat1.map((c) => c.name)).toEqual(["a", "c"]);
    });

    it("应返回空数组为未知分类", () => {
      getCommandRegistry().register(mkCmd("a", "cat1"));
      expect(getCommandRegistry().listByCategory("unknown")).toEqual([]);
    });
  });

  describe("listAll / listSlashCommands", () => {
    it("应列表全部已注册命令", () => {
      const cmds = [mkCmd("a", "cat1"), mkCmd("b", "cat2")];
      getCommandRegistry().registerAll(cmds);
      expect(getCommandRegistry().listAll()).toEqual(cmds);
    });

    it("应返回空数组当无命令", () => {
      expect(getCommandRegistry().listAll()).toEqual([]);
    });

    it("应列表仅命令带 slashName", () => {
      getCommandRegistry().registerAll([
        mkCmd("build", "build", { slashName: "build" }),
        mkCmd("clean", "build", { slashName: "clean" }),
        mkCmd("noop", "misc"),
      ]);
      const slashCmds = getCommandRegistry().listSlashCommands();
      expect(slashCmds.length).toBe(2);
      expect(slashCmds.map((c) => c.name)).toEqual(["build", "clean"]);
    });

    it("should return empty when no slash commands", () => {
      getCommandRegistry().registerAll([mkCmd("a", "cat1"), mkCmd("b", "cat2")]);
      expect(getCommandRegistry().listSlashCommands()).toEqual([]);
    });
  });

  describe("执行 / executeSlash", () => {
    it("应执行命令通过名称", async () => {
      let called = false;
      getCommandRegistry().register(
        mkCmd("run", "test", {
          run: () => {
            called = true;
          },
        }),
      );
      await getCommandRegistry().execute("run");
      expect(called).toBe(true);
    });

    it("should not throw for unknown command (returns silently)", async () => {
      await expect(getCommandRegistry().execute("nope")).resolves.toBeUndefined();
    });

    it("should catch and log execution errors", async () => {
      const messages: string[] = [];
      const unsub = globalBus.subscribe(AppEvent.Toast, (evt) => {
        messages.push(evt.properties.message);
      });
      getCommandRegistry().register(
        mkCmd("fail", "test", {
          run: () => {
            throw new Error("boom");
          },
        }),
      );
      await expect(getCommandRegistry().execute("fail")).resolves.toBeUndefined();
      expect(messages.some((message) => message.includes("命令执行失败: fail"))).toBe(true);
      unsub();
    });

    it("should execute via slash command", async () => {
      let called = false;
      getCommandRegistry().register(
        mkCmd("status", "test", {
          run: () => {
            called = true;
          },
          slashName: "status",
        }),
      );
      const result = await getCommandRegistry().executeSlash("/status");
      expect(result).toBe(true);
      expect(called).toBe(true);
    });

    it("should execute via slash alias", async () => {
      let called = false;
      getCommandRegistry().register(
        mkCmd("verbose", "test", {
          run: () => {
            called = true;
          },
          slashAliases: ["v"],
          slashName: "verbose",
        }),
      );
      const result = await getCommandRegistry().executeSlash("/v");
      expect(result).toBe(true);
      expect(called).toBe(true);
    });

    it("should return false for unknown slash command", async () => {
      const result = await getCommandRegistry().executeSlash("/nope");
      expect(result).toBe(false);
    });

    it("should publish toast when slash command fails", async () => {
      const messages: string[] = [];
      const unsub = globalBus.subscribe(AppEvent.Toast, (evt) => {
        messages.push(evt.properties.message);
      });
      getCommandRegistry().register(
        mkCmd("explode", "test", {
          run: () => {
            throw new Error("bad slash");
          },
          slashName: "explode",
        }),
      );

      const result = await getCommandRegistry().executeSlash("/explode");

      expect(result).toBe(false);
      expect(messages.some((message) => message.includes("命令执行失败: /explode"))).toBe(true);
      unsub();
    });
  });

  describe("清空", () => {
    it("should remove all commands and slash indices", () => {
      getCommandRegistry().registerAll([
        mkCmd("a", "cat1", { slashName: "a" }),
        mkCmd("b", "cat2", { slashName: "b" }),
      ]);
      getCommandRegistry().clear();
      expect(getCommandRegistry().listAll().length).toBe(0);
      expect(getCommandRegistry().get("a")).toBeUndefined();
      expect(getCommandRegistry().get("b")).toBeUndefined();
      expect(getCommandRegistry().getBySlash("/a")).toBeUndefined();
      expect(getCommandRegistry().getBySlash("/b")).toBeUndefined();
    });
  });

  describe("命令覆盖", () => {
    it("should allow re-registering a command (override)", () => {
      const cmd1 = mkCmd("build", "old", { run: () => {} });
      const cmd2 = mkCmd("build", "new", { run: () => {} });
      getCommandRegistry().register(cmd1);
      getCommandRegistry().register(cmd2);
      expect(getCommandRegistry().get("build")).toBe(cmd2);
      expect(getCommandRegistry().listAll().length).toBe(1);
    });

    it("should update slash index on override", () => {
      let oldCalled = false;
      let newCalled = false;
      const cmd1 = mkCmd("build", "old", {
        run: () => {
          oldCalled = true;
        },
        slashName: "build",
      });
      const cmd2 = mkCmd("build", "new", {
        run: () => {
          newCalled = true;
        },
        slashName: "build",
      });
      getCommandRegistry().register(cmd1);
      getCommandRegistry().register(cmd2);
      const found = getCommandRegistry().getBySlash("/build");
      expect(found).toBe(cmd2);
    });

    it("should remove old slash aliases when overriding a command", () => {
      const cmd1 = mkCmd("deploy", "old", {
        slashAliases: ["d", "ship"],
        slashName: "deploy",
      });
      const cmd2 = mkCmd("deploy", "new", {
        slashAliases: ["r"],
        slashName: "release",
      });

      getCommandRegistry().register(cmd1);
      getCommandRegistry().register(cmd2);

      expect(getCommandRegistry().getBySlash("/deploy")).toBeUndefined();
      expect(getCommandRegistry().getBySlash("/d")).toBeUndefined();
      expect(getCommandRegistry().getBySlash("/ship")).toBeUndefined();
      expect(getCommandRegistry().getBySlash("/release")).toBe(cmd2);
      expect(getCommandRegistry().getBySlash("/r")).toBe(cmd2);
    });
  });

  describe("统计", () => {
    it("should return 0 initially (after clear)", () => {
      getCommandRegistry().clear();
      expect(getCommandRegistry().listAll().length).toBe(0);
    });

    it("should reflect registered count", () => {
      getCommandRegistry().registerAll([mkCmd("a", "cat1"), mkCmd("b", "cat2"), mkCmd("c", "cat1")]);
      expect(getCommandRegistry().listAll().length).toBe(3);
    });

    it("应不变更上覆盖", () => {
      getCommandRegistry().register(mkCmd("x", "cat1"));
      getCommandRegistry().register(mkCmd("x", "cat2"));
      expect(getCommandRegistry().listAll().length).toBe(1);
    });
  });

  describe("usage stats and frecency", () => {
    it("should initialize and update usage stats when executing commands", async () => {
      const cmd = mkCmd("recent", "test");
      getCommandRegistry().register(cmd);

      expect(getCommandRegistry().getUsageStats("recent")).toEqual({
        count: 0,
        lastUsed: 0,
      });

      await getCommandRegistry().execute("recent");

      const stats = getCommandRegistry().getUsageStats("recent");
      expect(stats?.count).toBe(1);
      expect(stats?.lastUsed).toBeGreaterThan(0);
    });

    it("should sort commands with higher frecency ahead of unused commands", async () => {
      const used = mkCmd("used", "test");
      const unused = mkCmd("unused", "test");
      getCommandRegistry().registerAll([unused, used]);

      await getCommandRegistry().execute("used");

      const sorted = getCommandRegistry().sortByFrecency([unused, used]);
      expect(sorted[0]).toBe(used);
      expect(sorted[1]).toBe(unused);
    });

    it("should keep insertion order when compared commands are all unused", () => {
      const first = mkCmd("first", "test");
      const second = mkCmd("second", "test");
      getCommandRegistry().registerAll([first, second]);

      expect(getCommandRegistry().sortByFrecency([first, second])).toEqual([first, second]);
    });
  });
});
