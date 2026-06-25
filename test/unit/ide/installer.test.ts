/**
 * IDE 扩展安装器测试
 */
import { afterAll, describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";

// 隔离 mock：防止 CollaborationManager 模块级实例化时 bus mock 缺少 subscribe
mock.module("@/server/collaboration", () => ({
  collaborationManager: { stop: mock(() => {}), subscribeBus: mock(() => {}) },
  CollaborationManager: class {
    constructor() {}
    subscribeBus() {}
    start() {}
    stop() {}
  },
}));

mock.module("@/core/logging/logger", () => ({
  createLogger: () => ({
    info: mock(() => {}),
    warn: mock(() => {}),
    debug: mock(() => {}),
    error: mock(() => {}),
  }),
}));

import { globalBus, AppEvent } from "@/bus";
import { installExtension, isExtensionInstalledCli } from "@/ide/extension/installer";

describe("installer", () => {
  afterAll(() => {
    mock.restore();
  });

  describe("installExtension", () => {
    let publishSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
      publishSpy = spyOn(globalBus, "publish");
    });

    afterEach(() => {
      mock.restore();
    });

    it("未知 IDE 返回错误", async () => {
      const result = await installExtension("UnknownIDE");
      expect(result.success).toBe(false);
      expect(result.error).toContain("未知的 IDE");
      expect(result.errorCode).toBe("USER-202");
    });

    it("安装成功返回成功", async () => {
      const mockProc = {
        exited: Promise.resolve(0),
        stderr: new ReadableStream({
          start(ctrl) {
            ctrl.close();
          },
        }),
        stdout: new ReadableStream({
          start(ctrl) {
            ctrl.close();
          },
        }),
      };
      const mockSpawn = spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

      const result = await installExtension("VSCode");
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(mockSpawn).toHaveBeenCalledWith(["code", "--install-extension", "crab-dev.crab-cli"], {
        stderr: "pipe",
        stdout: "pipe",
      });

      mockSpawn.mockRestore();
    });

    it("安装失败(exit != 0)返回错误", async () => {
      const mockProc = {
        exited: Promise.resolve(1),
        stderr: new ReadableStream({
          start(ctrl) {
            const enc = new TextEncoder();
            ctrl.enqueue(enc.encode("install failed"));
            ctrl.close();
          },
        }),
        stdout: new ReadableStream({
          start(ctrl) {
            ctrl.close();
          },
        }),
      };
      const mockSpawn = spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

      const result = await installExtension("Cursor");
      expect(result.success).toBe(false);
      expect(result.error).toContain("安装失败");

      mockSpawn.mockRestore();
    });

    it("安装异常返回错误", async () => {
      const mockSpawn = spyOn(Bun, "spawn").mockImplementation(() => {
        throw new Error("command not found");
      });

      const result = await installExtension("VSCode");
      expect(result.success).toBe(false);
      expect(result.error).toContain("安装异常");

      mockSpawn.mockRestore();
    });
  });

  describe("isExtensionInstalledCli", () => {
    it("未知 IDE 返回 false", async () => {
      const result = await isExtensionInstalledCli("UnknownIDE");
      expect(result).toBe(false);
    });

    it("已安装返回 true", async () => {
      const mockProc = {
        exited: Promise.resolve(0),
        stderr: new ReadableStream({
          start(ctrl) {
            ctrl.close();
          },
        }),
        stdout: new ReadableStream({
          start(ctrl) {
            const enc = new TextEncoder();
            ctrl.enqueue(enc.encode("crab-dev.crab-cli@1.0.0\nother-ext@2.0.0\n"));
            ctrl.close();
          },
        }),
      };
      const mockSpawn = spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

      const result = await isExtensionInstalledCli("VSCode");
      expect(result).toBe(true);

      mockSpawn.mockRestore();
    });

    it("未安装返回 false", async () => {
      const mockProc = {
        exited: Promise.resolve(0),
        stderr: new ReadableStream({
          start(ctrl) {
            ctrl.close();
          },
        }),
        stdout: new ReadableStream({
          start(ctrl) {
            const enc = new TextEncoder();
            ctrl.enqueue(enc.encode("other-ext@2.0.0\n"));
            ctrl.close();
          },
        }),
      };
      const mockSpawn = spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

      const result = await isExtensionInstalledCli("VSCode");
      expect(result).toBe(false);

      mockSpawn.mockRestore();
    });

    it("exit != 0 返回 false", async () => {
      const mockProc = {
        exited: Promise.resolve(1),
        stderr: new ReadableStream({
          start(ctrl) {
            ctrl.close();
          },
        }),
        stdout: new ReadableStream({
          start(ctrl) {
            ctrl.close();
          },
        }),
      };
      const mockSpawn = spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

      const result = await isExtensionInstalledCli("VSCode");
      expect(result).toBe(false);

      mockSpawn.mockRestore();
    });

    it("命令不存在(异常)返回 false", async () => {
      const mockSpawn = spyOn(Bun, "spawn").mockImplementation(() => {
        throw new Error("spawn error");
      });

      const result = await isExtensionInstalledCli("VSCode");
      expect(result).toBe(false);

      mockSpawn.mockRestore();
    });
  });
});
