/**
 * 补丁应用工具 — 应用统一 diff 格式的补丁。
 *
 * 职责:
 *   - 解析 unified diff 格式补丁
 *   - 应用补丁到目标文件
 *   - 自动创建不存在的父目录
 *   - 支持多文件补丁
 *
 * 模块功能:
 *   - applyPatchTool: 补丁应用工具定义
 *   - parseUnifiedDiff: 解析统一 diff 格式
 *   - applyHunk: 应用补丁块
 *
 * 使用场景:
 *   - AI 需要应用代码补丁
 *   - 批量文件修改
 *   - 代码迁移
 *
 * 边界:
 *   1. 权限:fs.edit
 *   2. 支持标准 unified diff 格式
 *   3. 自动创建父目录
 *   4. 支持多文件补丁
 *   5. 解析失败返回错误
 *
 * 流程:
 *   1. 接收补丁内容
 *   2. 解析 unified diff
 *   3. 提取补丁块
 *   4. 应用到目标文件
 *   5. 返回应用结果
 */
import { z } from "zod";
import { defineTool } from "@/tool/types";
import { recordFileMutation } from "@/tool/rollback";
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@/core/logging/logger";
import { createSearchToolError, toSearchToolFailure } from "./errors";

const log = createLogger("tool:apply_patch");

/** 补丁应用工具，将 unified diff 格式补丁应用到目标文件 */
export const applyPatchTool = defineTool({
  description:
    "应用统一 diff 格式的补丁到文件。补丁可以是完整的 unified diff 格式，" +
    "也可以是简化的搜索替换格式。会自动创建不存在的父目录。",
  execute: async ({ patch, path: filePath }) => {
    try {
      const hunks = parseUnifiedDiff(patch);
      if (hunks.length === 0) {
        const appError = createSearchToolError(
          new Error("无法解析补丁内容。请确认使用正确的 unified diff 格式。"),
          { operation: "parse-patch", path: filePath, toolName: "apply-patch" },
          "TOOL_PARAM_ERROR",
        );
        return { success: false, ...toSearchToolFailure(appError) };
      }

      const results: Record<string, unknown>[] = [];

      for (const hunk of hunks) {
        const targetPath = filePath ? path.resolve(filePath) : hunk.file;

        if (!targetPath) {
          const appError = createSearchToolError(
            new Error("未指定目标文件路径"),
            { operation: "resolve-target", toolName: "apply-patch" },
            "TOOL_PARAM_ERROR",
          );
          results.push({ success: false, ...toSearchToolFailure(appError) });
          continue;
        }

        // 确保父目录存在
        const dir = path.dirname(targetPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        // 如果文件不存在且 hunk 是新增文件
        if (!fs.existsSync(targetPath)) {
          // 从 hunk 中提取新文件内容(只包含 + 行)
          const newContent = hunk.changes
            .filter((c) => c.type === "add")
            .map((c) => c.text)
            .join("\n");
          fs.writeFileSync(targetPath, newContent, "utf8");
          results.push({
            action: "create",
            linesAdded: hunk.changes.filter((c) => c.type === "add").length,
            path: targetPath,
            success: true,
          });
          continue;
        }

        // 读取现有文件并应用补丁
        const original = fs.readFileSync(targetPath, "utf8");
        const originalLines = original.split("\n");

        const { result, applied } = applyHunk(originalLines, hunk);

        if (!applied) {
          const appError = createSearchToolError(new Error("补丁上下文不匹配。文件可能已被修改。"), {
            operation: "apply-hunk",
            path: targetPath,
            toolName: "apply-patch",
          });
          results.push({
            path: targetPath,
            success: false,
            ...toSearchToolFailure(appError),
          });
          continue;
        }

        const modified = result.join("\n");
        fs.writeFileSync(targetPath, modified, "utf8");

        const added = hunk.changes.filter((c) => c.type === "add").length;
        const removed = hunk.changes.filter((c) => c.type === "remove").length;
        try {
          recordFileMutation({
            after: modified,
            before: original,
            filePath: targetPath,
            projectDir: process.cwd(),
            reason: `apply-patch: +${added} -${removed}`,
          });
        } catch {
          /* rollback不可用时静默跳过 */
        }

        results.push({
          action: "edit",
          linesAdded: added,
          linesRemoved: removed,
          path: targetPath,
          success: true,
        });

        log.info(`补丁已应用: ${targetPath} (+${added}/-${removed})`);
      }

      const allSuccess = results.every((r) => r.success);
      return {
        hunksApplied: results.filter((r) => r.success).length,
        hunksTotal: hunks.length,
        results,
        success: allSuccess,
      };
    } catch (error) {
      const appError = createSearchToolError(error, {
        operation: "execute",
        path: filePath,
        toolName: "apply-patch",
      });
      log.error(`补丁应用失败`, { code: appError.code, context: appError.context, error: appError.message });
      return { success: false, ...toSearchToolFailure(appError) };
    }
  },
  name: "apply-patch",
  parameters: z.object({
    /** 补丁内容(unified diff 格式) */
    patch: z.string().describe("统一 diff 格式的补丁内容"),
    /** 目标文件路径(如果补丁中没有指定，此参数必填) */
    path: z.string().optional().describe("目标文件路径(如果补丁头中未指定则必填)"),
  }),
  permission: "fs.edit",
  builtin: true,
});

/** Diff 变更行 */
interface DiffChange {
  type: "context" | "add" | "remove";
  text: string;
}

/** Diff hunk */
interface DiffHunk {
  file: string | null;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  changes: DiffChange[];
}

/** 解析 unified diff */
function parseUnifiedDiff(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const lines = patch.split("\n");
  let currentFile: string | null = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // 文件头
    if (line.startsWith("--- ")) {
      // 跳过 --- 行，等 +++ 获取文件名
      i++;
      continue;
    }

    if (line.startsWith("+++ ")) {
      // 提取文件名(去掉 b/ 前缀)
      const filePath = line.slice(4).trim();
      currentFile = filePath.replace(/^[ab]\//, "");
      i++;
      continue;
    }

    // Hunk 头: @@ -1,3 +1,3 @@
    const hunkMatch = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
    if (hunkMatch) {
      const changes: DiffChange[] = [];
      i++; // 跳过 @@ 行

      while (i < lines.length) {
        const changeLine = lines[i]!;
        if (changeLine.startsWith("@@") || changeLine.startsWith("---") || changeLine.startsWith("+++")) {
          break;
        }
        if (changeLine.startsWith("+")) {
          changes.push({ text: changeLine.slice(1), type: "add" });
        } else if (changeLine.startsWith("-")) {
          changes.push({ text: changeLine.slice(1), type: "remove" });
        } else if (changeLine.startsWith(" ")) {
          changes.push({ text: changeLine.slice(1), type: "context" });
        } else if (changeLine === "") {
          // 空行可能是上下文
          changes.push({ text: "", type: "context" });
        }
        i++;
      }

      hunks.push({
        changes,
        file: currentFile,
        newCount: hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1,
        newStart: parseInt(hunkMatch[3]!, 10),
        oldCount: hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1,
        oldStart: parseInt(hunkMatch[1]!, 10),
      });
      continue;
    }

    i++;
  }

  return hunks;
}

/** 应用单个 hunk */
function applyHunk(originalLines: string[], hunk: DiffHunk): { result: string[]; applied: boolean } {
  const result = [...originalLines];

  // 计算应用位置(hunk.oldStart 从 1 开始)
  const startPos = hunk.oldStart - 1;

  // 验证上下文匹配
  let lineIdx = startPos;
  for (const change of hunk.changes) {
    if (change.type === "context" || change.type === "remove") {
      if (lineIdx >= result.length) {
        return { applied: false, result: originalLines };
      }
      const originalLine = result[lineIdx] ?? "";
      // 上下文行匹配(忽略首尾空白)
      if (originalLine.trimEnd() !== change.text.trimEnd()) {
        return { applied: false, result: originalLines };
      }
      lineIdx++;
    }
  }

  // 上下文匹配，执行替换
  // 删除旧行，插入新行
  const removeCount = hunk.changes.filter((c) => c.type === "remove" || c.type === "context").length;
  const insertLines = hunk.changes.filter((c) => c.type === "add" || c.type === "context").map((c) => c.text);

  result.splice(startPos, removeCount, ...insertLines);

  return { applied: true, result };
}
