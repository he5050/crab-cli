/**
 * Edit Tool 整合测试 - 验证 edit.ts 使用 editTools 辅助函数
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { fsEditTool } from "@/tool/filesystem/edit";

const TEST_DIR = path.join(process.cwd(), "test-temp-edit-integration");
const TEST_FILE = path.join(TEST_DIR, "sample.ts");

describe("Edit Tool Integration", () => {
  beforeEach(() => {
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { force: true, recursive: true });
    }
  });

  test("精确匹配替换", async () => {
    const content = `function hello() {
  console.log("world");
}`;
    fs.writeFileSync(TEST_FILE, content, "utf8");

    const result = (await fsEditTool.execute({
      newText: 'console.log("hello");',
      oldText: 'console.log("world");',
      path: TEST_FILE,
    })) as any;

    expect(result.success).toBe(true);
    const updated = fs.readFileSync(TEST_FILE, "utf8");
    expect(updated).toContain('console.log("hello");');
  });

  test("模糊匹配(字符差异容忍)", async () => {
    const content = `function test() {
  const value = 100;
  return value * 2;
}`;
    fs.writeFileSync(TEST_FILE, content, "utf8");

    // 搜索文本有轻微拼写差异(valuee 而非 value)，但相似度足够高
    const result = (await fsEditTool.execute({
      newText: "const result = 200;",
      oldText: "const valuee = 100;",
      path: TEST_FILE,
    })) as any;

    expect(result.success).toBe(true);
    expect(result.fuzzyMatch).toBe(true);
  });

  test("匹配失败时显示增强错误信息", async () => {
    const content = `function foo() {
  return 42;
}

function bar() {
  return 100;
}`;
    fs.writeFileSync(TEST_FILE, content, "utf8");

    // 搜索完全不存在的内容(不会被模糊匹配)
    const result = (await fsEditTool.execute({
      newText: "import React, { useState } from 'react';",
      oldText: "import React from 'react';\nimport { useState } from 'react';",
      path: TEST_FILE,
    })) as any;

    expect(result.success).toBe(false);
    expect(result.error).toContain("未找到匹配文本");
  });

  test("结构分析集成(编辑后文件状态)", async () => {
    const content = `function broken() {
  if (true) {
    console.log("test");
  }
}`;
    fs.writeFileSync(TEST_FILE, content, "utf8");

    const result = (await fsEditTool.execute({
      newText: 'console.log("updated");',
      oldText: 'console.log("test");',
      path: TEST_FILE,
    })) as any;

    expect(result.success).toBe(true);
    // 验证编辑成功
    const updated = fs.readFileSync(TEST_FILE, "utf8");
    expect(updated).toContain('console.log("updated");');

    // StructureWarnings 仅在检测到问题时返回
    if (result.structureWarnings) {
      expect(Array.isArray(result.structureWarnings)).toBe(true);
    }
  });
});
