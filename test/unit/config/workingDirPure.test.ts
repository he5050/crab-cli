/**
 * Working-dir 白盒测试 — isSSHWorkingDirectory + SSH URL 生成 + 结构验证。
 *
 * 大部分函数依赖文件系统，此处测试纯逻辑部分。
 */
import { describe, expect, test } from "bun:test";
import type { SSHConfig, WorkingDirectory } from "@/config/paths/workingDir";

// 复制 isSSHWorkingDirectory 纯函数
function isSSHWorkingDirectory(dir: WorkingDirectory): boolean {
  return dir.isRemote === true && dir.path.startsWith("ssh://");
}

describe("isSSHWorkingDirectory", () => {
  test("SSH 目录返回 true", () => {
    const dir: WorkingDirectory = {
      addedAt: Date.now(),
      isDefault: false,
      isRemote: true,
      path: "ssh://root@host:22/root",
    };
    expect(isSSHWorkingDirectory(dir)).toBe(true);
  });

  test("本地目录返回 false", () => {
    const dir: WorkingDirectory = {
      addedAt: Date.now(),
      isDefault: true,
      path: "/home/user/project",
    };
    expect(isSSHWorkingDirectory(dir)).toBe(false);
  });

  test("SSH 路径但 isRemote=false 返回 false", () => {
    const dir: WorkingDirectory = {
      addedAt: Date.now(),
      isDefault: false,
      isRemote: false,
      path: "ssh://root@host:22/root",
    };
    expect(isSSHWorkingDirectory(dir)).toBe(false);
  });

  test("isRemote=true 但非 ssh:// 开头返回 false", () => {
    const dir: WorkingDirectory = {
      addedAt: Date.now(),
      isDefault: false,
      isRemote: true,
      path: "/some/local/path",
    };
    expect(isSSHWorkingDirectory(dir)).toBe(false);
  });
});

describe("SSH URL 标识符生成", () => {
  // 复制 runtime.ts 中的逻辑
  function generateSSHIdentifier(config: SSHConfig, remotePath: string): string {
    return `ssh://${config.username}@${config.host}:${config.port}${remotePath}`;
  }

  test("标准 SSH URL 格式", () => {
    const config: SSHConfig = {
      authMethod: "privateKey",
      host: "example.com",
      port: 22,
      username: "root",
    };
    const url = generateSSHIdentifier(config, "/var/www");
    expect(url).toBe("ssh://root@example.com:22/var/www");
  });

  test("自定义端口", () => {
    const config: SSHConfig = {
      authMethod: "password",
      host: "server.io",
      port: 2222,
      username: "deploy",
    };
    const url = generateSSHIdentifier(config, "/app");
    expect(url).toBe("ssh://deploy@server.io:2222/app");
  });

  test("displayName 回退格式", () => {
    const config: SSHConfig = {
      authMethod: "agent",
      host: "myhost",
      port: 22,
      username: "admin",
    };
    const remotePath = "/opt/data";
    const displayName = `${config.username}@${config.host}:${remotePath}`;
    expect(displayName).toBe("admin@myhost:/opt/data");
  });
});

describe("removeWorkingDirectories 过滤逻辑", () => {
  test("不删除默认目录", () => {
    const dirs: WorkingDirectory[] = [
      { addedAt: 1, isDefault: true, path: "/default" },
      { addedAt: 2, isDefault: false, path: "/extra" },
    ];
    const toRemove = new Set(["/default", "/extra"]);
    const filtered = dirs.filter((d) => d.isDefault || !toRemove.has(d.path));
    expect(filtered.length).toBe(1);
    expect(filtered[0]!.path).toBe("/default");
  });

  test("只删除非默认目录", () => {
    const dirs: WorkingDirectory[] = [
      { addedAt: 1, isDefault: true, path: "/default" },
      { addedAt: 2, isDefault: false, path: "/a" },
      { addedAt: 3, isDefault: false, path: "/b" },
    ];
    const toRemove = new Set(["/a"]);
    const filtered = dirs.filter((d) => d.isDefault || !toRemove.has(d.path));
    expect(filtered.length).toBe(2);
  });
});

describe("setDefaultWorkingDirectory 逻辑", () => {
  test("切换默认目录", () => {
    const dirs: WorkingDirectory[] = [
      { addedAt: 1, isDefault: true, path: "/a" },
      { addedAt: 2, isDefault: false, path: "/b" },
    ];
    // 清除旧的
    for (const d of dirs) {
      d.isDefault = false;
    }
    const target = dirs.find((d) => d.path === "/b");
    if (target) {
      target.isDefault = true;
    }
    expect(dirs[0]!.isDefault).toBe(false);
    expect(dirs[1]!.isDefault).toBe(true);
  });
});
