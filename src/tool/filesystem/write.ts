/**
 * 文件写入工具 — 创建/覆盖文件、创建目录。
 *
 * 职责:
 *   - 创建新文件或覆盖现有文件
 *   - 自动创建父目录
 *   - 支持追加模式
 *   - 覆盖前自动备份
 *   - 可选 prettier 格式化
 *
 * 模块功能:
 *   - fsWriteTool: 文件写入工具定义
 *   - backupFileBeforeMutation: 统一备份(来自 utils/backup)
 *
 * 使用场景:
 *   - AI 需要创建新文件
 *   - 完全替换文件内容
 *   - 追加内容到文件
 *   - 需要格式化输出的场景
 *
 * 边界:
 *   1. 权限:fs.write
 *   2. 覆盖前自动备份原文件
 *   3. 使用文件锁进行并发保护
 *   4. 保持原文件的行尾风格
 *   5. 可选 prettier 格式化
 *   6. 备份文件保留 7 天
 *
 * 流程:
 *   1. 接收文件路径和内容
 *   2. 获取文件锁
 *   3. 如文件存在则备份
 *   4. 创建父目录
 *   5. 写入内容
 *   6. 可选格式化
 *   7. 释放文件锁
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
import { validatePathWithinCwd } from "@/tool/filesystem/utils";
import { createInternalError } from "@/core/errors/appError";

/**
 * 解析路径的真实位置，处理符号链接绕过(CWE-22)。
 * 如果文件不存在，解析父目录的 realpath 再拼接文件名。
 */
/**
 * 解析路径的真实位置，处理符号链接和不存在路径(CWE-22)。
 * @param filePath 待解析的文件路径
 * @returns 解析后的真实绝对路径
 */
/** resolveRealPath 的实现 */
export function resolveRealPath(filePath: string): string {
  try {
    return fs.realpathSync(filePath);
  } catch {
    let existingAncestor = path.dirname(filePath);
    const missingSegments = [path.basename(filePath)];

    while (!fs.existsSync(existingAncestor)) {
      const parent = path.dirname(existingAncestor);
      if (parent === existingAncestor) {
        throw createInternalError("INTERNAL_ERROR", `无法解析路径: ${filePath}`);
      }
      missingSegments.unshift(path.basename(existingAncestor));
      existingAncestor = parent;
    }

    const realAncestor = fs.realpathSync(existingAncestor);
    return path.join(realAncestor, ...missingSegments);
  }
}

const log = createLogger("tool:fs_write");

/** 文件写入工具，支持创建/覆盖/追加文件，自动创建父目录，覆盖前备份 */
export const fsWriteTool = defineTool({
  description:
    "写入文件内容。自动创建父目录。如果文件已存在则覆盖。" +
    "用于创建新文件或完全替换文件内容。如果需要编辑文件的部分内容，请使用 filesystem-edit。",
  execute: async ({ path: filePath, content, append, format }, context) => {
    try {
      const fullPath = path.resolve(filePath);
      const cwd = process.cwd();

      // 路径遍历防护(CWE-22) — 统一使用 validatePathWithinCwd
      const pathError = validatePathWithinCwd(fullPath);
      if (pathError) {
        return { error: pathError, path: filePath };
      }

      // G10: 获取文件锁
      const release = await acquireFileLock(fullPath);

      try {
        // 自动创建父目录
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
          log.debug(`创建目录: ${dir}`);
        }

        const existed = fs.existsSync(fullPath);
        let backupPath: string | undefined;
        let originalContent: string | undefined;

        // G15: 行尾保持 — 检测原文件行尾风格，应用到新内容
        let outputContent = content;
        let formatted = false;
        if (existed) {
          const original = fs.readFileSync(fullPath, "utf8");
          originalContent = original;
          const lineEnding = detectLineEnding(original);
          if (lineEnding !== "\n") {
            outputContent = convertLineEndings(content, lineEnding);
            log.debug(`行尾保持: ${lineEnding === "\r\n" ? "CRLF" : "CR"}`);
          }

          // G4: 覆盖前备份
          if (!append) {
            backupPath = backupFileBeforeMutation(fullPath) ?? undefined;
          }
        }

        try {
          if (append) {
            fs.appendFileSync(fullPath, outputContent, "utf8");
          } else {
            fs.writeFileSync(fullPath, outputContent, "utf8");
          }

          // G16: 格式化 — 写入后尝试 prettier
          if (format && !append) {
            const fmtResult = await tryFormat(fullPath, outputContent);
            if (fmtResult !== outputContent) {
              outputContent = fmtResult;
              formatted = true;
            }
          }
        } catch (writeError) {
          // 写入失败时尝试从备份回滚
          if (backupPath && fs.existsSync(backupPath)) {
            try {
              fs.copyFileSync(backupPath, fullPath);
              log.info(`写入失败，已从备份回滚: ${fullPath}`);
            } catch {
              log.error(`写入失败且回滚失败: ${fullPath}, 备份位于: ${backupPath}`);
            }
          }
          throw writeError;
        }

        const action = append ? "追加" : existed ? "覆盖" : "创建";
        const lineCount = outputContent.split("\n").length;
        const byteSize = Buffer.byteLength(outputContent, "utf8");
        let rollbackId: string | undefined;
        let fallbackSnapshotNotice: string | undefined;

        const finalContent = fs.readFileSync(fullPath, "utf8");
        if (originalContent !== finalContent) {
          rollbackId = recordFileMutation({
            after: finalContent,
            afterExists: true,
            before: originalContent ?? "",
            beforeExists: existed,
            filePath: fullPath,
            projectDir: cwd,
            reason: `filesystem-write:${append ? "append" : existed ? "overwrite" : "create"}`,
            sessionId: context?.sessionId,
          }).id;
          fallbackSnapshotNotice = buildFallbackSnapshotNotice(cwd);
        }

        log.info(
          `文件${action}: ${fullPath} (${lineCount} 行, ${byteSize} 字节${backupPath ? `, 备份: ${backupPath}` : ""})`,
        );

        return {
          action,
          lineCount,
          path: fullPath,
          sizeBytes: byteSize,
          success: true,
          ...(rollbackId && { rollbackId }),
          ...(fallbackSnapshotNotice && { fallbackSnapshotNotice }),
          ...(backupPath && { backupPath }),
          ...(formatted && { formatted: true }),
        };
      } finally {
        release();
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error(`写入失败: ${filePath}`, { error: msg });
      return { error: msg, path: filePath, success: false };
    }
  },
  name: "filesystem-write",
  parameters: z.object({
    /** 是否追加模式(默认 false = 覆盖) */
    append: z.boolean().optional().describe("是否追加到文件末尾(默认 false = 覆盖写入)"),
    /** 文件内容 */
    content: z.string().describe("要写入的文件内容"),
    /** G16: 是否格式化(尝试用 prettier 格式化) */
    format: z.boolean().optional().describe("写入后是否尝试用 prettier 格式化(默认 false)"),
    /** 文件路径 */
    path: z.string().describe("要写入的文件路径(绝对或相对)"),
  }),
  permission: "fs.write",
  builtin: true,
});

/**
 * 清理过期的文件写入备份(超过 maxAgeMs 的备份文件)。
 * 默认保留 7 天。兼容旧清理入口，当前备份目录由 utils/backup 管理。
 */
/**
 * 清理过期的文件写入备份。
 * @param maxAgeMs 备份文件最大保留时长(毫秒)，默认 7 天
 */
/** cleanupWriteBackups 的实现 */
export function cleanupWriteBackups(maxAgeMs = 7 * 24 * 60 * 60 * 1000): void {
  try {
    const backupDir = path.join(process.cwd(), ".crab", "backups");
    if (!fs.existsSync(backupDir)) {
      return;
    }

    const cutoff = Date.now() - maxAgeMs;
    for (const entry of fs.readdirSync(backupDir)) {
      const filePath = path.join(backupDir, entry);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile() && stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // 跳过无法处理的备份文件。
      }
    }
  } catch {
    // 清理失败不影响主流程。
  }
}

/**
 * G16: 尝试格式化文件内容。
 *
 * 使用策略:
 * 1. 尝试动态 import prettier(项目可能安装了)
 * 2. 如果 prettier 不可用，做简单的缩进规范化
 * 3. 格式化失败不阻塞写入流程
 */
async function tryFormat(filePath: string, content: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();

  // 只对代码文件尝试格式化
  const formattableExts = new Set([
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".mjs",
    ".cjs",
    ".json",
    ".css",
    ".scss",
    ".less",
    ".html",
    ".vue",
    ".svelte",
    ".md",
    ".yml",
    ".yaml",
  ]);

  if (!formattableExts.has(ext)) {
    log.debug(`跳过格式化(不支持的扩展名): ${ext}`);
    return content;
  }

  try {
    // 尝试动态加载 prettier
    // @ts-expect-error — prettier 是可选依赖
    const prettier = await import("prettier");

    const config = await prettier.resolveConfig(filePath);
    const options = {
      ...config,
      filepath: filePath,
    };

    const formatted = await prettier.format(content, options);
    log.info(`prettier 格式化成功: ${filePath}`);
    return formatted;
  } catch {
    // Prettier 不可用或格式化失败 — 不影响写入
    log.debug(`prettier 格式化跳过: ${filePath}(未安装或格式化失败)`);
    return content;
  }
}
