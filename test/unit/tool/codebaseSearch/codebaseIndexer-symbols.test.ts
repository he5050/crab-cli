/**
 * CodebaseIndexer 符号索引集成测试
 *
 * 测试符号索引功能:
 *   - 全量索引时提取符号
 *   - 增量索引时更新符号
 *   - 删除文件时同时删除符号
 *   - 符号向量存储和检索
 *   - 符号统计信息
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CodebaseIndexer } from "@/tool/codebaseSearch/indexer/codebaseIndexer";
import { VectorDb } from "@/tool/codebaseSearch/indexer/vectorDb";
import fs from "node:fs";
import path from "node:path";

const TEST_DIR = path.join(process.cwd(), "test-temp-indexer-symbols");
const DB_PATH = path.join(TEST_DIR, "test.db");

describe("CodebaseIndexer — 符号索引", () => {
  let db: VectorDb;
  let indexer: CodebaseIndexer;

  beforeEach(() => {
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }

    // 创建向量数据库
    db = new VectorDb({ dbPath: DB_PATH });

    // 创建索引器(无 API 配置，使用零向量)
    indexer = new CodebaseIndexer({
      db,
      rootDir: TEST_DIR,
    });
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { force: true, recursive: true });
    }
  });

  test("indexFile 提取并索引符号", async () => {
    const content = `export function hello(name: string): string {
  return \`Hello, \${name}!\`;
}

export class User {
  constructor(public name: string) {}

  greet(): string {
    return hello(this.name);
  }
}`;
    const filePath = path.join(TEST_DIR, "test.ts");
    fs.writeFileSync(filePath, content, "utf8");

    const count = await indexer.indexFile(filePath);

    // 应该有代码块 + 符号(函数 hello, 类 User, 方法 greet)
    expect(count).toBeGreaterThan(0);

    // 检查符号统计
    const stats = db.getSymbolStats();
    expect(stats.totalSymbols).toBeGreaterThanOrEqual(2); // 至少 hello 和 User
    expect(stats.byKind.function).toBeGreaterThanOrEqual(1);
    expect(stats.byKind.class).toBe(1);
  });

  test("indexFile 不同语言的符号提取", async () => {
    // TypeScript
    const tsContent = `export interface Person {
  name: string;
  age: number;
}`;
    const tsPath = path.join(TEST_DIR, "person.ts");
    fs.writeFileSync(tsPath, tsContent, "utf8");

    // Python
    const pyContent = `def calculate(a: int, b: int) -> int:
    return a + b

class Calculator:
    def multiply(self, a, b):
        return a * b`;
    const pyPath = path.join(TEST_DIR, "calc.py");
    fs.writeFileSync(pyPath, pyContent, "utf8");

    await indexer.indexFile(tsPath);
    await indexer.indexFile(pyPath);

    const stats = db.getSymbolStats();
    expect(stats.totalSymbols).toBeGreaterThanOrEqual(3); // Person, calculate, Calculator
    expect(stats.totalFiles).toBe(2);
  });

  test("removeFile 同时删除代码块和符号", async () => {
    const content = `function foo() {}
class Bar {}`;
    const filePath = path.join(TEST_DIR, "remove.ts");
    fs.writeFileSync(filePath, content, "utf8");

    // 索引
    await indexer.indexFile(filePath);

    const statsBefore = db.getSymbolStats();
    expect(statsBefore.totalSymbols).toBeGreaterThanOrEqual(2);

    // 删除
    const deleted = indexer.removeFile(filePath);
    expect(deleted).toBeGreaterThan(0);

    const statsAfter = db.getSymbolStats();
    expect(statsAfter.totalSymbols).toBe(0);
  });

  test("fullIndex 索引整个项目的符号", async () => {
    // 创建多个文件
    const file1 = path.join(TEST_DIR, "utils.ts");
    fs.writeFileSync(file1, "export function add(a: number, b: number) { return a + b; }", "utf8");

    const file2 = path.join(TEST_DIR, "types.ts");
    fs.writeFileSync(file2, "export interface Config { port: number; }", "utf8");

    const file3 = path.join(TEST_DIR, "main.py");
    fs.writeFileSync(file3, "def main():\n    print('Hello')", "utf8");

    const result = await indexer.fullIndex();

    expect(result.filesProcessed).toBe(3);
    expect(result.chunksGenerated).toBeGreaterThan(0);
    expect(result.symbolsGenerated).toBeGreaterThanOrEqual(3); // Add, Config, main

    const stats = db.getSymbolStats();
    expect(stats.totalSymbols).toBeGreaterThanOrEqual(3);
    expect(stats.totalFiles).toBe(3);
  });

  test("增量索引:文件修改后更新符号", async () => {
    const filePath = path.join(TEST_DIR, "incremental.ts");

    // 初始版本
    fs.writeFileSync(filePath, "function oldFunc() {}", "utf8");
    await indexer.indexFile(filePath);

    const stats1 = db.getSymbolStats();
    const initialCount = stats1.totalSymbols;

    // 修改文件(添加新符号)
    await new Promise((resolve) => setTimeout(resolve, 10)); // 确保 mtime 变化
    fs.writeFileSync(filePath, "function oldFunc() {}\nfunction newFunc() {}", "utf8");

    // 增量索引应该检测到变化
    await indexer.indexFile(filePath);

    const stats2 = db.getSymbolStats();
    expect(stats2.totalSymbols).toBeGreaterThan(initialCount);

    // 验证新符号存在
    const symbols = db.findSymbolsByName("newFunc");
    expect(symbols.length).toBe(1);
    expect(symbols[0]?.kind).toBe("function");
  });

  test("符号按名称精确查找", async () => {
    const content = `export class MyClass {}
export function myFunc() {}
export const MY_CONST = 42;`;
    const filePath = path.join(TEST_DIR, "names.ts");
    fs.writeFileSync(filePath, content, "utf8");

    await indexer.indexFile(filePath);

    // 查找类
    const classSymbols = db.findSymbolsByName("MyClass");
    expect(classSymbols.length).toBe(1);
    expect(classSymbols[0]?.kind).toBe("class");
    expect(classSymbols[0]?.filePath).toBe(filePath);

    // 查找函数
    const funcSymbols = db.findSymbolsByName("myFunc");
    expect(funcSymbols.length).toBe(1);
    expect(funcSymbols[0]?.kind).toBe("function");

    // 查找常量
    const constSymbols = db.findSymbolsByName("MY_CONST");
    expect(constSymbols.length).toBe(1);
    expect(constSymbols[0]?.kind).toBe("constant");
  });

  test("符号统计按类型分组", async () => {
    const content = `export function func1() {}
export function func2() {}
export class Class1 {}
export interface Interface1 {}
export const CONST1 = 1;`;
    const filePath = path.join(TEST_DIR, "stats.ts");
    fs.writeFileSync(filePath, content, "utf8");

    await indexer.indexFile(filePath);

    const stats = db.getSymbolStats();
    expect(stats.byKind.function).toBeGreaterThanOrEqual(2);
    expect(stats.byKind.class).toBeGreaterThanOrEqual(1);
    expect(stats.byKind.interface).toBeGreaterThanOrEqual(1);
    expect(stats.byKind.constant).toBeGreaterThanOrEqual(1);
  });

  test("空文件不生成符号", async () => {
    const filePath = path.join(TEST_DIR, "empty.ts");
    fs.writeFileSync(filePath, "", "utf8");

    const count = await indexer.indexFile(filePath);
    expect(count).toBe(0);

    const stats = db.getSymbolStats();
    expect(stats.totalSymbols).toBe(0);
  });

  test("不支持的语言不生成符号", async () => {
    const filePath = path.join(TEST_DIR, "data.json");
    fs.writeFileSync(filePath, '{"key": "value"}', "utf8");

    const count = await indexer.indexFile(filePath);
    // JSON 文件会生成代码块，但不生成符号
    expect(count).toBeGreaterThanOrEqual(0);

    const stats = db.getSymbolStats();
    expect(stats.totalSymbols).toBe(0);
  });
});
