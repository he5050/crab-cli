/**
 * CLI SSE 模式单元测试
 */
import { describe, expect, test } from "bun:test";
import { parseSsePort, SsePortError } from "@/server/sseModes";

describe("parseSsePort", () => {
  test("undefined 返回 undefined", () => {
    expect(parseSsePort(undefined)).toBeUndefined();
  });

  test("有效字符串端口返回数字", () => {
    expect(parseSsePort("3000")).toBe(3000);
    expect(parseSsePort("1")).toBe(1);
    expect(parseSsePort("65535")).toBe(65535);
  });

  test("有效数字端口返回数字", () => {
    expect(parseSsePort(3000)).toBe(3000);
    expect(parseSsePort(1)).toBe(1);
    expect(parseSsePort(65535)).toBe(65535);
  });

  test("边界值 0 抛出 SsePortError", () => {
    expect(() => parseSsePort("0")).toThrow(SsePortError);
    expect(() => parseSsePort(0)).toThrow(SsePortError);
  });

  test("边界值 65536 抛出 SsePortError", () => {
    expect(() => parseSsePort("65536")).toThrow(SsePortError);
    expect(() => parseSsePort(65536)).toThrow(SsePortError);
  });

  test("负数抛出 SsePortError", () => {
    expect(() => parseSsePort("-1")).toThrow(SsePortError);
    expect(() => parseSsePort(-1)).toThrow(SsePortError);
  });

  test("非数字字符串抛出 SsePortError", () => {
    expect(() => parseSsePort("abc")).toThrow(SsePortError);
    expect(() => parseSsePort("")).toThrow(SsePortError);
    expect(() => parseSsePort("30a0")).toThrow(SsePortError);
  });

  test("浮点数抛出 SsePortError", () => {
    expect(() => parseSsePort("123.45")).toThrow(SsePortError);
    expect(() => parseSsePort(123.45)).toThrow(SsePortError);
  });

  test("错误消息包含端口值", () => {
    expect(() => parseSsePort("abc")).toThrow("错误: 无效的 SSE 端口: abc");
    expect(() => parseSsePort(0)).toThrow("错误: 无效的 SSE 端口: 0");
  });

  test("抛出的异常类型为 SsePortError", () => {
    try {
      parseSsePort("invalid");
      throw new Error("应该抛出异常");
    } catch (error) {
      expect(error instanceof SsePortError).toBe(true);
      expect(error instanceof Error).toBe(true);
    }
  });
});
