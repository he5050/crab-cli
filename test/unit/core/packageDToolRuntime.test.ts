/**
 * Package.json 工具运行时测试。
 *
 * 测试目标:
 *   - 验证 package.json 类型工具(packageD)的运行时调用与解析
 *
 * 测试用例:
 *   - 在临时项目中调用 packageD 工具
 *   - 缺失字段/格式错误时的处理
 *   - 临时目录的清理
 */
import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

import gitTool from "@/tool/git";
import formatTool from "@/tool/format";
import { notebookEditTool, notebookReadTool } from "@/tool/notebookJupyter";

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  // 在项目目录下创建临时目录，避免 notebook-edit 的路径遍历防护拦截
  const dir = fs.mkdtempSync(path.join(process.cwd(), ".crab", "tmp", "tests", prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

describe("Package D tool runtime proof", () => {
  test("git 工具可在真实临时仓库中返回 status", async () => {
    const repoDir = createTempDir("crab-git-tool-");
    execSync("git init", { cwd: repoDir, stdio: "pipe" });
    fs.writeFileSync(path.join(repoDir, "README.md"), "# crab-cli\n", "utf8");

    const result = (await gitTool.execute({
      operation: "status",
      path: repoDir,
    })) as { message?: string; success: boolean };

    expect(result.success).toBe(true);
    expect(result.message ?? "").toContain("##");
    expect(result.message ?? "").toContain("README.md");
  });

  test("format 工具支持 preview 和 write 两条执行路径", async () => {
    const tmpDir = createTempDir("crab-format-tool-");
    const filePath = path.join(tmpDir, "data.json");
    fs.writeFileSync(filePath, '{"b":2,"a":1}', "utf8");

    const preview = (await formatTool.execute({
      path: filePath,
      write: false,
    })) as { message?: string; success: boolean };

    expect(preview.success).toBe(true);
    expect(preview.message ?? "").toContain("格式化预览");
    expect(preview.message ?? "").toContain('"b": 2');
    expect(fs.readFileSync(filePath, "utf8")).toBe('{"b":2,"a":1}');

    const writeResult = (await formatTool.execute({
      path: filePath,
      write: true,
    })) as { message?: string; success: boolean };

    expect(writeResult.success).toBe(true);
    expect(writeResult.message ?? "").toContain("已格式化");
    expect(fs.readFileSync(filePath, "utf8")).toContain('\n  "a": 1\n');
  });

  test("notebook-edit 和 notebook-read 形成直接往返链路", async () => {
    const tmpDir = createTempDir("crab-notebook-tool-");
    const notebookPath = path.join(tmpDir, "demo.ipynb");

    fs.writeFileSync(
      notebookPath,
      JSON.stringify(
        {
          cells: [
            {
              cell_type: "code",
              execution_count: 1,
              metadata: {},
              outputs: [{ output_type: "stream", text: ["hello\n"] }],
              source: ["print('hello')"],
            },
          ],
          metadata: { language_info: { name: "python" } },
          nbformat: 4,
          nbformat_minor: 5,
        },
        null,
        1,
      ),
      "utf8",
    );

    const editResult = (await notebookEditTool.execute({
      action: "add",
      cellIndex: 1,
      cellType: "markdown",
      path: notebookPath,
      source: "## Follow-up",
    })) as Record<string, unknown>;

    expect(editResult.success).toBe(true);
    expect(editResult.totalCells).toBe(2);

    const readResult = (await notebookReadTool.execute({
      path: notebookPath,
    })) as Record<string, any>;

    expect(readResult.success).toBe(true);
    expect(readResult.totalCells).toBe(2);
    expect(readResult.cells[1].type).toBe("markdown");
    expect(readResult.cells[1].source).toContain("## Follow-up");
    expect(readResult.content).toContain("[markdown]");
  });
});
