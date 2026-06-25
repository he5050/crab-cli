/**
 * 剪贴板操作模块
 *
 * 职责:
 *   - 提供跨平台剪贴板操作
 *   - 支持 OSC52 终端剪贴板序列
 *   - 提供系统命令 fallback
 *   - 复制成功/失败反馈
 *
 * 模块功能:
 *   - 复制文本到剪贴板(OSC52 优先，系统命令 fallback)
 *   - OSC52 终端剪贴板序列(支持大多数现代终端)
 *   - 系统命令复制(pbcopy / xclip / clip.exe)
 *   - 复制并显示 Toast 通知
 *
 * 使用场景:
 *   - 用户复制消息内容
 *   - 复制代码片段到剪贴板
 *   - 复制文件路径或命令
 *   - 导出内容到系统剪贴板
 *
 * 边界:
 *   1. 优先尝试 OSC52 序列，失败后使用系统命令
 *   2. macOS 使用 pbcopy，Linux 使用 xclip，Windows 使用 clip
 *   3. OSC52 支持大多数现代终端(iTerm2、Windows Terminal 等)
 *   4. 系统命令失败时静默返回 false
 *   5. 不处理剪贴板读取(仅支持写入)
 *
 * 流程:
 *   1. 调用 copyToClipboard 传入文本
 *   2. 首先尝试 OSC52 序列写入
 *   3. 如果失败，根据平台选择系统命令
 *   4. 执行系统命令将文本写入剪贴板
 *   5. 返回操作结果(成功/失败)
 *   6. copyWithToast 会额外发送 Toast 通知
 */
import { execSync } from "node:child_process";
import { globalBus, type EventBus } from "@/bus";
import { AppEvent } from "@/bus";
import { sanitizeClipboardText } from "@/security/clipboardSanitizer";

/** 使用 OSC52 序列复制到剪贴板 */
function osc52Copy(sanitizedText: string): boolean {
  try {
    const encoded = Buffer.from(sanitizedText).toString("base64");
    process.stdout.write(`\x1b]52;c;${encoded}\x07`);
    return true;
  } catch {
    return false;
  }
}

/** 使用系统命令复制 */
function systemCopy(sanitizedText: string): boolean {
  try {
    if (process.platform === "darwin") {
      execSync("pbcopy", { input: sanitizedText });
      return true;
    }
    if (process.platform === "linux") {
      execSync("xclip -selection clipboard", { input: sanitizedText });
      return true;
    }
    if (process.platform === "win32") {
      execSync("clip", { input: sanitizedText });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** 复制文本到剪贴板 */
export function copyToClipboard(text: string): boolean {
  const sanitizedText = sanitizeClipboardText(text);
  // 先尝试 OSC52，失败后 fallback 到系统命令
  return osc52Copy(sanitizedText) || systemCopy(sanitizedText);
}

/** 复制并显示 Toast */
export function copyWithToast(text: string, label?: string, eventBus: EventBus = globalBus): void {
  const ok = copyToClipboard(text);
  eventBus.publish(AppEvent.Toast, {
    message: ok ? (label ?? "已复制到剪贴板") : "复制失败",
    variant: ok ? "success" : "error",
  });
}
