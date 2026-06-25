/**
 * ConnectionManager 测试套件
 *
 * 说明:
 *   - 供多个测试入口复用，避免 31Connection / 50Connection 目录出现重复实现漂移
 *   - 保留原有测试行为与断言，不改变覆盖面
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ConnectionManager } from "@/server/connection/manager/connectionManager";
import type { ConnectionConfig } from "@/server/connection/types";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function registerConnectionManagerSuite(): void {
  describe("ConnectionManager — 连接管理器", () => {
    let manager: ConnectionManager;
    let testDir: string;

    // 创建临时测试目录
    beforeEach(async () => {
      testDir = fs.mkdtempSync(path.join(os.tmpdir(), "crab-connection-test-"));

      // 获取新的单例实例(通过重置静态实例)
      // @ts-expect-error 访问私有静态属性用于测试
      ConnectionManager.instance = undefined;
      manager = ConnectionManager.getInstance();

      // 设置环境变量来覆盖数据目录
      process.env.XDG_DATA_HOME = testDir;
    });

    afterEach(async () => {
      // 清理环境变量
      delete process.env.XDG_DATA_HOME;

      // 清理测试目录
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { force: true, recursive: true });
      }

      // 重置单例
      // @ts-expect-error 访问私有静态属性用于测试
      ConnectionManager.instance = undefined;
    });

    describe("单例模式", () => {
      test("getInstance 返回同一个实例", () => {
        const instance1 = ConnectionManager.getInstance();
        const instance2 = ConnectionManager.getInstance();
        expect(instance1).toBe(instance2);
      });
    });

    describe("添加连接", () => {
      test("可以添加本地连接", async () => {
        const config: ConnectionConfig = {
          id: "local-1",
          name: "本地项目",
          type: "local",
          workingDir: testDir,
        };

        const connection = await manager.addConnection(config);

        expect(connection.id).toBe("local-1");
        expect(connection.config.name).toBe("本地项目");
        expect(connection.status).toBe("disconnected");
        expect(connection.config.type).toBe("local");
      });

      test("可以添加 SSH 连接", async () => {
        const config: ConnectionConfig = {
          host: "example.com",
          id: "ssh-1",
          name: "远程服务器",
          port: 22,
          type: "ssh",
          username: "admin",
          workingDir: "/home/admin",
        };

        const connection = await manager.addConnection(config);

        expect(connection.id).toBe("ssh-1");
        expect(connection.config.host).toBe("example.com");
        expect(connection.config.port).toBe(22);
        expect(connection.config.username).toBe("admin");
      });

      test("不能添加重复 ID 的连接", async () => {
        const config: ConnectionConfig = {
          id: "duplicate",
          name: "第一个",
          type: "local",
          workingDir: testDir,
        };

        await manager.addConnection(config);

        await expect(
          manager.addConnection({
            ...config,
            name: "第二个",
          }),
        ).rejects.toThrow("连接 ID 已存在: duplicate");
      });
    });

    describe("获取连接", () => {
      test("getConnection 返回指定连接", async () => {
        const config: ConnectionConfig = {
          id: "test-1",
          name: "测试连接",
          type: "local",
          workingDir: testDir,
        };

        await manager.addConnection(config);
        const connection = manager.getConnection("test-1");

        expect(connection).toBeDefined();
        expect(connection?.id).toBe("test-1");
      });

      test("getConnection 不存在的连接返回 undefined", () => {
        const connection = manager.getConnection("non-existent");
        expect(connection).toBeUndefined();
      });

      test("getAllConnections 返回所有连接", async () => {
        await manager.addConnection({
          id: "conn-1",
          name: "连接1",
          type: "local",
          workingDir: testDir,
        });
        await manager.addConnection({
          host: "host2",
          id: "conn-2",
          name: "连接2",
          type: "ssh",
          workingDir: "/tmp",
        });

        const connections = manager.getAllConnections();

        expect(connections).toHaveLength(2);
        expect(connections.map((c) => c.id).toSorted()).toEqual(["conn-1", "conn-2"]);
      });

      test("hasConnection 检查连接是否存在", async () => {
        await manager.addConnection({
          id: "exists",
          name: "存在",
          type: "local",
          workingDir: testDir,
        });

        expect(manager.hasConnection("exists")).toBe(true);
        expect(manager.hasConnection("not-exists")).toBe(false);
      });
    });

    describe("更新连接", () => {
      test("可以更新连接配置", async () => {
        const config: ConnectionConfig = {
          id: "update-test",
          name: "原始名称",
          type: "local",
          workingDir: testDir,
        };

        await manager.addConnection(config);
        const updated = await manager.updateConnection("update-test", {
          name: "新名称",
          workingDir: "/new/path",
        });

        expect(updated).toBeDefined();
        expect(updated?.config.name).toBe("新名称");
        expect(updated?.config.workingDir).toBe("/new/path");
        // ID 不应该改变
        expect(updated?.config.id).toBe("update-test");
      });

      test("更新不存在的连接返回 null", async () => {
        const result = await manager.updateConnection("non-existent", {
          name: "新名称",
        });
        expect(result).toBeNull();
      });
    });

    describe("删除连接", () => {
      test("可以删除连接", async () => {
        await manager.addConnection({
          id: "to-delete",
          name: "待删除",
          type: "local",
          workingDir: testDir,
        });

        const result = await manager.removeConnection("to-delete");

        expect(result).toBe(true);
        expect(manager.hasConnection("to-delete")).toBe(false);
      });

      test("删除不存在的连接返回 false", async () => {
        const result = await manager.removeConnection("non-existent");
        expect(result).toBe(false);
      });

      test("删除连接前会自动断开", async () => {
        await manager.addConnection({
          id: "connected-delete",
          name: "已连接待删除",
          type: "local",
          workingDir: testDir,
        });

        await manager.connect("connected-delete");
        expect(manager.getConnection("connected-delete")?.status).toBe("connected");

        await manager.removeConnection("connected-delete");
        expect(manager.hasConnection("connected-delete")).toBe(false);
      });
    });

    describe("连接/断开", () => {
      test("可以建立本地连接", async () => {
        await manager.addConnection({
          id: "local-connect",
          name: "本地连接测试",
          type: "local",
          workingDir: testDir,
        });

        const connection = await manager.connect("local-connect");

        expect(connection.status).toBe("connected");
        expect(connection.connectedAt).toBeDefined();
      });

      test("连接不存在会抛出错误", async () => {
        await expect(manager.connect("non-existent")).rejects.toThrow("连接不存在: non-existent");
      });

      test("重复连接会返回已连接的实例", async () => {
        await manager.addConnection({
          id: "already-connected",
          name: "已连接",
          type: "local",
          workingDir: testDir,
        });

        await manager.connect("already-connected");
        const connection = await manager.connect("already-connected");

        expect(connection.status).toBe("connected");
      });

      test("可以断开连接", async () => {
        await manager.addConnection({
          id: "to-disconnect",
          name: "待断开",
          type: "local",
          workingDir: testDir,
        });

        await manager.connect("to-disconnect");
        await manager.disconnect("to-disconnect");

        const connection = manager.getConnection("to-disconnect");
        expect(connection?.status).toBe("disconnected");
        expect(connection?.disconnectedAt).toBeDefined();
      });

      test("断开不存在的连接不会报错", async () => {
        await expect(manager.disconnect("non-existent")).resolves.toBeUndefined();
      });

      test("本地连接检查工作目录存在性", async () => {
        await manager.addConnection({
          id: "bad-local",
          name: "无效本地连接",
          type: "local",
          workingDir: "/non/existent/path/12345",
        });

        await expect(manager.connect("bad-local")).rejects.toThrow("工作目录不存在");
        expect(manager.getConnection("bad-local")?.status).toBe("error");
      });
    });

    describe("活动连接管理", () => {
      test("可以设置活动连接", async () => {
        await manager.addConnection({
          id: "active-test",
          name: "活动连接测试",
          type: "local",
          workingDir: testDir,
        });

        await manager.setActiveConnection("active-test");

        const active = manager.getActiveConnection();
        expect(active?.id).toBe("active-test");
      });

      test("设置活动连接会自动建立连接", async () => {
        await manager.addConnection({
          id: "auto-connect",
          name: "自动连接",
          type: "local",
          workingDir: testDir,
        });

        expect(manager.getConnection("auto-connect")?.status).toBe("disconnected");

        await manager.setActiveConnection("auto-connect");

        expect(manager.getConnection("auto-connect")?.status).toBe("connected");
      });

      test("设置不存在的活动连接会报错", async () => {
        await expect(manager.setActiveConnection("non-existent")).rejects.toThrow("连接不存在: non-existent");
      });

      test("可以清除活动连接", async () => {
        await manager.addConnection({
          id: "clear-test",
          name: "清除测试",
          type: "local",
          workingDir: testDir,
        });

        await manager.setActiveConnection("clear-test");
        expect(manager.getActiveConnection()).toBeDefined();

        manager.clearActiveConnection();
        expect(manager.getActiveConnection()).toBeUndefined();
      });

      test("删除活动连接会自动清除", async () => {
        await manager.addConnection({
          id: "delete-active",
          name: "删除活动连接",
          type: "local",
          workingDir: testDir,
        });

        await manager.setActiveConnection("delete-active");
        await manager.removeConnection("delete-active");

        expect(manager.getActiveConnection()).toBeUndefined();
      });
    });

    describe("连接上下文", () => {
      test("可以获取连接上下文", async () => {
        await manager.addConnection({
          env: { KEY: "value" },
          id: "context-test",
          name: "上下文测试",
          type: "local",
          workingDir: testDir,
        });

        await manager.connect("context-test");
        const context = manager.getConnectionContext("context-test");

        expect(context).toBeDefined();
        expect(context?.connectionId).toBe("context-test");
        expect(context?.type).toBe("local");
        expect(context?.workingDir).toBe(testDir);
        expect(context?.env).toEqual({ KEY: "value" });
      });

      test("未连接的连接返回 null 上下文", async () => {
        await manager.addConnection({
          id: "no-context",
          name: "无上下文",
          type: "local",
          workingDir: testDir,
        });

        const context = manager.getConnectionContext("no-context");
        expect(context).toBeNull();
      });

      test("可以获取活动连接上下文", async () => {
        await manager.addConnection({
          id: "active-context",
          name: "活动上下文",
          type: "local",
          workingDir: testDir,
        });

        await manager.setActiveConnection("active-context");
        const context = manager.getActiveConnectionContext();

        expect(context).toBeDefined();
        expect(context?.connectionId).toBe("active-context");
      });

      test("无活动连接时返回 null", () => {
        expect(manager.getActiveConnectionContext()).toBeNull();
      });
    });

    describe("连接事件", () => {
      test("可以监听连接事件", async () => {
        const events: string[] = [];
        const unsubscribe = manager.addEventListener((event) => {
          events.push(event.type);
        });

        await manager.addConnection({
          id: "event-test",
          name: "事件测试",
          type: "local",
          workingDir: testDir,
        });
        await manager.connect("event-test");
        await manager.disconnect("event-test");

        unsubscribe();

        expect(events).toContain("connection:created");
        expect(events).toContain("connection:connecting");
        expect(events).toContain("connection:connected");
        expect(events).toContain("connection:disconnected");
      });

      test("可以取消事件监听", async () => {
        const listener = () => {};
        const unsubscribe = manager.addEventListener(listener);

        expect(typeof unsubscribe).toBe("function");
        unsubscribe();
      });

      test("删除连接会触发事件", async () => {
        let removedEventReceived = false;

        manager.addEventListener((event) => {
          if (event.type === "connection:removed") {
            removedEventReceived = true;
          }
        });

        await manager.addConnection({
          id: "remove-event",
          name: "删除事件",
          type: "local",
          workingDir: testDir,
        });
        await manager.removeConnection("remove-event");

        expect(removedEventReceived).toBe(true);
      });
    });

    describe("连接统计", () => {
      test("可以获取连接统计", async () => {
        await manager.addConnection({
          id: "stat-1",
          name: "统计1",
          type: "local",
          workingDir: testDir,
        });
        await manager.addConnection({
          host: "host",
          id: "stat-2",
          name: "统计2",
          type: "ssh",
          workingDir: "/tmp",
        });

        const stats = manager.getStats();

        expect(stats.total).toBe(2);
        expect(stats.disconnected).toBe(2);
        expect(stats.connected).toBe(0);
        expect(stats.connecting).toBe(0);
        expect(stats.error).toBe(0);
      });

      test("连接后统计会更新", async () => {
        await manager.addConnection({
          id: "stat-connect",
          name: "统计连接",
          type: "local",
          workingDir: testDir,
        });

        await manager.connect("stat-connect");
        const stats = manager.getStats();

        expect(stats.total).toBe(1);
        expect(stats.connected).toBe(1);
        expect(stats.disconnected).toBe(0);
      });
    });

    describe("连接过滤", () => {
      test("可以按类型过滤", async () => {
        await manager.addConnection({
          id: "filter-local",
          name: "本地过滤",
          type: "local",
          workingDir: testDir,
        });
        await manager.addConnection({
          host: "host",
          id: "filter-ssh",
          name: "SSH过滤",
          type: "ssh",
          workingDir: "/tmp",
        });
        await manager.addConnection({
          id: "filter-docker",
          name: "Docker过滤",
          type: "docker",
          workingDir: "/app",
        });

        const localConnections = manager.getConnections({ type: "local" });
        expect(localConnections).toHaveLength(1);
        expect(localConnections[0]?.id).toBe("filter-local");

        const sshConnections = manager.getConnections({ type: "ssh" });
        expect(sshConnections).toHaveLength(1);
        expect(sshConnections[0]?.id).toBe("filter-ssh");
      });

      test("可以按状态过滤", async () => {
        await manager.addConnection({
          id: "filter-disconnected",
          name: "已断开",
          type: "local",
          workingDir: testDir,
        });
        await manager.addConnection({
          id: "filter-connected",
          name: "已连接",
          type: "local",
          workingDir: testDir,
        });

        await manager.connect("filter-connected");

        const connected = manager.getConnections({ status: "connected" });
        expect(connected).toHaveLength(1);
        expect(connected[0]?.id).toBe("filter-connected");

        const disconnected = manager.getConnections({ status: "disconnected" });
        expect(disconnected).toHaveLength(1);
        expect(disconnected[0]?.id).toBe("filter-disconnected");
      });

      test("可以按名称过滤", async () => {
        await manager.addConnection({
          host: "prod",
          id: "name-1",
          name: "生产服务器",
          type: "ssh",
          workingDir: "/app",
        });
        await manager.addConnection({
          host: "test",
          id: "name-2",
          name: "测试服务器",
          type: "ssh",
          workingDir: "/app",
        });
        await manager.addConnection({
          id: "name-3",
          name: "开发环境",
          type: "local",
          workingDir: testDir,
        });

        const servers = manager.getConnections({ name: "服务器" });
        expect(servers).toHaveLength(2);

        const prod = manager.getConnections({ name: "生产" });
        expect(prod).toHaveLength(1);
        expect(prod[0]?.id).toBe("name-1");
      });
    });

    describe("断开所有连接", () => {
      test("可以断开所有连接", async () => {
        await manager.addConnection({
          id: "disconnect-all-1",
          name: "断开1",
          type: "local",
          workingDir: testDir,
        });
        await manager.addConnection({
          id: "disconnect-all-2",
          name: "断开2",
          type: "local",
          workingDir: testDir,
        });

        await manager.connect("disconnect-all-1");
        await manager.connect("disconnect-all-2");

        await manager.disconnectAll();

        expect(manager.getConnection("disconnect-all-1")?.status).toBe("disconnected");
        expect(manager.getConnection("disconnect-all-2")?.status).toBe("disconnected");
      });
    });

    describe("持久化", () => {
      test("连接配置会被保存到文件", async () => {
        const config = {
          id: "persist-test",
          name: "持久化测试",
          type: "local" as const,
          workingDir: testDir,
        };

        await manager.addConnection(config);

        const connectionsPath = path.join(testDir, "crab", "connections.json");
        expect(fs.existsSync(connectionsPath)).toBe(true);

        const saved = JSON.parse(fs.readFileSync(connectionsPath, "utf8"));
        expect(saved).toHaveLength(1);
        expect(saved[0].id).toBe(config.id);
        expect(saved[0].name).toBe(config.name);
      });

      test("初始化时会加载已保存的连接", async () => {
        const config = {
          id: "load-test",
          name: "加载测试",
          type: "local" as const,
          workingDir: testDir,
        };

        await manager.addConnection(config);

        // 重置并创建新管理器实例
        // @ts-expect-error 测试中访问私有静态属性
        ConnectionManager.instance = undefined;
        const newManager = ConnectionManager.getInstance();

        await newManager.init();

        expect(newManager.hasConnection("load-test")).toBe(true);
        expect(newManager.getConnection("load-test")?.config.name).toBe("加载测试");
      });
    });
  });
}
