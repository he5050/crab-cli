/**
 * 外部权限桥接测试。
 *
 * 覆盖导出:
 *   - listPendingExternalPermissionRequests
 *   - resolveExternalPermissionRequest
 *   - submitExternalPermissionRequest
 *   - ExternalPermissionRequest 类型
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  BACKGROUND_APPROVAL_TIMEOUT_MS,
  listPendingExternalPermissionRequests,
  resolveExternalPermissionRequest,
  resolveExternalPermissionRequestForSession,
} from "@/permission/store/approvalBridge";
import type { ExternalPermissionRequest } from "@/permission/store/approvalBridge";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../helpers/testPaths";

let tempDir = "";
let originalXdgDataHome: string | undefined;

beforeEach(() => {
  tempDir = createGlobalTmpTestDir("approval-bridge-");
  originalXdgDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = tempDir;
});

afterEach(() => {
  if (originalXdgDataHome !== undefined) {
    process.env.XDG_DATA_HOME = originalXdgDataHome;
  } else {
    delete process.env.XDG_DATA_HOME;
  }
  cleanupTestDir(tempDir);
  tempDir = "";
});

function bridgePath(): string {
  return path.join(tempDir, "crab", "permission-bridge.json");
}

function bridgeLockPath(): string {
  return path.join(tempDir, "crab", "permission-bridge.lock");
}

function writeBridgeFile(requests: ExternalPermissionRequest[] | string): void {
  fs.mkdirSync(path.dirname(bridgePath()), { recursive: true });
  fs.writeFileSync(bridgePath(), typeof requests === "string" ? requests : JSON.stringify(requests, null, 2), "utf8");
}

function readBridgeFile(): ExternalPermissionRequest[] {
  return JSON.parse(fs.readFileSync(bridgePath(), "utf8")) as ExternalPermissionRequest[];
}

describe("外部权限桥接", () => {
  describe("类型验证", () => {
    test("ExternalPermissionRequest 结构正确", () => {
      const req: ExternalPermissionRequest = {
        createdAt: Date.now(),
        id: "xper_test",
        patterns: ["ls"],
        permission: "bash",
        sourcePid: 12_345,
        status: "pending",
        tool: "terminal-execute",
      };
      expect(req.id).toBe("xper_test");
      expect(req.status).toBe("pending");
    });

    test("ExternalPermissionRequest 可选字段", () => {
      const req: ExternalPermissionRequest = {
        createdAt: Date.now(),
        description: "读取文件",
        id: "xper_test2",
        patterns: [],
        permission: "read",
        riskLevel: "low",
        sourcePid: 12_345,
        status: "pending",
        tool: "filesystem-read",
      };
      expect(req.description).toBe("读取文件");
      expect(req.riskLevel).toBe("low");
    });
  });

  describe("listPendingExternalPermissionRequests", () => {
    test("返回数组", () => {
      const result = listPendingExternalPermissionRequests();
      expect(Array.isArray(result)).toBe(true);
    });

    test("只包含 pending 状态", () => {
      const result = listPendingExternalPermissionRequests();
      for (const req of result) {
        expect(req.status).toBe("pending");
      }
    });

    test("按创建时间升序返回 pending，并过滤 resolved", () => {
      writeBridgeFile([
        {
          createdAt: 200,
          id: "xper_later",
          patterns: ["late"],
          permission: "bash",
          sourcePid: 100,
          status: "pending",
          tool: "terminal-execute",
        },
        {
          action: "once",
          allowed: true,
          createdAt: 50,
          id: "xper_done",
          patterns: ["done"],
          permission: "bash",
          sourcePid: 100,
          status: "resolved",
          tool: "terminal-execute",
        },
        {
          createdAt: 100,
          id: "xper_earlier",
          patterns: ["/tmp/a"],
          permission: "fs.write",
          sourcePid: 100,
          status: "pending",
          tool: "filesystem-write",
        },
      ]);

      expect(listPendingExternalPermissionRequests().map((req) => req.id)).toEqual(["xper_earlier", "xper_later"]);
    });

    test("桥接文件损坏时返回空数组而不是抛错", () => {
      writeBridgeFile("{not valid json");
      expect(listPendingExternalPermissionRequests()).toEqual([]);
    });

    test("桥接文件不是数组时返回空数组", () => {
      writeBridgeFile(JSON.stringify({ requests: [] }));
      expect(listPendingExternalPermissionRequests()).toEqual([]);
    });
  });

  describe("resolveExternalPermissionRequest", () => {
    test("解析不存在的请求返回 false", () => {
      expect(resolveExternalPermissionRequest("nonexistent_id_xyz", true)).toBe(false);
    });

    test("解析不存在的请求 allowed=false 也返回 false", () => {
      expect(resolveExternalPermissionRequest("nonexistent_id_xyz2", false)).toBe(false);
    });

    test("reject 决策写回 action 与 allowed=false", () => {
      writeBridgeFile([
        {
          createdAt: 100,
          id: "xper_reject",
          patterns: ["rm file"],
          permission: "bash",
          sourcePid: 100,
          status: "pending",
          tool: "terminal-execute",
        },
      ]);

      expect(resolveExternalPermissionRequest("xper_reject", "reject")).toBe(true);
      expect(readBridgeFile()).toEqual([
        {
          action: "reject",
          allowed: false,
          createdAt: 100,
          id: "xper_reject",
          patterns: ["rm file"],
          permission: "bash",
          sourcePid: 100,
          status: "resolved",
          tool: "terminal-execute",
        },
      ]);
    });

    test("boolean true 归一化为 once 并写回 allowed=true", () => {
      writeBridgeFile([
        {
          createdAt: 100,
          id: "xper_once",
          patterns: ["README.md"],
          permission: "fs.read",
          sourcePid: 100,
          status: "pending",
          tool: "filesystem-read",
        },
      ]);

      expect(resolveExternalPermissionRequest("xper_once", true)).toBe(true);
      expect(readBridgeFile()[0]).toMatchObject({
        action: "once",
        allowed: true,
        id: "xper_once",
        status: "resolved",
      });
    });

    test("boolean false 归一化为 reject 并写回 allowed=false", () => {
      writeBridgeFile([
        {
          createdAt: 100,
          id: "xper_bool_reject",
          patterns: ["/tmp/blocked.txt"],
          permission: "fs.write",
          sourcePid: 100,
          status: "pending",
          tool: "filesystem-write",
        },
      ]);

      expect(resolveExternalPermissionRequest("xper_bool_reject", false)).toBe(true);
      expect(readBridgeFile()[0]).toMatchObject({
        action: "reject",
        allowed: false,
        id: "xper_bool_reject",
        status: "resolved",
      });
    });

    test("存在陈旧锁目录时会自动清理并继续解析请求", () => {
      writeBridgeFile([
        {
          createdAt: 100,
          id: "xper_stale_lock",
          patterns: ["echo ok"],
          permission: "bash",
          sourcePid: 100,
          status: "pending",
          tool: "terminal-execute",
        },
      ]);
      fs.mkdirSync(bridgeLockPath(), { recursive: true });
      const staleTime = new Date(Date.now() - 61_000);
      fs.utimesSync(bridgeLockPath(), staleTime, staleTime);

      expect(resolveExternalPermissionRequest("xper_stale_lock", "always")).toBe(true);
      expect(fs.existsSync(bridgeLockPath())).toBe(false);
      expect(readBridgeFile()[0]).toMatchObject({
        action: "always",
        allowed: true,
        id: "xper_stale_lock",
        status: "resolved",
      });
    });

    test("远程解析必须匹配 sessionId", () => {
      writeBridgeFile([
        {
          createdAt: 100,
          id: "xper_remote_session",
          patterns: ["/tmp/sandbox.txt"],
          permission: "fs.write",
          sessionId: "ses_allowed",
          sourcePid: 100,
          status: "pending",
          tool: "filesystem-write",
        },
      ]);

      expect(resolveExternalPermissionRequestForSession("xper_remote_session", "ses_other", "once")).toEqual({
        ok: false,
        reason: "session_mismatch",
      });
      expect(resolveExternalPermissionRequestForSession("xper_remote_session", "ses_allowed", "once")).toEqual({
        ok: true,
      });
      expect(readBridgeFile()[0]).toMatchObject({
        action: "once",
        allowed: true,
        status: "resolved",
      });
    });
  });

  describe("模块导入", () => {
    test("submitExternalPermissionRequest 函数存在", async () => {
      const mod = await import("@/permission/store/approvalBridge");
      expect(typeof mod.submitExternalPermissionRequest).toBe("function");
    });

    test("submitExternalPermissionRequest 是异步函数", async () => {
      const mod = await import("@/permission/store/approvalBridge");
      // Async function 的构造器是 AsyncFunction
      expect(mod.submitExternalPermissionRequest.constructor.name).toBe("AsyncFunction");
    });
  });

  describe("submitExternalPermissionRequest", () => {
    test("默认后台审批超时为 1 小时", () => {
      expect(BACKGROUND_APPROVAL_TIMEOUT_MS).toBe(60 * 60 * 1000);
    });

    test("pending -> resolved -> cleanup 完整闭环", async () => {
      const mod = await import("@/permission/store/approvalBridge.ts");

      const requestPromise = mod.submitExternalPermissionRequest(
        {
          description: "Package A bridge test",
          patterns: ["echo package-a"],
          permission: "bash",
          riskLevel: "low",
          tool: "terminal-execute",
        },
        1500,
      );

      let pending: ExternalPermissionRequest[] = [];
      const deadline = Date.now() + 1000;
      while (Date.now() < deadline) {
        pending = mod.listPendingExternalPermissionRequests();
        if (pending.length > 0) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      expect(pending.length).toBe(1);
      expect(pending[0]!.permission).toBe("bash");
      expect(pending[0]!.sessionId).toBeUndefined();
      expect(pending[0]!.tool).toBe("terminal-execute");
      expect(pending[0]!.status).toBe("pending");

      expect(mod.resolveExternalPermissionRequest(pending[0]!.id, true)).toBe(true);
      await expect(requestPromise).resolves.toBe("once");

      expect(mod.listPendingExternalPermissionRequests()).toEqual([]);
    });

    test("always 决策会原样返回，不退化为一次性允许", async () => {
      const mod = await import("@/permission/store/approvalBridge.ts");

      const requestPromise = mod.submitExternalPermissionRequest(
        {
          patterns: ["echo remember-me"],
          permission: "bash",
          tool: "terminal-execute",
        },
        1500,
      );

      let pending: ExternalPermissionRequest[] = [];
      const deadline = Date.now() + 1000;
      while (Date.now() < deadline) {
        pending = mod.listPendingExternalPermissionRequests();
        if (pending.length > 0) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      expect(pending.length).toBe(1);
      expect(mod.resolveExternalPermissionRequest(pending[0]!.id, "always")).toBe(true);
      await expect(requestPromise).resolves.toBe("always");
      expect(mod.listPendingExternalPermissionRequests()).toEqual([]);
    });

    test("超时后返回 false 且清理请求文件内容", async () => {
      const mod = await import("@/permission/store/approvalBridge.ts");

      const result = await mod.submitExternalPermissionRequest(
        {
          patterns: ["/tmp/test.txt"],
          permission: "fs.write",
          tool: "filesystem-write",
        },
        50,
      );

      expect(result).toBe(false);
      expect(mod.listPendingExternalPermissionRequests()).toEqual([]);
    });

    test("submitExternalPermissionRequest 保留 sessionId 供远程审批隔离", async () => {
      const mod = await import("@/permission/store/approvalBridge.ts");

      const requestPromise = mod.submitExternalPermissionRequest(
        {
          patterns: ["/tmp/bridge.txt"],
          permission: "fs.write",
          sessionId: "ses_bridge",
          tool: "filesystem-write",
        },
        1500,
      );

      let pending: ExternalPermissionRequest[] = [];
      const deadline = Date.now() + 1000;
      while (Date.now() < deadline) {
        pending = mod.listPendingExternalPermissionRequests();
        if (pending.length > 0) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      expect(pending[0]!.sessionId).toBe("ses_bridge");
      expect(mod.resolveExternalPermissionRequestForSession(pending[0]!.id, "ses_bridge", "reject")).toEqual({
        ok: true,
      });
      await expect(requestPromise).resolves.toBe("reject");
    });
  });
});
