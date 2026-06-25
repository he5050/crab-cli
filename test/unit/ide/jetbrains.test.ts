/**
 * JetBrains IDE 集成测试
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import {
  detectJetBrainsInstances,
  getJetBrainsEditorState,
  getJetBrainsDiagnostics,
  openInJetBrains,
} from "@/ide/client/jetbrains";
import type { JetBrainsInstance, JetBrainsDiagnostic } from "@/ide/client/jetbrains";

describe("jetbrains", () => {
  describe("detectJetBrainsInstances", () => {
    let originalGlob: typeof Bun.Glob;

    beforeEach(() => {
      originalGlob = Bun.Glob;
    });

    afterEach(() => {
      (Bun as any).Glob = originalGlob;
    });

    it("正常解析 JetBrains 实例", async () => {
      (Bun as any).Glob = function (_pattern: string) {
        return {
          scan() {
            const files = ["/tmp/.jetbrains.1234"];
            let idx = 0;
            return {
              [Symbol.asyncIterator]() {
                return {
                  next: () =>
                    idx < files.length
                      ? Promise.resolve({ value: files[idx++], done: false })
                      : Promise.resolve({ done: true }),
                };
              },
            };
          },
        };
      };
      const mockBunFile = spyOn(Bun, "file").mockImplementation(((path: any) => {
        if (path === "/tmp/.jetbrains.1234") {
          return {
            text: () =>
              Promise.resolve(JSON.stringify({ port: 63342, productCode: "IU", build: "241.1", token: "abc" })),
          } as any;
        }
        return { text: () => Promise.resolve("{}") } as any;
      }) as any);

      const instances = await detectJetBrainsInstances();
      expect(instances).toHaveLength(1);
      expect(instances[0]).toEqual({
        port: 63342,
        product: "IU",
        version: "241.1",
        token: "abc",
      });

      mockBunFile.mockRestore();
    });

    it("JSON 格式错误的文件跳过", async () => {
      (Bun as any).Glob = function () {
        return {
          scan() {
            const files = ["/tmp/.jetbrains.bad"];
            let idx = 0;
            return {
              [Symbol.asyncIterator]() {
                return {
                  next: () =>
                    idx < files.length
                      ? Promise.resolve({ value: files[idx++], done: false })
                      : Promise.resolve({ done: true }),
                };
              },
            };
          },
        };
      };
      const mockBunFile = spyOn(Bun, "file").mockImplementation(
        () =>
          ({
            text: () => Promise.resolve("not-json"),
          }) as any,
      );

      const instances = await detectJetBrainsInstances();
      expect(instances).toEqual([]);

      mockBunFile.mockRestore();
    });

    it("无 JetBrains 文件返回空数组", async () => {
      (Bun as any).Glob = function () {
        return {
          scan() {
            return {
              [Symbol.asyncIterator]() {
                return {
                  next: () => Promise.resolve({ done: true }),
                };
              },
            };
          },
        };
      };

      const instances = await detectJetBrainsInstances();
      expect(instances).toEqual([]);
    });

    it("缺少 port 或 productCode 的文件跳过", async () => {
      (Bun as any).Glob = function () {
        return {
          scan() {
            const files = ["/tmp/.jetbrains.nodata"];
            let idx = 0;
            return {
              [Symbol.asyncIterator]() {
                return {
                  next: () =>
                    idx < files.length
                      ? Promise.resolve({ value: files[idx++], done: false })
                      : Promise.resolve({ done: true }),
                };
              },
            };
          },
        };
      };
      const mockBunFile = spyOn(Bun, "file").mockImplementation(
        () =>
          ({
            text: () => Promise.resolve(JSON.stringify({ foo: "bar" })),
          }) as any,
      );

      const instances = await detectJetBrainsInstances();
      expect(instances).toEqual([]);

      mockBunFile.mockRestore();
    });

    it("build 字段缺失时默认 unknown", async () => {
      (Bun as any).Glob = function () {
        return {
          scan() {
            const files = ["/tmp/.jetbrains.nobuild"];
            let idx = 0;
            return {
              [Symbol.asyncIterator]() {
                return {
                  next: () =>
                    idx < files.length
                      ? Promise.resolve({ value: files[idx++], done: false })
                      : Promise.resolve({ done: true }),
                };
              },
            };
          },
        };
      };
      const mockBunFile = spyOn(Bun, "file").mockImplementation(
        () =>
          ({
            text: () => Promise.resolve(JSON.stringify({ port: 63342, productCode: "WS" })),
          }) as any,
      );

      const instances = await detectJetBrainsInstances();
      expect(instances).toHaveLength(1);
      expect(instances[0]!.version).toBe("unknown");

      mockBunFile.mockRestore();
    });
  });

  describe("getJetBrainsEditorState", () => {
    const instance: JetBrainsInstance = { product: "IU", version: "241.1", port: 63342 };

    afterEach(() => {
      delete (globalThis as any).fetch;
    });

    it("正常返回编辑器状态", async () => {
      (globalThis as any).fetch = () =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              activeFile: "/tmp/Main.java",
              diagnostics: [],
            }),
        });

      const state = await getJetBrainsEditorState(instance);
      expect(state).not.toBeNull();
      expect(state!.activeFile).toBe("/tmp/Main.java");
    });

    it("fetch 返回非 ok 时返回 null", async () => {
      (globalThis as any).fetch = () =>
        Promise.resolve({
          ok: false,
          status: 404,
        });

      const state = await getJetBrainsEditorState(instance);
      expect(state).toBeNull();
    });

    it("fetch 返回 null 时返回 null", async () => {
      (globalThis as any).fetch = () => Promise.resolve(null);

      const state = await getJetBrainsEditorState(instance);
      expect(state).toBeNull();
    });

    it("JSON 解析失败返回 null", async () => {
      (globalThis as any).fetch = () =>
        Promise.resolve({
          ok: true,
          json: () => Promise.reject(new Error("bad json")),
        });

      const state = await getJetBrainsEditorState(instance);
      expect(state).toBeNull();
    });

    it("activeFile 缺失时默认空字符串", async () => {
      (globalThis as any).fetch = () =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ diagnostics: [] }),
        });

      const state = await getJetBrainsEditorState(instance);
      expect(state).not.toBeNull();
      expect(state!.activeFile).toBe("");
      expect(state!.diagnostics).toEqual([]);
    });
  });

  describe("getJetBrainsDiagnostics", () => {
    const instance: JetBrainsInstance = { product: "IU", version: "241.1", port: 63342 };

    afterEach(() => {
      delete (globalThis as any).fetch;
    });

    it("正常返回诊断数组", async () => {
      const diags: JetBrainsDiagnostic[] = [
        { file: "a.java", line: 1, severity: "warning", message: "w", source: "java" },
      ];
      (globalThis as any).fetch = () =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(diags),
        });

      const result = await getJetBrainsDiagnostics(instance);
      expect(result).toEqual(diags);
    });

    it("非 ok 返回空数组", async () => {
      (globalThis as any).fetch = () =>
        Promise.resolve({
          ok: false,
          status: 500,
        });

      const result = await getJetBrainsDiagnostics(instance);
      expect(result).toEqual([]);
    });

    it("fetch 返回 null 返回空数组", async () => {
      (globalThis as any).fetch = () => Promise.resolve(null);

      const result = await getJetBrainsDiagnostics(instance);
      expect(result).toEqual([]);
    });

    it("JSON 解析失败返回空数组", async () => {
      (globalThis as any).fetch = () =>
        Promise.resolve({
          ok: true,
          json: () => Promise.reject(new Error("bad")),
        });

      const result = await getJetBrainsDiagnostics(instance);
      expect(result).toEqual([]);
    });
  });

  describe("openInJetBrains", () => {
    const instance: JetBrainsInstance = { product: "IU", version: "241.1", port: 63342 };

    afterEach(() => {
      delete (globalThis as any).fetch;
    });

    it("正常打开返回 true", async () => {
      (globalThis as any).fetch = () =>
        Promise.resolve({
          ok: true,
        });

      const result = await openInJetBrains(instance, "/tmp/Main.java");
      expect(result).toBe(true);
    });

    it("带行号打开", async () => {
      (globalThis as any).fetch = (_url: any) => {
        expect(_url).toContain("line=42");
        return Promise.resolve({ ok: true });
      };

      const result = await openInJetBrains(instance, "/tmp/Main.java", 42);
      expect(result).toBe(true);
    });

    it("非 ok 返回 false", async () => {
      (globalThis as any).fetch = () =>
        Promise.resolve({
          ok: false,
        });

      const result = await openInJetBrains(instance, "/tmp/Main.java");
      expect(result).toBe(false);
    });

    it("fetch 返回 null 返回 false", async () => {
      (globalThis as any).fetch = () => Promise.resolve(null);

      const result = await openInJetBrains(instance, "/tmp/Main.java");
      expect(result).toBe(false);
    });
  });
});
