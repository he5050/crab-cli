/**
 * 外部编辑器模块
 *
 * 职责:
 *   - 使用系统编辑器编辑临时文件并返回结果
 *   - 提供跨平台编辑器调用支持
 *   - 管理 TUI 与外部编辑器的 stdin 冲突
 *
 * 模块功能:
 *   - 使用系统默认编辑器编辑文本
 *   - 跨平台支持(macOS/Linux/Windows)
 *   - 自动暂停/恢复 stdin 避免 TUI 冲突
 *   - UTF-8 BOM 处理
 *   - 临时文件自动清理
 *
 * 使用场景:
 *   - 用户需要编辑长文本消息
 *   - 多行输入需要复杂编辑
 *   - 需要语法高亮的代码编辑
 *   - 临时修改配置或脚本
 *
 * 边界:
 *   1. macOS 使用 open -t，Linux 使用 xdg-open，Windows 使用 notepad
 *   2. Linux 回退顺序:xdg-open → nano → vi
 *   3. 自动添加 UTF-8 BOM 以支持中文
 *   4. 临时文件在编辑完成后自动删除
 *   5. 编辑期间暂停 stdin 以避免 TUI 键盘事件冲突
 *
 * 流程:
 *   1. 创建临时文件并写入初始内容(带 BOM)
 *   2. 暂停 stdin 的 raw mode
 *   3. 根据平台调用对应的外部编辑器
 *   4. 等待编辑器关闭
 *   5. 读取编辑后的内容(去除 BOM)
 *   6. 恢复 stdin 状态
 *   7. 删除临时文件
 *   8. 返回编辑后的文本
 */

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compactId } from "@/core/id";

type StdinLike = NodeJS.ReadStream & {
  isRaw?: boolean;
  setRawMode?: (mode: boolean) => void;
};

function pauseStdinForExternalEditor(): () => void {
  if (!process.stdin.isTTY) {
    return () => {};
  }

  const stdin = process.stdin as StdinLike;
  const wasRaw = typeof stdin.isRaw === "boolean" ? stdin.isRaw : undefined;
  stdin.pause();

  return () => {
    stdin.resume();
    if (typeof stdin.setRawMode === "function") {
      try {
        stdin.setRawMode(wasRaw ?? true);
      } catch {
        // 恢复 raw mode 失败不影响主流程
      }
    }
  };
}

function addUtf8Bom(text: string): string {
  return text.startsWith("﻿") ? text : `﻿${text}`;
}

async function spawnEditor(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", () => resolve());
  });
}

/**
 * 使用系统默认文本编辑器编辑内容，返回编辑后的文本。
 *
 * @param initialText - 初始文本内容
 * @returns 编辑后的文本内容
 */
export async function editTextWithExternalEditor(initialText: string): Promise<string> {
  const tempFile = join(tmpdir(), `crab-chat-${compactId("-", 8)}.txt`);

  await fs.writeFile(tempFile, addUtf8Bom(initialText), "utf8");

  const restoreStdin = pauseStdinForExternalEditor();

  try {
    const { platform } = process;

    if (platform === "darwin") {
      await spawnEditor("open", ["-t", "-W", tempFile]);
    } else if (platform === "win32") {
      await spawnEditor("notepad.exe", [tempFile]);
    } else {
      // Linux — 优先 xdg-open, 回退 nano/vi
      try {
        await spawnEditor("xdg-open", ["--wait", tempFile]);
      } catch {
        try {
          await spawnEditor("nano", [tempFile]);
        } catch {
          await spawnEditor("vi", [tempFile]);
        }
      }
    }

    const edited = await fs.readFile(tempFile, "utf8");
    return edited.replace(/^﻿/, "");
  } finally {
    restoreStdin();
    try {
      await fs.unlink(tempFile);
    } catch {
      // 临时文件清理失败不影响主流程
    }
  }
}
