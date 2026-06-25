/**
 * 剪贴板工具 — 读写系统剪贴板。
 *
 * 职责:
 *   - 在 macOS/Linux/Windows 上调用系统剪贴板命令
 *   - 提供统一的剪贴板读写接口
 *   - 处理跨平台差异
 *
 * 模块功能:
 *   - readClipboard:读取系统剪贴板内容
 *   - writeClipboard:写入内容到系统剪贴板
 *   - detectPlatform:检测当前平台
 *
 * 使用场景:
 *   - 复制代码片段到剪贴板
 *   - 从剪贴板粘贴内容
 *   - 跨平台剪贴板操作
 *
 * 边界:
 *   1. 仅负责读写剪贴板内容，不负责剪贴板监控
 *   2. Windows 平台支持有限
 *   3. Linux 依赖 xclip 工具
 *
 * 流程:
 *   1. 检测当前平台
 *   2. 根据平台调用对应命令
 *   3. 执行读写操作
 *   4. 返回结果或错误
 */
import os from "node:os";
import { createLogger } from "@/core/logging/logger";
import { inspectClipboardText } from "@/security/clipboardSanitizer";

const log = createLogger("clipboard");

/**
 * 检测当前平台。
 */
function detectPlatform(): "darwin" | "linux" | "windows" {
  if (os.platform() === "darwin") {
    return "darwin";
  }
  if (os.platform() === "linux") {
    return "linux";
  }
  return "windows";
}

/**
 * 读取系统剪贴板内容。
 * @returns 剪贴板文本，失败返回 null
 */
export async function readClipboard(): Promise<string | null> {
  try {
    const platform = detectPlatform();
    if (platform === "darwin") {
      const proc = Bun.spawn(["pbpaste"], { stderr: "pipe", stdout: "pipe" });
      return await new Response(proc.stdout).text();
    }
    if (platform === "linux") {
      const proc = Bun.spawn(["xclip", "-selection", "clipboard", "-o"], { stderr: "pipe", stdout: "pipe" });
      return await new Response(proc.stdout).text();
    }
    // Windows 暂不处理，后续通过 clip.exe 扩展
    log.debug(`剪贴板读取不支持当前平台`, { platform });
    return null;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error(`剪贴板读取失败`, { error });
    return null;
  }
}

/**
 * 写入内容到系统剪贴板。
 * @param text - 要写入的文本
 * @returns 是否成功
 */
export async function writeClipboard(text: string): Promise<boolean> {
  const platform = detectPlatform();
  const sanitized = inspectClipboardText(text);
  try {
    if (platform === "darwin") {
      const proc = Bun.spawn(["pbcopy"], { stdin: "pipe" });
      proc.stdin?.write(sanitized.text);
      proc.stdin?.end();
      await proc.exited;
      log.debug(`剪贴板写入成功`, { length: sanitized.text.length, platform, sanitized: sanitized.changed });
      return true;
    }
    if (platform === "linux") {
      const proc = Bun.spawn(["xclip", "-selection", "clipboard", "-i"], { stdin: "pipe" });
      proc.stdin?.write(sanitized.text);
      proc.stdin?.end();
      await proc.exited;
      log.debug(`剪贴板写入成功`, { length: sanitized.text.length, platform, sanitized: sanitized.changed });
      return true;
    }
    log.warn(`剪贴板写入不支持当前平台`, { platform });
    return false;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error(`剪贴板写入失败`, { error, length: sanitized.text.length, platform, sanitized: sanitized.changed });
    return false;
  }
}
