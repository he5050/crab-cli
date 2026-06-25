/**
 * Crab config import 命令 — 从 JSON 文件导入配置。
 *
 * 职责:
 *   - 从 JSON 文件读取配置
 *   - 验证配置格式
 *   - 合并或覆盖现有配置
 *   - 持久化到配置文件
 *
 * 使用场景:
 *   - 从备份恢复配置
 *   - 从其他机器迁移配置
 *   - 批量部署配置模板
 */
import type { ImportOptions } from "../type";
import { loadConfig, saveConfig, deepMerge } from "@/config";
import { AppConfigSchema } from "@/schema/config";
import { writeCliError, createCliError } from "@/cli";
import { createInterface } from "node:readline/promises";
import fs from "node:fs";
import path from "node:path";

export async function configImportCommand(inputPath: string, options: ImportOptions = {}): Promise<void> {
  const { force = false, merge = true } = options;

  const resolvedPath = path.resolve(inputPath);
  if (!fs.existsSync(resolvedPath)) {
    writeCliError(
      createCliError({
        context: { inputPath: resolvedPath },
        kind: "resource-not-found",
        message: `配置文件不存在: ${resolvedPath}`,
      }),
    );
    process.exit(1);
  }

  let importedData: unknown;
  try {
    const raw = fs.readFileSync(resolvedPath, "utf-8");
    importedData = JSON.parse(raw);
  } catch (error) {
    writeCliError(
      createCliError({
        cause: error,
        context: { inputPath: resolvedPath },
        kind: "invalid-parameter",
        message: `无法解析配置文件: ${resolvedPath}`,
      }),
      { includeCause: true },
    );
    process.exit(1);
  }

  // 验证配置
  let validatedConfig;
  try {
    validatedConfig = AppConfigSchema.parse(importedData);
  } catch (error) {
    writeCliError(
      createCliError({
        cause: error,
        context: { inputPath: resolvedPath },
        kind: "invalid-parameter",
        message: `配置格式验证失败: ${error instanceof Error ? error.message : String(error)}`,
      }),
      { includeCause: true },
    );
    process.exit(1);
  }

  // 合并或覆盖
  if (merge) {
    const existingConfig = await loadConfig();
    const merged = deepMerge(
      existingConfig as unknown as Record<string, unknown>,
      validatedConfig as unknown as Record<string, unknown>,
    );
    const finalConfig = AppConfigSchema.parse(merged);
    const success = await saveConfig(finalConfig);
    if (success) {
      console.log("配置已导入并合并。");
    } else {
      writeCliError(
        createCliError({
          context: { operation: "config.import.save" },
          kind: "write-failed",
          message: "配置保存失败",
        }),
      );
      process.exit(1);
    }
  } else {
    // 覆盖模式需要确认
    let rl: ReturnType<typeof createInterface> | undefined;
    try {
      if (!force) {
        rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await rl.question("此操作将覆盖现有配置，是否继续？(y/N): ");
        if (answer.toLowerCase() !== "y") {
          console.log("导入已取消。");
          process.exit(0);
        }
      }
      const success = await saveConfig(validatedConfig);
      if (success) {
        console.log("配置已导入（覆盖模式）。");
      } else {
        writeCliError(
          createCliError({
            context: { operation: "config.import.save" },
            kind: "write-failed",
            message: "配置保存失败",
          }),
        );
        process.exit(1);
      }
    } finally {
      if (rl) {
        rl.close();
      }
    }
  }
}
