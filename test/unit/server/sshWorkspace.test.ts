/**
 * SSH RemoteWorkspace 单元测试 — 路径解析、验证、配置导出。
 */
import { describe, expect, test } from "bun:test";

// ── 辅助 ──────────────────────────────────────────────────

function createRemoteWorkspaceConfig(
  overrides?: Partial<{
    id: string;
    name: string;
    remotePath: string;
    localCachePath?: string;
    connection: { host: string; port?: number; username?: string };
  }>,
): {
  id: string;
  name: string;
  remotePath: string;
  localCachePath?: string;
  connection: { host: string; port?: number; username?: string };
} {
  return {
    id: overrides?.id ?? "ws-001",
    name: overrides?.name ?? "My Workspace",
    remotePath: overrides?.remotePath ?? "/home/user/project",
    localCachePath: overrides?.localCachePath,
    connection: {
      host: overrides?.connection?.host ?? "192.168.1.1",
      port: overrides?.connection?.port ?? 22,
      username: overrides?.connection?.username ?? "deploy",
    },
  };
}

// ── 测试 ──────────────────────────────────────────────────

describe("RemoteWorkspace", () => {
  test("构造函数正确初始化属性", () => {
    const { RemoteWorkspace } = require("@/server/ssh/workspace");
    const ws = new RemoteWorkspace(createRemoteWorkspaceConfig());

    expect(ws.id).toBe("ws-001");
    expect(ws.name).toBe("My Workspace");
    expect(ws.remotePath).toBe("/home/user/project");
    expect(ws.connection.host).toBe("192.168.1.1");
  });

  describe("resolvePath", () => {
    test("相对路径解析为绝对路径", () => {
      const { RemoteWorkspace } = require("@/server/ssh/workspace");
      const ws = new RemoteWorkspace(createRemoteWorkspaceConfig({ remotePath: "/data/app" }));

      expect(ws.resolvePath("file.txt")).toBe("/data/app/file.txt");
      expect(ws.resolvePath("src/index.ts")).toBe("/data/app/src/index.ts");
    });

    test("绝对路径保持不变（去掉前导 /）", () => {
      const { RemoteWorkspace } = require("@/server/ssh/workspace");
      const ws = new RemoteWorkspace(createRemoteWorkspaceConfig({ remotePath: "/data/app" }));

      expect(ws.resolvePath("/etc/config")).toBe("/data/app/etc/config");
    });

    test("以 / 开头的相对路径去掉前导 /", () => {
      const { RemoteWorkspace } = require("@/server/ssh/workspace");
      const ws = new RemoteWorkspace(createRemoteWorkspaceConfig({ remotePath: "/data/app" }));

      expect(ws.resolvePath("/logs/app.log")).toBe("/data/app/logs/app.log");
    });

    test("尾随 / 的路径正确拼接", () => {
      const { RemoteWorkspace } = require("@/server/ssh/workspace");
      const ws = new RemoteWorkspace(createRemoteWorkspaceConfig({ remotePath: "/data/" }));

      expect(ws.resolvePath("file.txt")).toBe("/data/file.txt");
    });
  });

  describe("toConfig", () => {
    test("正确导出为配置对象", () => {
      const { RemoteWorkspace } = require("@/server/ssh/workspace");
      const ws = new RemoteWorkspace(
        createRemoteWorkspaceConfig({
          localCachePath: "/tmp/cache",
        }),
      );
      const config = ws.toConfig();

      expect(config.id).toBe("ws-001");
      expect(config.name).toBe("My Workspace");
      expect(config.remotePath).toBe("/home/user/project");
      expect(config.localCachePath).toBe("/tmp/cache");
      expect(config.connection.host).toBe("192.168.1.1");
    });

    test("toConfig 返回独立副本（修改不影响原对象）", () => {
      const { RemoteWorkspace } = require("@/server/ssh/workspace");
      const ws = new RemoteWorkspace(createRemoteWorkspaceConfig());
      const config = ws.toConfig();

      config.id = "modified";
      expect(ws.id).toBe("ws-001"); // 原对象不受影响
    });
  });

  describe("createRemoteWorkspace", () => {
    test("便捷函数创建实例", () => {
      const { createRemoteWorkspace, RemoteWorkspace } = require("@/server/ssh/workspace");
      const ws = createRemoteWorkspace(createRemoteWorkspaceConfig({ name: "Test" }));

      expect(ws).toBeInstanceOf(RemoteWorkspace);
      expect(ws.name).toBe("Test");
    });
  });
});
