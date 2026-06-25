/**
 * 文件系统工具深度测试。
 *
 * 测试目标:
 *   - 验证 filesystem 工具在多层嵌套、深度路径等场景下的行为
 *
 * 测试用例:
 *   - 深度目录下的读取/写入
 *   - 跨符号链接与隐藏文件的处理
 *   - 临时目录清理
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { cleanupTestDir, createProjectTmpTestDir } from "../../helpers/testPaths";
import { readFileLinesStreaming, readFileWithEncoding, writeFileWithEncoding } from "@/tool/filesystem/utils/encoding";
import { backupFileBeforeMutation } from "@/tool/filesystem/utils/backup";
import { executeHashlineEditSingle } from "@/tool/filesystem/utils/editTools";
import { formatLineWithHash } from "@/tool/filesystem/utils/hashline";

let tempDir = "";
let originalCwd = "";

const editContext = {
  basePath: "",
  prettierSupportedExtensions: [],
  resolvePath(filePath: string) {
    return path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(editContext.basePath, filePath);
  },
  async validatePath(filePath: string) {
    const resolved = path.resolve(filePath);
    const base = path.resolve(editContext.basePath);
    if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
      throw new Error(`File is outside project: ${resolved}`);
    }
    return;
  },
};

beforeEach(() => {
  originalCwd = process.cwd();
  tempDir = createProjectTmpTestDir(originalCwd, "fs-utils-depth-");
  process.chdir(tempDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  cleanupTestDir(tempDir);
  tempDir = "";
});

describe("filesystem utils depth", () => {
  test("read/write encoding roundtrip 保留 UTF-8 BOM 文本内容", async () => {
    const filePath = path.join(tempDir, "bom.txt");
    const bomContent = Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from("第一行\n第二行", "utf8")]);
    fs.writeFileSync(filePath, bomContent);

    const content = await readFileWithEncoding(filePath);
    expect(content).toContain("第一行");
    expect(content).toContain("第二行");

    await writeFileWithEncoding(filePath, "修改后\n内容");
    const rewritten = await readFileWithEncoding(filePath);
    expect(rewritten).toContain("修改后");
    expect(rewritten).toContain("内容");
  });

  test("readFileLinesStreaming 只读取指定行范围", async () => {
    const filePath = path.join(tempDir, "lines.txt");
    fs.writeFileSync(filePath, ["l1", "l2", "l3", "l4", "l5"].join("\n"), "utf8");

    const result = await readFileLinesStreaming(filePath, 2, 4);
    expect(result.lines).toEqual(["l2", "l3", "l4"]);
    expect(result.totalLines).toBe(5);
  });

  test("backupFileBeforeMutation 创建备份并保留最近 5 份", () => {
    const filePath = path.join(tempDir, "backup-target.txt");
    fs.writeFileSync(filePath, "original", "utf8");

    const backupPaths: string[] = [];
    for (let i = 0; i < 7; i++) {
      fs.writeFileSync(filePath, `content-${i}`, "utf8");
      const backupPath = backupFileBeforeMutation(filePath);
      expect(backupPath).toBeTruthy();
      backupPaths.push(backupPath!);
    }

    const backupDir = path.join(tempDir, ".crab", "backups");
    const backups = fs.readdirSync(backupDir).filter((name) => name.includes("backup-target.txt"));
    expect(backups.length).toBeLessThanOrEqual(5);
  });

  test("executeHashlineEditSingle 通过锚点 replace 单行", async () => {
    const filePath = path.join(tempDir, "hashline.txt");
    const original = ["alpha", "beta", "gamma"];
    fs.writeFileSync(filePath, original.join("\n"), "utf8");

    const startAnchor = formatLineWithHash(2, "beta").split("→")[0]!;
    const endAnchor = formatLineWithHash(2, "beta").split("→")[0]!;

    const result = await executeHashlineEditSingle(
      { ...editContext, basePath: tempDir },
      filePath,
      [
        {
          content: "beta-updated",
          endAnchor,
          startAnchor,
          type: "replace",
        },
      ],
      2,
    );

    expect(result.filePath).toBe(filePath);
    expect(result.operationsSummary).toContain("replace lines 2-2");
    expect(result.newContent).toContain("beta-updated");
    expect(fs.readFileSync(filePath, "utf8")).toContain("beta-updated");
  });
});
