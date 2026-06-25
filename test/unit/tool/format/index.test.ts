/**
 * format 工具模块测试
 *
 * 覆盖范围:
 *   - JSON 文件格式化 (write=true / write=false)
 *   - Markdown 文件格式化
 *   - TypeScript / CSS / HTML / YAML 基本格式化
 *   - 未知扩展名默认走 basicFormat
 *   - 文件不存在错误
 *   - write 模式 diff 信息
 *   - 无效 JSON 错误
 *   - Tab 转空格 / 尾部空白消除 / 多空行折叠
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { formatTool } from "@/tool/format/index";

// ─── 辅助 ──────────────────────────────────────────────────

/** 在临时目录中创建文件并写入指定内容，返回完整路径 */
function createTestFile(tmpDir: string, name: string, content: string): string {
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

describe("formatTool", () => {
  let tmpDir: string;
  const originalCwd = process.cwd();

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "crab-format-test-"));
    // 将 cwd 切换到临时目录，让 rollback 的 projectDir 可写
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── 1. JSON 格式化 (write=true) ──────────────────────────

  it("JSON 文件格式化 — write=true 写入规范化内容", async () => {
    const file = createTestFile(tmpDir, "data.json", '{"name":"crab","version":1}');

    const result = await formatTool.execute({ path: file, write: true });

    expect(result.success).toBe(true);
    expect(result.message).toContain("已格式化");
    // 读取写入后的内容验证
    const written = fs.readFileSync(file, "utf8");
    expect(written).toBe('{\n  "name": "crab",\n  "version": 1\n}\n');
  });

  // ── 2. JSON 格式化 (write=false / 预览模式) ──────────────

  it("JSON 文件格式化 — write=false 仅返回预览", async () => {
    const file = createTestFile(tmpDir, "data.json", '{"a":1}');

    const result = await formatTool.execute({ path: file, write: false });

    expect(result.success).toBe(true);
    expect(result.message).toContain("格式化预览");
    // 预览模式不应修改文件
    const unchanged = fs.readFileSync(file, "utf8");
    expect(unchanged).toBe('{"a":1}');
  });

  // ── 3. Markdown 格式化 ───────────────────────────────────

  it("Markdown 文件格式化 — tab 转空格、尾部空白清除、空行折叠", async () => {
    const file = createTestFile(tmpDir, "readme.md", "# Title\n\n\tindented\nline with spaces   \n\n\n\nend  ");

    const result = await formatTool.execute({ path: file, write: true });

    expect(result.success).toBe(true);
    const written = fs.readFileSync(file, "utf8");
    // tab → 两个空格，尾部空白移除，多个空行折叠为两个
    expect(written).toBe("# Title\n\n  indented\nline with spaces\n\nend\n");
  });

  // ── 4. TypeScript 基本格式化 (缩进修正 / 尾部空白) ────────

  it("TypeScript 文件 — basicFormat 统一换行与缩进", async () => {
    // 混合 tab 缩进 + 尾部空白
    const file = createTestFile(tmpDir, "app.ts", "const x = 1;\r\n\tconst y = 2;   \n\tconst z = 3;\t");

    const result = await formatTool.execute({ path: file, write: true });

    expect(result.success).toBe(true);
    const written = fs.readFileSync(file, "utf8");
    // detectIndent 检测到 tab，所以 tab → tab（保持一致），尾部空白移除
    expect(written).toBe("const x = 1;\n\tconst y = 2;\n\tconst z = 3;\n");
  });

  // ── 5. CSS 文件基本格式化 ────────────────────────────────

  it("CSS 文件 — basicFormat 统一换行与尾部空白", async () => {
    const file = createTestFile(tmpDir, "style.css", "body {  \r\n\tmargin: 0;  \r\n}\r\n");

    const result = await formatTool.execute({ path: file, write: true });

    expect(result.success).toBe(true);
    const written = fs.readFileSync(file, "utf8");
    expect(written).toBe("body {\n\tmargin: 0;\n}\n");
  });

  // ── 6. HTML 文件基本格式化 ───────────────────────────────

  it("HTML 文件 — basicFormat 统一换行", async () => {
    const file = createTestFile(tmpDir, "index.html", "<html>\r\n<body>\r\n</body>\r\n</html>");

    const result = await formatTool.execute({ path: file, write: true });

    expect(result.success).toBe(true);
    const written = fs.readFileSync(file, "utf8");
    expect(written).toBe("<html>\n<body>\n</body>\n</html>\n");
  });

  // ── 7. YAML 文件基本格式化 ───────────────────────────────

  it("YAML 文件 — basicFormat 统一换行与尾部空白", async () => {
    const file = createTestFile(tmpDir, "config.yaml", "name: crab\r\nversion: 1.0  \n");

    const result = await formatTool.execute({ path: file, write: true });

    expect(result.success).toBe(true);
    const written = fs.readFileSync(file, "utf8");
    expect(written).toBe("name: crab\nversion: 1.0\n");
  });

  // ── 8. 未知扩展名默认走 basicFormat ──────────────────────

  it("未知扩展名 — 默认使用 basicFormat 处理", async () => {
    const file = createTestFile(tmpDir, "data.xyz", "line one\r\n\tline two  ");

    const result = await formatTool.execute({ path: file, write: true });

    expect(result.success).toBe(true);
    const written = fs.readFileSync(file, "utf8");
    // CRLF → LF，尾部空白移除，tab 转缩进（检测到 tab 所以保持 tab）
    expect(written).toBe("line one\n\tline two\n");
  });

  // ── 9. 文件不存在返回错误 ────────────────────────────────

  it("文件不存在 — 返回 success=false 和错误信息", async () => {
    const missing = path.join(tmpDir, "nonexistent.json");

    const result = await formatTool.execute({ path: missing, write: true });

    expect(result.success).toBe(false);
    expect(result.error).toContain("文件不存在");
  });

  // ── 10. write=true 记录 diff 信息 ─────────────────────────

  it("write 模式 — message 中包含字符数 diff 信息", async () => {
    // 原内容无缩进无换行，格式化后会增加长度
    const file = createTestFile(tmpDir, "compact.json", '{"key":"value"}');

    const result = await formatTool.execute({ path: file, write: true });

    expect(result.success).toBe(true);
    expect(result.message).toContain("已格式化");
    expect(result.message).toMatch(/\d+ → \d+ 字符/);
  });

  // ── 11. 无效 JSON 返回错误 ───────────────────────────────

  it("无效 JSON — formatJson 抛出异常被捕获返回错误", async () => {
    const file = createTestFile(tmpDir, "broken.json", "{invalid json content}");

    const result = await formatTool.execute({ path: file, write: true });

    expect(result.success).toBe(false);
    expect(result.error).toContain("格式化失败");
  });

  // ── 12. Tab 转空格 — 当文件使用空格缩进时 ────────────────

  it("Tab 转空格 — basicFormat 将 tab 替换为检测到的空格缩进", async () => {
    // 文件用空格缩进，但内部混入了 tab
    const file = createTestFile(tmpDir, "mixed.ts", "function main() {\n  const x = 1;\n\tconst y = 2;\n}\n");

    const result = await formatTool.execute({ path: file, write: true });

    expect(result.success).toBe(true);
    const written = fs.readFileSync(file, "utf8");
    // detectIndent 检测到 "  "（空格），所以 tab → "  "
    expect(written).toBe("function main() {\n  const x = 1;\n  const y = 2;\n}\n");
  });

  // ── 13. 尾部空白移除 ─────────────────────────────────────

  it("尾部空白 — 每行末尾的空格和 tab 被移除", async () => {
    const file = createTestFile(tmpDir, "trailing.txt", "line one   \t \nline two\t\t\nline three  ");

    const result = await formatTool.execute({ path: file, write: true });

    expect(result.success).toBe(true);
    const written = fs.readFileSync(file, "utf8");
    expect(written).toBe("line one\nline two\nline three\n");
  });

  // ── 14. 多空行折叠 (Markdown 特有) ───────────────────────

  it("多空行折叠 — Markdown 中 3+ 连续空行压缩为 2 个换行", async () => {
    const file = createTestFile(tmpDir, "blanks.md", "paragraph one\n\n\n\n\nparagraph two\n");

    const result = await formatTool.execute({ path: file, write: true });

    expect(result.success).toBe(true);
    const written = fs.readFileSync(file, "utf8");
    expect(written).toBe("paragraph one\n\nparagraph two\n");
  });

  // ── 15. default export 与命名 export 一致 ─────────────────

  it("formatTool 的 name 和 description 符合预期", () => {
    expect(formatTool.name).toBe("format");
    expect(formatTool.description).toContain("格式化代码文件");
    expect(formatTool.permission).toBe("format");
    expect(typeof formatTool.execute).toBe("function");
  });
});
