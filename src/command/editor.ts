/**
 * 编辑器集成 — 通过 $EDITOR / $VISUAL 编辑当前 prompt。
 *
 * 职责:
 *   - 检测 $EDITOR / $VISUAL 环境变量，回退到 vim
 *   - 将当前 prompt 写入临时文件
 *   - Bun.spawn 调用编辑器，等待退出
 *   - 读取临时文件内容回填到 prompt
 *
 * 模块功能:
 *   - detectEditor: 检测可用的编辑器命令
 *   - openEditor: 打开编辑器编辑文本，返回编辑后的内容
 *   - createEditorCommand: 创建 /editor 斜杠命令
 *
 * 使用场景:
 *   - 用户输入 /editor 命令时打开外部编辑器
 *   - 需要编辑长文本 prompt 时
 *
 * 边界:
 *   1. 编辑器以子进程方式运行，继承终端 stdio
 *   2. 临时文件在编辑器退出后自动清理
 *   3. 如果编辑器不可用，回退到 vim
 *
 * 流程:
 *   1. 检测 $EDITOR / $VISUAL 环境变量
 *   2. 将当前 prompt 写入临时文件
 *   3. Bun.spawn 调用编辑器，等待退出
 *   4. 读取临时文件内容
 *   5. 回填到 prompt 输入框
 *   6. 清理临时文件
 */
import type { Command } from "@commandPalette/types";
import type { PromptRef } from "@/ui/contexts/prompt";
import { createLogger } from "@/core/logging/logger";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const log = createLogger("command:editor");

/**
 * 检测可用的编辑器命令
 * 优先级: $EDITOR > $VISUAL > vim
 * @returns 编辑器命令字符串
 */
export function detectEditor(): string {
  return process.env.EDITOR || process.env.VISUAL || "vim";
}

/**
 * 将编辑器命令拆分为可执行文件和参数
 * 支持 "code --wait" / "vim" / "nano" 等形式
 * @param editor 编辑器命令字符串
 * @returns 拆分后的 [cmd, ...args]
 */
function parseEditorCommand(editor: string): string[] {
  const parts = editor.trim().split(/\s+/);
  return parts.length > 0 ? parts : ["vim"];
}

/**
 * 打开编辑器编辑文本
 * @param initialText 初始文本
 * @returns 编辑后的文本，如果编辑器异常则返回原始文本
 */
export async function openEditor(initialText: string): Promise<string> {
  const editor = detectEditor();
  const editorParts = parseEditorCommand(editor);
  log.info(`使用编辑器: ${editorParts.join(" ")}`);

  // 创建临时文件
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `crab-prompt-${Date.now()}.md`);
  fs.writeFileSync(tmpFile, initialText, "utf-8");

  try {
    const proc = Bun.spawn([...editorParts, tmpFile], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      log.warn(`编辑器退出码: ${exitCode}`);
    }

    const content = fs.readFileSync(tmpFile, "utf-8");
    return content;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error(`编辑器启动失败: ${errMsg}`);
    return initialText;
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // 临时文件清理失败不影响主流程
    }
  }
}

/**
 * 创建 /editor 斜杠命令
 * @param getPromptRef 获取当前 PromptRef 的函数
 * @returns Command 对象
 */
export function createEditorCommand(getPromptRef: () => PromptRef | undefined): Command {
  return {
    name: "session.editor",
    title: "编辑器编辑",
    description: "使用 $EDITOR 编辑当前 prompt 内容",
    category: "工具",
    slashName: "editor",
    slashAliases: ["ed"],
    run: async () => {
      const promptRef = getPromptRef();
      if (!promptRef) {
        log.warn("PromptRef 不可用，无法打开编辑器");
        return;
      }

      const initialText = promptRef.value;
      const editedText = await openEditor(initialText);

      // 去除尾部换行（编辑器通常会添加）
      const cleaned = editedText.replace(/\n+$/, "");
      promptRef.set(cleaned);
      promptRef.focus();
      log.info("编辑器内容已回填到 prompt");
    },
  };
}
