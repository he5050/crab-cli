/**
 * P2-3: Office 文档索引测试
 *
 * 测试范围:
 *   1. shouldIncludeFile 支持 Office 扩展名
 *   2. chunkDocument 正确分块文档
 *   3. fullIndex 索引包含文档的项目
 *   4. 配置控制文档索引行为
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AppConfigSchema } from "@/schema/config";
import { AppConfigSchema as AppConfigSchemaZod } from "@/schema/config";
import { CodebaseIndexer } from "@/tool/codebaseSearch/indexer/codebaseIndexer";
import { VectorDb } from "@/tool/codebaseSearch/indexer/vectorDb";

function createConfig(codebase: Partial<AppConfigSchema["codebase"]>): AppConfigSchema {
  const parsed = AppConfigSchemaZod.parse({
    codebase: {
      ...codebase,
      maxFileSize: Math.max(codebase.maxFileSize ?? 1_048_576, 1024),
    },
  });
  return {
    ...parsed,
    codebase: {
      ...parsed.codebase,
      ...codebase,
    },
  };
}

describe("P2-3: Office 文档索引", () => {
  let testDir: string;
  let indexer: CodebaseIndexer;
  let db: VectorDb;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "office-index-test-"));
    db = new VectorDb({ dbPath: ":memory:" });
  });

  test("配置禁用时不索引 Office 文档", () => {
    const config = createConfig({
      documentTypes: ["pdf", "docx", "xlsx", "pptx"],
      ignorePatterns: [],
      includeDocuments: false, // 禁用
      indexingEnabled: true,
      maxFileSize: 1_048_576,
      watchMode: true,
    });

    indexer = new CodebaseIndexer({
      appConfig: config,
      db,
      onProgress: () => {},
      rootDir: testDir,
    });

    // @ts-expect-error - 访问私有方法用于测试
    expect(indexer.shouldIncludeFile(join(testDir, "doc.docx"))).toBe(false);
    // @ts-expect-error - 访问私有方法用于测试
    expect(indexer.shouldIncludeFile(join(testDir, "data.xlsx"))).toBe(false);
    // @ts-expect-error - 访问私有方法用于测试
    expect(indexer.shouldIncludeFile(join(testDir, "slide.pptx"))).toBe(false);
    // @ts-expect-error - 访问私有方法用于测试
    expect(indexer.shouldIncludeFile(join(testDir, "report.pdf"))).toBe(false);
  });

  test("配置启用时索引指定类型的 Office 文档", () => {
    // 只启用 docx 和 pdf
    const config = createConfig({
      documentTypes: ["docx", "pdf"], // 仅这两种
      ignorePatterns: [],
      includeDocuments: true,
      indexingEnabled: true,
      maxFileSize: 1_048_576,
      watchMode: true,
    });

    indexer = new CodebaseIndexer({
      appConfig: config,
      db,
      onProgress: () => {},
      rootDir: testDir,
    });

    // 创建测试文件(空文件)
    writeFileSync(join(testDir, "doc.docx"), "test content");
    writeFileSync(join(testDir, "report.pdf"), "test content");
    writeFileSync(join(testDir, "data.xlsx"), "test content");
    writeFileSync(join(testDir, "slide.pptx"), "test content");

    // @ts-expect-error - 访问私有方法用于测试
    expect(indexer.shouldIncludeFile(join(testDir, "doc.docx"))).toBe(true);
    // @ts-expect-error - 访问私有方法用于测试
    expect(indexer.shouldIncludeFile(join(testDir, "report.pdf"))).toBe(true);
    // @ts-expect-error - 访问私有方法用于测试
    expect(indexer.shouldIncludeFile(join(testDir, "data.xlsx"))).toBe(false);
    // @ts-expect-error - 访问私有方法用于测试
    expect(indexer.shouldIncludeFile(join(testDir, "slide.pptx"))).toBe(false);
  });

  test("代码文件不受 includeDocuments 配置影响", () => {
    const config = createConfig({
      documentTypes: ["pdf", "docx", "xlsx", "pptx"],
      ignorePatterns: [],
      includeDocuments: false,
      indexingEnabled: true,
      maxFileSize: 1_048_576,
      watchMode: true,
    });

    indexer = new CodebaseIndexer({
      appConfig: config,
      db,
      onProgress: () => {},
      rootDir: testDir,
    });

    // 创建代码文件
    writeFileSync(join(testDir, "index.ts"), "export const x = 1;");
    writeFileSync(join(testDir, "main.py"), "print('hello')");

    // @ts-expect-error - 访问私有方法用于测试
    expect(indexer.shouldIncludeFile(join(testDir, "index.ts"))).toBe(true);
    // @ts-expect-error - 访问私有方法用于测试
    expect(indexer.shouldIncludeFile(join(testDir, "main.py"))).toBe(true);
  });

  test("chunkDocument 处理模拟文档内容", async () => {
    const config = createConfig({
      documentTypes: ["pdf", "docx", "xlsx", "pptx"],
      ignorePatterns: [],
      includeDocuments: true,
      indexingEnabled: true,
      maxFileSize: 1_048_576,
      watchMode: true,
    });

    indexer = new CodebaseIndexer({
      appConfig: config,
      db,
      onProgress: () => {},
      rootDir: testDir,
    });

    // 创建模拟文档(实际解析会失败但能测试分块逻辑)
    const docPath = join(testDir, "test.docx");
    writeFileSync(docPath, "mock docx content");

    // ChunkFile 会按文档扩展名分流到文档分块实现，如果解析失败返回空数组
    const chunks = await indexer.chunkFile(docPath);

    // 由于是 mock 文件无法解析，应返回空数组
    expect(Array.isArray(chunks)).toBe(true);
    expect(chunks.length).toBe(0);
  });

  test("chunkDocument 将超长文档段落按 3000 字符上限切分", async () => {
    const config = createConfig({
      documentTypes: ["docx"],
      ignorePatterns: [],
      includeDocuments: true,
      indexingEnabled: true,
      maxFileSize: 1_048_576,
      watchMode: true,
    });

    indexer = new CodebaseIndexer({
      appConfig: config,
      db,
      onProgress: () => {},
      rootDir: testDir,
    });

    const docPath = join(testDir, "long.docx");
    writeFileSync(docPath, `<w:t>${"x".repeat(6500)}</w:t>`);

    const chunks = await indexer.chunkFile(docPath);

    expect(chunks.length).toBe(3);
    expect(chunks.every((chunk) => chunk.content.length <= 3000)).toBe(true);
    expect(new Set(chunks.map((chunk) => chunk.id)).size).toBe(3);
  });

  test("解析失败的文档增量索引返回 0 且不中断", async () => {
    indexer = new CodebaseIndexer({
      db,
      onProgress: () => {},
      rootDir: testDir,
    });

    const docPath = join(testDir, "broken.pdf");
    writeFileSync(docPath, "not a real pdf");

    const indexedCount = await indexer.indexFile(docPath);

    expect(indexedCount).toBe(0);
  });

  test("超过大小限制的文档被跳过", () => {
    const config = createConfig({
      documentTypes: ["docx"],
      ignorePatterns: [],
      includeDocuments: true,
      indexingEnabled: true,
      maxFileSize: 100, // 只允许 100 字节
      watchMode: true,
    });

    indexer = new CodebaseIndexer({
      appConfig: config,
      db,
      onProgress: () => {},
      rootDir: testDir,
    });

    // 创建大文件
    const bigDoc = join(testDir, "big.docx");
    writeFileSync(bigDoc, "x".repeat(200)); // 200 字节

    // @ts-expect-error - 访问私有方法用于测试
    expect(indexer.shouldIncludeFile(bigDoc)).toBe(false);
  });
});
