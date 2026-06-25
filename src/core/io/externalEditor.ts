/**
 * 外部编辑器支持 — 使用 $EDITOR/$VISUAL 打开临时文件编辑
 *
 *
 * 流程:
 *   1. 检测 $EDITOR 或 $VISUAL 环境变量
 *   2. 创建临时文件，写入初始文本
 *   3. spawn 编辑器进程（继承 stdio）
 *   4. 读取编辑后的内容返回
 *   5. 清理临时文件
 */

import { spawn } from "node:child_process";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ─── 类型 ──────────────────────────────────────────────────

type StdinLike = NodeJS.ReadStream & {
  isRaw?: boolean;
  setRawMode?: (mode: boolean) => void;
};

// ─── 内部函数 ──────────────────────────────────────────────

/** 暂停 stdin 防止编辑器运行时键盘事件泄漏到 CLI */
function pauseStdin(): () => void {
  if (!process.stdin.isTTY) return () => {};

  const stdin = process.stdin as StdinLike;
  const wasRaw = typeof stdin.isRaw === "boolean" ? stdin.isRaw : undefined;
  stdin.pause();

  return () => {
    stdin.resume();
    if (typeof stdin.setRawMode === "function") {
      try {
        stdin.setRawMode(wasRaw ?? true);
      } catch {
        // 恢复失败不影响主流程
      }
    }
  };
}

/** 检测编辑器命令 */
function resolveEditor(): string | null {
  return process.env.VISUAL || process.env.EDITOR || null;
}

/** 解析编辑器命令（支持 "code --wait" 等带参数的情况） */
function parseEditorCommand(editor: string): { cmd: string; args: string[] } {
  const parts = editor.split(/\s+/);
  return { cmd: parts[0] ?? editor, args: parts.slice(1) };
}

// ─── 公开 API ──────────────────────────────────────────────

/**
 * 使用外部编辑器编辑文本。
 *
 * @param initialText - 初始文本（写入临时文件）
 * @returns 编辑后的文本；如果编辑器不可用则返回原始文本
 */
export async function editTextWithEditor(initialText: string): Promise<string> {
  const editor = resolveEditor();
  if (!editor) {
    return initialText;
  }

  const tempFile = join(tmpdir(), `crab-prompt-${Date.now()}-${Math.random().toString(16).slice(2)}.md`);

  await writeFile(tempFile, initialText, "utf-8");
  const restoreStdin = pauseStdin();

  try {
    const { cmd, args } = parseEditorCommand(editor);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(cmd, [...args, tempFile], {
        stdio: "inherit",
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`编辑器退出码: ${code}`));
      });
    });

    const edited = await readFile(tempFile, "utf-8");
    return edited;
  } catch {
    return initialText;
  } finally {
    restoreStdin();
    try {
      await unlink(tempFile);
    } catch {
      // 临时文件清理失败不影响主流程
    }
  }
}

/** 检测是否有可用的外部编辑器 */
export function hasExternalEditor(): boolean {
  return Boolean(resolveEditor());
}

/** 获取当前编辑器名称 */
export function getEditorName(): string | null {
  return resolveEditor();
}
