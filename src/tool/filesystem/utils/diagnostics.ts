/**
 * IDE 诊断获取 — 文件编辑后轮询 IDE 获取最新诊断。
 *
 * 职责:
 *   - 轮询获取 IDE 诊断
 *   - 等待诊断稳定
 *   - VSCode 连接管理
 *   - 超时处理
 *
 * 模块功能:
 *   - getFreshDiagnostics: 获取最新诊断
 *   - 诊断指纹计算
 *   - 轮询稳定检测
 *   - 优雅降级
 *
 * 使用场景:
 *   - 文件编辑后获取诊断
 *   - 验证编辑结果
 *   - 代码质量检查
 *   - 实时错误检测
 *
 * 边界:
 *   1. 需要 VSCode 连接
 *   2. 初始延迟 300ms
 *   3. 轮询间隔 350ms
 *   4. 最大尝试 5 次
 *   5. 请求超时 3 秒
 *   6. 未连接时返回空数组
 *
 * 流程:
 *   1. 检查 VSCode 连接
 *   2. 初始延迟等待
 *   3. 轮询诊断
 *   4. 检测诊断稳定
 *   5. 返回诊断结果
 */

import type { Diagnostic } from "@/ide/types";
import { vscodeConnection } from "@/ide/client";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getDiagnosticFingerprint(diagnostics: Diagnostic[]): string {
  if (diagnostics.length === 0) {
    return "empty";
  }
  return diagnostics
    .map((d) => `${d.severity}|${d.source || ""}|${d.code || ""}|${d.line}|${d.character}|${d.message}`)
    .toSorted()
    .join("\n");
}

/**
 * 轮询 IDE 诊断直到稳定。
 * 编辑文件后，IDE 需要时间分析并返回最新诊断。
 *
 * 如果 VSCode 未连接，直接返回空数组。
 */
export async function getFreshDiagnostics(filePath: string): Promise<Diagnostic[]> {
  // VSCode 未连接时直接返回空数组
  if (!vscodeConnection.isConnected()) {
    return [];
  }

  const initialDelayMs = 300;
  const pollDelayMs = 350;
  const maxAttempts = 5;
  const requestTimeoutMs = 3000;
  let lastFingerprint: string | null = null;
  let lastDiagnostics: Diagnostic[] = [];

  await sleep(initialDelayMs);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const diagnostics = await Promise.race([
      vscodeConnection.requestDiagnostics(filePath),
      new Promise<Diagnostic[]>((resolve) => setTimeout(() => resolve([]), requestTimeoutMs)),
    ]);

    const fingerprint = getDiagnosticFingerprint(diagnostics);
    if (fingerprint === lastFingerprint) {
      return diagnostics;
    }

    lastFingerprint = fingerprint;
    lastDiagnostics = diagnostics;

    if (attempt < maxAttempts - 1) {
      await sleep(pollDelayMs);
    }
  }

  return lastDiagnostics;
}
