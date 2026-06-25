/**
 * SymbolExtractor 测试
 *
 * 测试符号提取功能:
 *   - TypeScript/JavaScript 符号提取
 *   - Python 符号提取
 *   - LSP 符号提取(如果可用)
 *   - 正则回退方案
 *   - 嵌套符号处理
 *   - 边界情况
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SymbolExtractor } from "@/tool/codebaseSearch/indexer/symbolExtractor";
import fs from "node:fs";
import path from "node:path";

const TEST_DIR = path.join(process.cwd(), "test-temp-symbol-extractor");

describe("SymbolExtractor", () => {
  let extractor: SymbolExtractor;

  beforeEach(() => {
    extractor = new SymbolExtractor(TEST_DIR);
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { force: true, recursive: true });
    }
  });

  test("提取 TypeScript 函数", async () => {
    const content = `export function hello(name: string): string {
  return \`Hello, \${name}!\`;
}

function goodbye() {
  console.log("Goodbye!");
}`;
    const filePath = path.join(TEST_DIR, "test.ts");
    fs.writeFileSync(filePath, content, "utf8");

    const symbols = await extractor.extractSymbols(filePath);

    expect(symbols.length).toBeGreaterThanOrEqual(2);

    const helloSymbol = symbols.find((s) => s.name === "hello");
    expect(helloSymbol).toBeDefined();
    expect(helloSymbol?.kind).toBe("function");
    expect(helloSymbol?.startLine).toBe(1);
    expect(helloSymbol?.languageId).toBe("typescript");

    const goodbyeSymbol = symbols.find((s) => s.name === "goodbye");
    expect(goodbyeSymbol).toBeDefined();
    expect(goodbyeSymbol?.kind).toBe("function");
  });

  test("提取 TypeScript 类", async () => {
    const content = `export class User {
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  getName(): string {
    return this.name;
  }
}`;
    const filePath = path.join(TEST_DIR, "user.ts");
    fs.writeFileSync(filePath, content, "utf8");

    const symbols = await extractor.extractSymbols(filePath);

    const classSymbol = symbols.find((s) => s.name === "User" && s.kind === "class");
    expect(classSymbol).toBeDefined();
    expect(classSymbol?.startLine).toBe(1);
    expect(classSymbol?.signature).toContain("class User");
  });

  test("提取 TypeScript 接口", async () => {
    const content = `export interface Person {
  name: string;
  age: number;
}

interface Animal {
  species: string;
}`;
    const filePath = path.join(TEST_DIR, "interfaces.ts");
    fs.writeFileSync(filePath, content, "utf8");

    const symbols = await extractor.extractSymbols(filePath);

    expect(symbols.length).toBeGreaterThanOrEqual(2);

    const personSymbol = symbols.find((s) => s.name === "Person");
    expect(personSymbol).toBeDefined();
    expect(personSymbol?.kind).toBe("interface");

    const animalSymbol = symbols.find((s) => s.name === "Animal");
    expect(animalSymbol).toBeDefined();
    expect(animalSymbol?.kind).toBe("interface");
  });

  test("提取 TypeScript 枚举和常量", async () => {
    const content = `export enum Status {
  Active,
  Inactive
}

export const MAX_SIZE = 100;
const MIN_SIZE = 10;`;
    const filePath = path.join(TEST_DIR, "constants.ts");
    fs.writeFileSync(filePath, content, "utf8");

    const symbols = await extractor.extractSymbols(filePath);

    const enumSymbol = symbols.find((s) => s.name === "Status" && s.kind === "enum");
    expect(enumSymbol).toBeDefined();

    const maxSizeSymbol = symbols.find((s) => s.name === "MAX_SIZE");
    expect(maxSizeSymbol).toBeDefined();
    expect(maxSizeSymbol?.kind).toBe("constant");
  });

  test("提取 Python 函数", async () => {
    const content = `def calculate_sum(a: int, b: int) -> int:
    """Calculate sum of two numbers"""
    return a + b

async def fetch_data(url: str):
    print(f"Fetching {url}")
    return None`;
    const filePath = path.join(TEST_DIR, "test.py");
    fs.writeFileSync(filePath, content, "utf8");

    const symbols = await extractor.extractSymbols(filePath);

    expect(symbols.length).toBeGreaterThanOrEqual(2);

    const sumSymbol = symbols.find((s) => s.name === "calculate_sum");
    expect(sumSymbol).toBeDefined();
    expect(sumSymbol?.kind).toBe("function");
    expect(sumSymbol?.languageId).toBe("python");

    const fetchSymbol = symbols.find((s) => s.name === "fetch_data");
    expect(fetchSymbol).toBeDefined();
    expect(fetchSymbol?.kind).toBe("function");
  });

  test("提取 Python 类", async () => {
    const content = `class Animal:
    def __init__(self, name: str):
        self.name = name

    def speak(self):
        pass

class Dog(Animal):
    def speak(self):
        return "Woof!"`;
    const filePath = path.join(TEST_DIR, "animal.py");
    fs.writeFileSync(filePath, content, "utf8");

    const symbols = await extractor.extractSymbols(filePath);

    const animalSymbol = symbols.find((s) => s.name === "Animal" && s.kind === "class");
    expect(animalSymbol).toBeDefined();
    expect(animalSymbol?.startLine).toBe(1);

    const dogSymbol = symbols.find((s) => s.name === "Dog" && s.kind === "class");
    expect(dogSymbol).toBeDefined();
  });

  test("空文件不返回符号", async () => {
    const filePath = path.join(TEST_DIR, "empty.ts");
    fs.writeFileSync(filePath, "", "utf8");

    const symbols = await extractor.extractSymbols(filePath);
    expect(symbols.length).toBe(0);
  });

  test("未知语言返回空数组", async () => {
    const filePath = path.join(TEST_DIR, "data.json");
    fs.writeFileSync(filePath, '{"key": "value"}', "utf8");

    const symbols = await extractor.extractSymbols(filePath);
    expect(symbols.length).toBe(0);
  });

  test("不存在的文件返回空数组", async () => {
    const filePath = path.join(TEST_DIR, "nonexistent.ts");

    const symbols = await extractor.extractSymbols(filePath);
    expect(symbols.length).toBe(0);
  });

  test("符号有正确的行号", async () => {
    const content = `// Line 1
function first()

// Line 4
function second() {}

// Line 7
class Third {}`;
    const filePath = path.join(TEST_DIR, "lines.ts");
    fs.writeFileSync(filePath, content, "utf8");

    const symbols = await extractor.extractSymbols(filePath);

    const firstSymbol = symbols.find((s) => s.name === "first");
    expect(firstSymbol?.startLine).toBe(2);

    const secondSymbol = symbols.find((s) => s.name === "second");
    expect(secondSymbol?.startLine).toBe(5);

    const thirdSymbol = symbols.find((s) => s.name === "Third");
    expect(thirdSymbol?.startLine).toBe(8);
  });

  test("每个符号有唯一 ID", async () => {
    const content = `function foo() {}
class Bar {}
const baz = 42;`;
    const filePath = path.join(TEST_DIR, "unique.ts");
    fs.writeFileSync(filePath, content, "utf8");

    const symbols = await extractor.extractSymbols(filePath);

    expect(symbols.length).toBeGreaterThan(0);

    const ids = symbols.map((s) => s.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);

    // ID 格式验证:filePath:lineNumber:name
    for (const symbol of symbols) {
      expect(symbol.id).toContain(filePath);
      expect(symbol.id).toContain(`:${symbol.startLine}:`);
      expect(symbol.id).toContain(symbol.name);
    }
  });

  test("JavaScript 文件符号提取", async () => {
    const content = `export function hello(name) {
  return \`Hello, \${name}!\`;
}

class MyClass {
  constructor() {
    this.value = 0;
  }
}`;
    const filePath = path.join(TEST_DIR, "test.js");
    fs.writeFileSync(filePath, content, "utf8");

    const symbols = await extractor.extractSymbols(filePath);

    expect(symbols.length).toBeGreaterThanOrEqual(2);
    expect(symbols.some((s) => s.name === "hello" && s.kind === "function")).toBe(true);
    expect(symbols.some((s) => s.name === "MyClass" && s.kind === "class")).toBe(true);
  });

  test("Type 别名提取", async () => {
    const content = `export type UserId = string;
type Point = { x: number; y: number };`;
    const filePath = path.join(TEST_DIR, "types.ts");
    fs.writeFileSync(filePath, content, "utf8");

    const symbols = await extractor.extractSymbols(filePath);

    const userIdSymbol = symbols.find((s) => s.name === "UserId");
    expect(userIdSymbol).toBeDefined();
    expect(userIdSymbol?.kind).toBe("type");

    const pointSymbol = symbols.find((s) => s.name === "Point");
    expect(pointSymbol).toBeDefined();
    expect(pointSymbol?.kind).toBe("type");
  });
});
