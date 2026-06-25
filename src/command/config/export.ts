/**
 * Crab config export 命令 — 导出配置为 JSON。
 *
 * 职责:
 *   - 导出当前配置为 JSON 格式
 *   - 可选脱敏处理（移除 API Key）
 *   - 支持输出到文件或 stdout
 *
 * 使用场景:
 *   - 备份配置
 *   - 迁移配置到其他机器
 *   - 分享配置模板（脱敏后）
 */
import type { ExportOptions } from "../type";
import { loadConfig } from "@/config";
import { writeCliError, createCliError } from "@/cli";
import fs from "node:fs";
import path from "node:path";

function sanitizeConfig(config: Record<string, unknown>): Record<string, unknown> {
  const sanitized = structuredClone(config);

  // 递归移除敏感字段
  function removeSensitive(obj: unknown): void {
    if (obj === null || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      obj.forEach(removeSensitive);
      return;
    }
    const record = obj as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (
        key.toLowerCase().includes("key") ||
        key.toLowerCase().includes("secret") ||
        key.toLowerCase().includes("token") ||
        key.toLowerCase().includes("password")
      ) {
        record[key] = "***REDACTED***";
      } else {
        removeSensitive(record[key]);
      }
    }
  }

  removeSensitive(sanitized);
  return sanitized;
}

export async function configExportCommand(options: ExportOptions = {}): Promise<void> {
  const { output, sanitize = false, format = "pretty" } = options;

  const config = await loadConfig();
  const configObj = config as unknown as Record<string, unknown>;

  const exportData = sanitize ? sanitizeConfig(configObj) : configObj;

  const jsonStr = format === "pretty" ? JSON.stringify(exportData, null, 2) : JSON.stringify(exportData);

  if (output) {
    const outputPath = path.resolve(output);
    const dir = path.dirname(outputPath);
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(outputPath, jsonStr, "utf-8");
      console.log(`配置已导出到: ${outputPath}`);
      if (sanitize) {
        console.log("（已脱敏处理）");
      }
    } catch (error) {
      writeCliError(
        createCliError({
          cause: error,
          context: { outputPath },
          kind: "write-failed",
          message: `无法写入文件: ${outputPath}`,
        }),
        { includeCause: true },
      );
      process.exit(1);
    }
  } else {
    console.log(jsonStr);
  }
}
