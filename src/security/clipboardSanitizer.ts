/**
 * 剪贴板文本消毒器 — 写入系统剪贴板前移除不安全控制字符。
 *
 * 职责:
 *   - 在文本写入系统/终端剪贴板前去除不安全控制字符
 *   - 保留 tab/换行/回车以保证多行片段可读
 *   - 输出检测结果(是否变更、被移除字符数)
 *
 * 模块功能:
 *   - sanitizeClipboardText: 一键消毒(只返回消毒后文本)
 *   - inspectClipboardText: 完整诊断(包含 removedCount / changed)
 *   - ClipboardSanitizeResult: 消毒结果接口
 *
 * 使用场景:
 *   - IDE 扩展复制诊断、错误信息、长文本到剪贴板前
 *   - 终端命令/日志片段复制时过滤 ANSI 与控制字符
 *
 * 边界:
 *   1. 仅处理 ASCII 范围内的控制字符(U+0000-U+001F、U+007F-U+009F，排除 tab/LF/CR)
 *   2. 不影响 Unicode 高级字符(CJK 等保持原样)
 *   3. 不做编码转换(UTF-8/GBK 等)
 *
 * 流程:
 *   1. 调用 inspectClipboardText
 *   2. 用 UNSAFE_CONTROL_CHARS 正则替换控制字符，统计 removedCount
 *   3. 构造 ClipboardSanitizeResult 返回
 */
/** ANSI CSI 转义序列（如颜色、光标移动） */
const ANSI_CSI = /\x1b\[[0-9;]*[A-Za-z]/g;
/** ANSI OSC 转义序列（如窗口标题） */
const ANSI_OSC = /\x1b\][^\x07]*\x07/g;
const UNSAFE_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

export interface ClipboardSanitizeResult {
  text: string;
  removedCount: number;
  changed: boolean;
}

export function sanitizeClipboardText(text: string): string {
  return inspectClipboardText(text).text;
}

export function inspectClipboardText(text: string): ClipboardSanitizeResult {
  const csiMatches = [...text.matchAll(ANSI_CSI)];
  const oscMatches = [...text.matchAll(ANSI_OSC)];
  const ctrlMatches = [...text.matchAll(UNSAFE_CONTROL_CHARS)];
  const removedCount = csiMatches.length + oscMatches.length + ctrlMatches.length;
  const sanitized = text.replace(ANSI_CSI, "").replace(ANSI_OSC, "").replace(UNSAFE_CONTROL_CHARS, "");
  return {
    changed: removedCount > 0,
    removedCount,
    text: sanitized,
  };
}
