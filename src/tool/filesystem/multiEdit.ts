/**
 * 多文件原子编辑工具 — 在一次调用中修改多个文件的不同位置。
 *
 * 职责:
 *   - 在一次调用中修改多个文件
 *   - 原子性操作(全部成功或全部回滚)
 *   - 支持预览模式
 *   - 生成 diff 报告
 *
 * 模块功能:
 *   - filesystemMultiEditTool: 多文件编辑工具定义
 *   - 原子性编辑操作
 *   - 批量搜索替换
 *   - 预览模式支持
 *
 * 使用场景:
 *   - 需要同时修改多个关联文件
 *   - 重构操作
 *   - 批量替换
 *   - 需要原子性保证的场景
 *
 * 边界:
 *   1. 权限:fs.edit
 *   2. 最多 50 个编辑操作
 *   3. 原子性:任意失败则全部回滚
 *   4. 支持预览模式(dryRun)
 *   5. 使用文件锁进行并发保护
 *
 * 流程:
 *   1. 接收编辑列表
 *   2. 验证所有编辑项
 *   3. 预览模式生成 diff
 *   4. 执行编辑(获取锁、替换、释放锁)
 *   5. 失败时回滚
 *   6. 返回结果
 */
import { z } from "zod";
import { defineTool } from "@/tool/types";
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@/core/logging/logger";
import { acquireFileLock } from "@/tool/filesystem/fileLock";
import { convertLineEndings, detectLineEnding } from "@/tool/filesystem/read";
import { buildFallbackSnapshotNotice, recordFileMutation } from "@/tool/rollback";
import { backupFileBeforeMutation } from "@/tool/filesystem/utils/backup";
import { countMatches } from "@/tool/shared";

const log = createLogger("tool:multi_edit");

/** 编辑结果 */
interface EditResult {
  file: string;
  success: boolean;
  replacements: number;
  error?: string;
  diff?: string;
}

/** 原子性多文件批量编辑工具 */
export const filesystemMultiEditTool = defineTool({
  description:
    "原子性多文件编辑:在一次调用中对多个文件进行搜索替换。" +
    "所有编辑作为原子操作执行——如果任意一个编辑失败，全部回滚。" +
    "每个编辑项指定 file、oldText、newText。" +
    "适用于需要同时修改多个关联文件的重构操作。",
  execute: async ({ edits, dryRun, baseDir }, context) => {
    const cwd = baseDir ?? process.cwd();
    const isDryRun = dryRun ?? false;

    if (edits.length === 0) {
      return { error: "至少需要一个编辑操作", success: false };
    }

    log.info(`多文件编辑: ${edits.length} 个操作${isDryRun ? " (预览)" : ""}`);

    // 阶段 1:读取所有文件并验证编辑可行性
    const snapshots = new Map<string, string>();
    const results: EditResult[] = [];
    const filesToLock = [...new Set(edits.map((e) => resolvePath(e.file, cwd)))];

    // 获取文件锁
    const locks: { file: string; release: () => void }[] = [];
    try {
      for (const file of filesToLock) {
        const lockRelease = await acquireFileLock(file);
        locks.push({ file, release: lockRelease });
      }
    } catch (error) {
      // 获取锁失败，释放已获取的锁
      for (const l of locks) {
        l.release();
      }
      const msg = error instanceof Error ? error.message : String(error);
      return { error: `获取文件锁失败: ${msg}`, success: false };
    }

    try {
      // 读取所有文件
      for (const file of filesToLock) {
        try {
          snapshots.set(file, fs.readFileSync(file, "utf8"));
        } catch {
          // 释放锁
          for (const l of locks) {
            l.release();
          }
          return { error: `文件不存在或无法读取: ${file}`, success: false };
        }
      }

      // 阶段 2:执行所有编辑(在内存中)
      const modifiedFiles = new Map<string, string>();

      for (const edit of edits) {
        const filePath = resolvePath(edit.file, cwd);
        let content = modifiedFiles.get(filePath) ?? snapshots.get(filePath) ?? "";

        const { oldText, newText, replaceAll } = edit;

        if (!oldText) {
          results.push({ error: "oldText 不能为空", file: edit.file, replacements: 0, success: false });
          continue;
        }

        // 计算匹配次数
        const count = countMatches(content, oldText);

        if (count === 0) {
          results.push({ error: `未找到匹配的文本`, file: edit.file, replacements: 0, success: false });
          continue;
        }

        // 执行替换
        if (replaceAll) {
          content = content.split(oldText).join(newText);
        } else {
          const idx = content.indexOf(oldText);
          content = content.slice(0, idx) + newText + content.slice(idx + oldText.length);
        }

        modifiedFiles.set(filePath, content);

        // 生成 diff
        const original = snapshots.get(filePath) ?? "";
        const diff = generateDiffSummary(edit.file, original, content, count);

        results.push({ diff, file: edit.file, replacements: count, success: true });
      }

      // 阶段 3:检查是否有失败
      const failures = results.filter((r) => !r.success);
      if (failures.length > 0) {
        return {
          error: `${failures.length} 个编辑操作失败，已回滚全部修改`,
          results,
          rolledBack: true,
          success: false,
        };
      }

      // 阶段 4:写入(如果不是预览模式)
      const rollbackIds: string[] = [];
      let fallbackSnapshotNotice: string | undefined;
      if (!isDryRun) {
        for (const [filePath, content] of modifiedFiles) {
          const original = snapshots.get(filePath) ?? "";
          // 保持原文件行尾风格
          const lineEnding = detectLineEnding(original);
          const finalContent = lineEnding ? convertLineEndings(content, lineEnding) : content;
          backupFileBeforeMutation(filePath);
          fs.writeFileSync(filePath, finalContent, "utf8");
          const writtenContent = fs.readFileSync(filePath, "utf8");
          if (original !== writtenContent) {
            rollbackIds.push(
              recordFileMutation({
                after: writtenContent,
                before: original,
                filePath,
                projectDir: cwd,
                reason: "filesystem-multi-edit",
                sessionId: context?.sessionId,
              }).id,
            );
            fallbackSnapshotNotice ??= buildFallbackSnapshotNotice(cwd);
          }
          log.info(`已写入: ${filePath}`);
        }
      }

      const totalReplacements = results.reduce((sum, r) => sum + r.replacements, 0);

      return {
        success: true,
        totalEdits: results.length,
        totalReplacements,
        filesModified: modifiedFiles.size,
        dryRun: isDryRun,
        results,
        ...(rollbackIds.length > 0 && { rollbackIds }),
        ...(fallbackSnapshotNotice && { fallbackSnapshotNotice }),
        message: isDryRun
          ? `预览:${results.length} 个编辑，${totalReplacements} 处替换，${modifiedFiles.size} 个文件`
          : `已完成:${results.length} 个编辑，${totalReplacements} 处替换，${modifiedFiles.size} 个文件`,
      };
    } finally {
      for (const l of locks) {
        l.release();
      }
    }
  },
  name: "filesystem-multi-edit",
  parameters: z.object({
    /** 基础目录(相对路径解析基准) */
    baseDir: z.string().optional().describe("基础目录，用于解析相对路径"),
    /** 是否预览模式(不实际写入) */
    dryRun: z.boolean().optional().describe("预览模式:只显示 diff 不实际修改(默认 false)"),
    /** 编辑操作列表 */
    edits: z
      .array(
        z.object({
          /** 文件路径 */
          file: z.string().describe("要编辑的文件路径"),
          /** 替换的新文本 */
          newText: z.string().describe("替换后的新文本"),
          /** 搜索的旧文本 */
          oldText: z.string().describe("要搜索替换的原始文本"),
          /** 是否替换所有匹配 */
          replaceAll: z.boolean().optional().describe("是否替换所有匹配项(默认 false = 只替换第一处)"),
        }),
      )
      .min(1)
      .max(50)
      .describe("编辑操作列表(1-50 个)"),
  }),
  permission: "fs.edit",
  builtin: true,
});

// ── 工具函数 ──────────────────────────────────────────────────────

function resolvePath(filePath: string, baseDir: string): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.resolve(baseDir, filePath);
}

function generateDiffSummary(file: string, original: string, modified: string, replacements: number): string {
  const origLines = original.split("\n");
  const modLines = modified.split("\n");
  const additions = modLines.length > origLines.length ? modLines.length - origLines.length : 0;
  const deletions = origLines.length > modLines.length ? origLines.length - modLines.length : 0;

  return `${file}: ${replacements} 处替换 (+${additions}/-${deletions})`;
}
