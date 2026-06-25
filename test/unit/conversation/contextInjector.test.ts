/**
 * Context-injector 白盒测试 — injectContextToMessage 纯函数。
 */
import { describe, expect, test } from "bun:test";
import { injectContextToMessage } from "@/conversation/context/contextInjector";

describe("injectContextToMessage", () => {
  test("空上下文不注入", () => {
    expect(injectContextToMessage("Hello", "")).toBe("Hello");
  });

  test("空白上下文不注入", () => {
    expect(injectContextToMessage("Hello", "   ")).toBe("Hello");
  });

  test("正常注入", () => {
    const result = injectContextToMessage("Hello", "## 目录结构\n\n```\nsrc/\n```");
    expect(result).toContain("## 目录结构");
    expect(result).toContain("Hello");
    expect(result).toContain("---");
  });

  test("已有目录结构标记不重复注入", () => {
    const userContent = "## 目录结构\n\n已有内容";
    expect(injectContextToMessage(userContent, "## 目录结构\n\nnew")).toBe(userContent);
  });

  test("已有最近修改文件标记不重复注入", () => {
    const userContent = "## 最近修改文件\n\n- foo.ts";
    expect(injectContextToMessage(userContent, "## 最近修改文件\n\nnew")).toBe(userContent);
  });

  test("注入格式正确:context + 分隔线 + 用户消息", () => {
    const result = injectContextToMessage("user msg", "ctx text");
    expect(result).toBe("ctx text\n\n---\n\nuser msg");
  });
});
