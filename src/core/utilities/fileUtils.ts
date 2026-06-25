/**
 * 文件工具 — Bun.file 封装。
 *
 * 职责:
 *   - 提供统一的文件读写接口
 *   - 封装 Bun.file 常用操作
 *   - 提供 JSON 文件读写支持
 *
 * 模块功能:
 *   - readTextFile:读取文件内容为文本
 *   - writeTextFile:写入文本文件
 *   - fileExists:检查文件是否存在
 *   - readJsonFile:读取 JSON 文件
 *   - writeJsonFile:写入 JSON 文件
 *
 * 使用场景:
 *   - 配置文件读写
 *   - 数据持久化
 *   - 日志文件操作
 *
 * 边界:
 *   1. 仅封装 Bun.file 常用操作，不负责文件监控
 *   2. 读取文件不存在(ENOENT)不记录 debug，这是正常情况
 *   3. 读写成功不记录 debug，避免噪音
 *   4. 解析失败、写入失败记录 error
 *
 * 流程:
 *   1. 调用对应文件操作函数
 *   2. 处理异常情况(ENOENT 等)
 *   3. 必要时记录日志
 *   4. 返回操作结果
 */
import { createLogger } from "@/core/logging/logger";
import { chmodSync } from "node:fs";

const log = createLogger("file");

/**
 * 读取文件内容为文本。
 *
 * @param path - 文件路径
 * @returns 文件内容，读取失败返回 null
 */
export async function readTextFile(path: string): Promise<string | null> {
  try {
    const file = Bun.file(path);
    const content = await file.text();
    return content;
  } catch (error) {
    // ENOENT 是正常情况(文件不存在)，不记录 debug
    if (error instanceof Error && "code" in error && error.code !== "ENOENT") {
      log.debug(`读取文件失败: ${path}`, { error: String(error) });
    }
    return null;
  }
}

/**
 * 写入文本文件。
 *
 * @param path - 文件路径
 * @param content - 文件内容
 */
export async function writeTextFile(path: string, content: string): Promise<boolean> {
  try {
    await Bun.write(path, content);
    return true;
  } catch (error) {
    log.error(`写入文件失败: ${path}`, { error: String(error) });
    return false;
  }
}

/**
 * 检查文件是否存在。
 */
export async function fileExists(path: string): Promise<boolean> {
  const file = Bun.file(path);
  return await file.exists();
}

/**
 * 读取 JSON 文件。
 * 文件不存在或解析失败均返回 null。
 */
export async function readJsonFile<T = unknown>(path: string): Promise<T | null> {
  const text = await readTextFile(path);
  if (text === null) {
    return null;
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    log.debug(
      `JSON 解析失败，尝试去除尾部逗号: ${path}, error=${error instanceof Error ? error.message : String(error)}`,
    );
    // 标准 JSON 不支持尾部逗号，尝试 strip 后重新解析
    try {
      const stripped = stripTrailingCommas(text);
      return JSON.parse(stripped) as T;
    } catch (error) {
      log.error(`JSON 解析失败: ${path}`, { error: String(error) });
      return null;
    }
  }
}

/**
 * 移除 JSON 文本中的尾部逗号(JSONC 宽容模式)。
 * 处理 ,} 和 ,] 两种情况，同时跳过字符串内容。
 */
function stripTrailingCommas(text: string): string {
  let result = "";
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (escape) {
      result += ch;
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      result += ch;
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }
    if (inString) {
      result += ch;
      continue;
    }
    // 不在字符串内:检查 ,} 或 ,] 模式
    if (ch === ",") {
      // 向后找第一个非空白字符
      let j = i + 1;
      while (j < text.length && (text[j] === " " || text[j] === "\t" || text[j] === "\n" || text[j] === "\r")) {
        j++;
      }
      if (j < text.length && (text[j] === "}" || text[j] === "]")) {
        // 跳过这个逗号(不输出)
        continue;
      }
    }
    result += ch;
  }
  return result;
}

/**
 * 写入 JSON 文件。
 */
export async function writeJsonFile(path: string, data: unknown, pretty = true): Promise<boolean> {
  try {
    const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
    const ok = await writeTextFile(path, content);
    if (ok) {
      // 将文件权限限制为仅属主可读写(0600)，避免敏感数据(API key、token 等)
      // 被同机其他用户读取。chmod 失败不视为致命错误。
      try {
        chmodSync(path, 0o600);
      } catch {
        /* Chmod 失败不影响主流程 */
      }
    }
    return ok;
  } catch (error) {
    log.error(`写入 JSON 文件异常: ${path}`, { error: String(error) });
    return false;
  }
}
