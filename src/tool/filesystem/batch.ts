/**
 * 批量文件操作工具 — 一次操作多个文件。
 *
 * 职责:
 *   - 批量读取多个文件
 *   - 批量写入多个文件
 *   - 批量删除文件
 *   - 批量创建目录
 *
 * 模块功能:
 *   - fsBatchTool: 批量文件操作工具定义
 *   - read: 批量读取
 *   - write: 批量写入
 *   - delete: 批量删除
 *   - mkdir: 批量创建目录
 *
 * 使用场景:
 *   - 需要同时操作多个文件
 *   - 批量文件迁移
 *   - 批量文件创建
 *
 * 边界:
 *   1. 权限:fs.write(批量写)/ fs.read(批量读)
 *   2. 一次请求可操作多个文件
 *   3. 每个操作独立执行
 *   4. 返回每个操作的结果
 *   5. 部分失败不影响其他操作
 *
 * 流程:
 *   1. 接收操作列表
 *   2. 遍历执行每个操作
 *   3. 收集操作结果
 *   4. 返回批量操作结果
 */
import { z } from "zod";
import { defineTool } from "@/tool/types";
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@/core/logging/logger";
import { validatePathWithinCwd } from "@/tool/filesystem/utils";

const log = createLogger("tool:fs_batch");

const FileOperation = z.union([
  z.object({
    path: z.string(),
    type: z.literal("read"),
  }),
  z.object({
    content: z.string(),
    path: z.string(),
    type: z.literal("write"),
  }),
  z.object({
    path: z.string(),
    type: z.literal("delete"),
  }),
  z.object({
    path: z.string(),
    type: z.literal("mkdir"),
  }),
]);

/** 批量文件操作工具，一次请求可执行读/写/删除/创建目录等多个操作 */
export const fsBatchTool = defineTool({
  description:
    "批量执行文件操作(读/写/删除/创建目录)。一次请求可以操作多个文件。" +
    "适用于需要同时创建多个文件或读取多个文件的场景。",
  execute: async ({ operations }) => {
    const results: Record<string, unknown>[] = [];

    for (const op of operations) {
      try {
        switch (op.type) {
          case "read": {
            const fullPath = path.resolve(op.path);
            const pathErr = validatePathWithinCwd(fullPath);
            if (pathErr) {
              results.push({ error: pathErr, path: fullPath, success: false, type: "read" });
              continue;
            }
            if (!fs.existsSync(fullPath)) {
              results.push({ error: "文件不存在", path: fullPath, success: false, type: "read" });
              continue;
            }
            const content = fs.readFileSync(fullPath, "utf8");
            const lineCount = content.split("\n").length;
            results.push({ content, lineCount, path: fullPath, success: true, type: "read" });
            break;
          }
          case "write": {
            const fullPath = path.resolve(op.path);
            const pathErr = validatePathWithinCwd(fullPath);
            if (pathErr) {
              results.push({ error: pathErr, path: fullPath, success: false, type: "write" });
              continue;
            }
            const dir = path.dirname(fullPath);
            if (!fs.existsSync(dir)) {
              fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(fullPath, op.content, "utf8");
            const lineCount = op.content.split("\n").length;
            results.push({ lineCount, path: fullPath, success: true, type: "write" });
            break;
          }
          case "delete": {
            const fullPath = path.resolve(op.path);
            const pathErr = validatePathWithinCwd(fullPath);
            if (pathErr) {
              results.push({ error: pathErr, path: fullPath, success: false, type: "delete" });
              continue;
            }
            if (!fs.existsSync(fullPath)) {
              results.push({ error: "文件不存在", path: fullPath, success: false, type: "delete" });
              continue;
            }
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
              fs.rmSync(fullPath, { recursive: true });
            } else {
              fs.unlinkSync(fullPath);
            }
            results.push({ path: fullPath, success: true, type: "delete" });
            break;
          }
          case "mkdir": {
            const fullPath = path.resolve(op.path);
            const pathErr = validatePathWithinCwd(fullPath);
            if (pathErr) {
              results.push({ error: pathErr, path: fullPath, success: false, type: "mkdir" });
              continue;
            }
            fs.mkdirSync(fullPath, { recursive: true });
            results.push({ path: fullPath, success: true, type: "mkdir" });
            break;
          }
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        results.push({ error: msg, path: op.path, success: false, type: op.type });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    log.info(`批量操作完成: ${successCount} 成功, ${failCount} 失败`);

    return {
      failCount,
      results,
      success: failCount === 0,
      successCount,
      totalOperations: operations.length,
    };
  },
  name: "filesystem-batch",
  parameters: z.object({
    /** 操作列表 */
    operations: z.array(FileOperation).describe("要执行的文件操作列表"),
  }),
  permission: "fs.write",
  builtin: true,
});
