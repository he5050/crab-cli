/**
 * Sensitive-command 白盒测试 — 危险命令检测、自毁检测、输出截断。
 * 仅测试纯函数(无文件 I/O)。
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  addSensitiveCommand,
  checkSensitiveCommand,
  getAllSensitiveCommands,
  isDangerousCommand,
  isSelfDestructiveCommand,
  isSensitiveCommand,
  removeSensitiveCommand,
  resetSensitiveCommands,
  toggleSensitiveCommand,
  truncateOutput,
} from "@/permission/security/sensitiveCommand";

const originalHome = process.env.HOME;
const originalCwd = process.cwd();
let isolatedRoot = "";

beforeEach(() => {
  isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "crab-sensitive-test-"));
  process.env.HOME = path.join(isolatedRoot, "home");
  fs.mkdirSync(process.env.HOME, { recursive: true });

  const projectDir = path.join(isolatedRoot, "project");
  fs.mkdirSync(projectDir, { recursive: true });
  process.chdir(projectDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome !== undefined) {
    process.env.HOME = originalHome;
  } else {
    delete process.env.HOME;
  }
  fs.rmSync(isolatedRoot, { force: true, recursive: true });
  isolatedRoot = "";
});

describe("isDangerousCommand", () => {
  test("rm -rf 检测", () => {
    expect(isDangerousCommand("rm -rf /home")).toBe(true);
  });
  test("mkfs 检测", () => {
    expect(isDangerousCommand("mkfs /dev/sda1")).toBe(true);
  });
  test("dd 磁盘操作检测", () => {
    expect(isDangerousCommand("dd if=/dev/zero of=/dev/sda")).toBe(true);
  });
  test("fork bomb 检测", () => {
    expect(isDangerousCommand(":(){ :|:& };:")).toBe(true);
  });
  test("正常命令不触发", () => {
    expect(isDangerousCommand("ls -la")).toBe(false);
  });
  test("git status 不触发", () => {
    expect(isDangerousCommand("git status")).toBe(false);
  });
  test("echo 不触发", () => {
    expect(isDangerousCommand("echo hello")).toBe(false);
  });
});

describe("isSelfDestructiveCommand", () => {
  test("killall node", () => {
    const r = isSelfDestructiveCommand("killall node");
    expect(r.isSelfDestructive).toBe(true);
    expect(r.reason).toBeDefined();
  });

  test("pkill bun", () => {
    expect(isSelfDestructiveCommand("pkill bun").isSelfDestructive).toBe(true);
  });

  test("pkill crab-cli", () => {
    expect(isSelfDestructiveCommand("pkill crab-cli").isSelfDestructive).toBe(true);
  });

  test("taskkill node.exe", () => {
    expect(isSelfDestructiveCommand("taskkill /f /im node.exe").isSelfDestructive).toBe(true);
  });

  test("Stop-Process 节点", () => {
    expect(isSelfDestructiveCommand("Stop-Process -Name node").isSelfDestructive).toBe(true);
  });

  test("正常命令", () => {
    expect(isSelfDestructiveCommand("ls").isSelfDestructive).toBe(false);
  });

  test("kill 指定其他 PID 不触发", () => {
    expect(isSelfDestructiveCommand("kill 12345").isSelfDestructive).toBe(false);
  });
});

describe("truncateOutput", () => {
  test("超长输出截断", () => {
    const result = truncateOutput("a".repeat(200), 100);
    expect(result.length).toBeLessThanOrEqual(120); // 含截断后缀
    expect(result.endsWith("... (输出已截断)")).toBe(true);
  });

  test("短文本不截断", () => {
    expect(truncateOutput("short", 100)).toBe("short");
  });

  test("空字符串", () => {
    expect(truncateOutput("", 100)).toBe("");
  });

  test("恰好等于 maxLength", () => {
    expect(truncateOutput("a".repeat(100), 100)).toBe("a".repeat(100));
  });
});

describe("checkSensitiveCommand", () => {
  test("危险命令返回 block", () => {
    const result = checkSensitiveCommand("rm -rf /home");
    expect(result.isSensitive).toBe(true);
    expect(result.action).toBe("block");
  });

  test("自毁命令返回 block", () => {
    const result = checkSensitiveCommand("killall node");
    expect(result.isSensitive).toBe(true);
    expect(result.action).toBe("block");
  });

  test("正常命令不敏感", () => {
    const result = checkSensitiveCommand("echo hello");
    expect(result.isSensitive).toBe(false);
  });

  test("普通启用敏感命令返回 confirm 并带匹配信息", () => {
    const result = checkSensitiveCommand("rm file.txt");
    expect(result).toMatchObject({
      action: "confirm",
      isSensitive: true,
      matchedPattern: "rm ",
    });
  });
});

describe("敏感命令配置与匹配边界", () => {
  test("添加项目级命令会写入当前项目 .crab 配置", () => {
    addSensitiveCommand("project-write", "项目配置写入", "project");

    const projectConfigPath = path.join(process.cwd(), ".crab", "sensitive-commands.json");
    expect(JSON.parse(fs.readFileSync(projectConfigPath, "utf8"))).toMatchObject({
      commands: [
        expect.objectContaining({
          description: "项目配置写入",
          enabled: true,
          isPreset: false,
          pattern: "project-write",
        }),
      ],
    });
  });

  test("项目级命令与全局命令合并，并能匹配组合命令", () => {
    addSensitiveCommand("danger-project", "项目危险命令", "project");

    const all = getAllSensitiveCommands();
    expect(all).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pattern: "rm ", scope: "global" }),
        expect.objectContaining({ pattern: "danger-project", scope: "project" }),
      ]),
    );

    expect(isSensitiveCommand("echo ok && danger-project --force")).toMatchObject({
      isSensitive: true,
      matchedCommand: expect.objectContaining({ pattern: "danger-project", scope: "project" }),
    });
  });

  test("重复 pattern 会跨 global/project 拒绝添加", () => {
    expect(() => addSensitiveCommand(" rm ", "project duplicate", "project")).toThrow("DUPLICATE:global");
  });

  test("toggleSensitiveCommand 可禁用再启用项目命令", () => {
    addSensitiveCommand("toggle-me", "可切换命令", "project");

    expect(isSensitiveCommand("toggle-me now").isSensitive).toBe(true);
    const { id } = getAllSensitiveCommands().find((cmd) => cmd.pattern === "toggle-me")!;

    toggleSensitiveCommand(id, "project");
    expect(isSensitiveCommand("toggle-me now").isSensitive).toBe(false);

    toggleSensitiveCommand(id, "project");
    expect(isSensitiveCommand("toggle-me now").isSensitive).toBe(true);
  });

  test("removeSensitiveCommand 未指定 scope 时能删除项目命令", () => {
    addSensitiveCommand("remove-me", "删除测试", "project");
    const { id } = getAllSensitiveCommands().find((cmd) => cmd.pattern === "remove-me")!;

    removeSensitiveCommand(id);

    expect(getAllSensitiveCommands().some((cmd) => cmd.id === id)).toBe(false);
    expect(isSensitiveCommand("remove-me now").isSensitive).toBe(false);
  });

  test("resetSensitiveCommands(project) 只清空项目命令，不清空全局预设", () => {
    addSensitiveCommand("project-only", "项目命令", "project");
    resetSensitiveCommands("project");

    expect(getAllSensitiveCommands().some((cmd) => cmd.pattern === "project-only")).toBe(false);
    expect(getAllSensitiveCommands().some((cmd) => cmd.pattern === "rm " && cmd.scope === "global")).toBe(true);
  });

  test("通配符引擎安全处理多通配符模式", () => {
    const projectConfigPath = path.join(process.cwd(), ".crab", "sensitive-commands.json");
    fs.mkdirSync(path.dirname(projectConfigPath), { recursive: true });
    fs.writeFileSync(
      projectConfigPath,
      JSON.stringify(
        {
          commands: [
            {
              description: "多通配符模式（通配符引擎安全处理）",
              enabled: true,
              id: "multi-wildcard",
              isPreset: false,
              pattern: "a*b*c*d*",
            },
            {
              description: "有效模式",
              enabled: true,
              id: "valid-command",
              isPreset: false,
              pattern: "valid-danger",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    // 通配符引擎内置递归深度限制（DEFAULT_MAX_DEPTH=50），多通配符模式可安全匹配
    expect(isSensitiveCommand("a123b456c789d0")).toMatchObject({
      isSensitive: true,
      matchedCommand: expect.objectContaining({ id: "multi-wildcard" }),
    });
    expect(isSensitiveCommand("valid-danger --run")).toMatchObject({
      isSensitive: true,
      matchedCommand: expect.objectContaining({ id: "valid-command" }),
    });
  });
});
