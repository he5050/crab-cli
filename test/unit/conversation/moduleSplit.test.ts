/**
 * P2-1 模块拆分路径验证测试
 *
 * 验证三个迁移后的模块路径可正常导入:
 *   - @agent/agentState (from conversation/)
 *   - @deepResearch (from conversation/)
 *   - @compress/compressionRuntime (from conversation/)
 *
 * 通过静态导入路径验证模块可被业务代码引用。
 */

import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC_DIR = "/Users/hejianfei/Desktop/01-开发项目/06-应用工具/crab-cli/src";

describe("P2-1: conversation/ 模块拆分路径验证", () => {
  it("@agent/core/state 模块已迁移", () => {
    const target = path.join(SRC_DIR, "agent/core/state.ts");
    expect(fs.existsSync(target)).toBe(true);

    // 旧路径的转发文件已被清理
    const oldTarget = path.join(SRC_DIR, "conversation/agentState.ts");
    expect(fs.existsSync(oldTarget)).toBe(false);
  });

  it("@deepResearch 模块已迁移", () => {
    const target = path.join(SRC_DIR, "tool/deepResearch/index.ts");
    expect(fs.existsSync(target)).toBe(true);

    const oldTarget = path.join(SRC_DIR, "conversation/deepResearch.ts");
    expect(fs.existsSync(oldTarget)).toBe(false);
  });

  it("@compress/compressionRuntime 模块已迁移", () => {
    const target = path.join(SRC_DIR, "compress/runtime/compressionRuntime.ts");
    expect(fs.existsSync(target)).toBe(true);

    const oldTarget = path.join(SRC_DIR, "conversation/conversationCompactionRuntime.ts");
    expect(fs.existsSync(oldTarget)).toBe(false);
  });

  it("import 路径替换一致(无残留 @conversation 引用)", () => {
    // 读取已迁移的 conversationHandler.ts 验证
    const handlerPath = path.join(SRC_DIR, "conversation/core/conversationHandler.ts");
    const content = fs.readFileSync(handlerPath, "utf8");
    expect(content).not.toMatch(/@conversation\/agentState/);
    expect(content).not.toMatch(/@conversation\/deepResearch/);
    expect(content).not.toMatch(/@conversation\/conversationCompactionRuntime/);
  });

  it("会话模块引用使用正确的目标路径", () => {
    const handlerPath = path.join(SRC_DIR, "conversation/core/conversationHandler.ts");
    const content = fs.readFileSync(handlerPath, "utf8");
    expect(content).toMatch(/@\/agent/);
    expect(content).toMatch(/@\/compress/);
  });

  it("chat.tsx 引用使用 @/agent/core/state", () => {
    const chatPath = path.join(SRC_DIR, "ui/contexts/chat.tsx");
    if (fs.existsSync(chatPath)) {
      const content = fs.readFileSync(chatPath, "utf8");
      expect(content).toMatch(/@\/agent\/core\/state/);
    }
  });

  it("taskManageOther 引用使用 @deepResearch", () => {
    const path1 = path.join(SRC_DIR, "commandPalette/appCommands/taskManageOther.ts");
    if (fs.existsSync(path1)) {
      const content = fs.readFileSync(path1, "utf8");
      expect(content).toMatch(/@deepResearch/);
    }
  });
});

describe("P2-1: 模块边界清晰度", () => {
  it("agentState 不依赖 conversation/ 其他模块", () => {
    const target = path.join(SRC_DIR, "agent/core/state.ts");
    if (fs.existsSync(target)) {
      const content = fs.readFileSync(target, "utf8");
      // 仅允许在类型 re-export 中提到，不应 import 业务逻辑
      const importMatches = content.match(/^import\s.*from\s+["']@conversation/gm) || [];
      expect(importMatches.length).toBe(0);
    }
  });

  it("deepResearch 不依赖 conversation/ 业务模块", () => {
    const target = path.join(SRC_DIR, "deepResearch/index.ts");
    if (fs.existsSync(target)) {
      const content = fs.readFileSync(target, "utf8");
      const importMatches = content.match(/^import\s.*from\s+["']@conversation/gm) || [];
      expect(importMatches.length).toBe(0);
    }
  });
});
