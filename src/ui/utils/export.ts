/**
 * 对话导出模块
 *
 * 职责:
 *   - 将当前对话导出为 Markdown 文件
 *   - 遍历消息列表，生成 Markdown 格式
 *   - 处理 user/assistant/system/tool 消息
 *   - 写入文件并提供 Toast 反馈
 *
 * 模块功能:
 *   - 将消息列表导出为 Markdown 字符串
 *   - 处理用户消息、助手消息、系统消息
 *   - 支持多部分消息(text/thinking/tool)
 *   - 智能截断长内容(工具参数/输出)
 *   - 导出对话到文件(自动选择保存位置)
 *
 * 使用场景:
 *   - 用户导出当前对话记录
 *   - 保存重要对话内容到本地
 *   - 分享对话内容
 *   - 备份对话历史
 *
 * 边界:
 *   1. 仅支持导出为 Markdown 格式
 *   2. 工具参数超过 1000 字符会被截断
 *   3. 工具输出超过 3000 字符会被截断
 *   4. 优先保存到桌面，其次下载目录，最后当前目录
 *   5. 系统消息中的任务进度标识会被过滤
 *
 * 流程:
 *   1. 接收消息列表和会话 ID
 *   2. 生成 Markdown 格式的标题和时间戳
 *   3. 遍历消息，根据角色和类型格式化内容
 *   4. 尝试写入到可用目录(Desktop/Downloads/cwd)
 *   5. 发送 Toast 通知导出结果
 */
import type { ChatMessage } from "@/ui/contexts/chat";
import { globalBus, type EventBus } from "@/bus";
import { AppEvent } from "@/bus";
import { inlineSuccessIcon } from "@/core/icons/iconDerived";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/** 将消息列表导出为 Markdown 字符串 */
export function exportToMarkdown(messages: ChatMessage[], sessionId?: string): string {
  const lines: string[] = [];

  // 标题
  const title = sessionId ? `Crab CLI 对话导出 (${sessionId.slice(0, 12)})` : "Crab CLI 对话导出";
  lines.push(`# ${title}`);
  lines.push(``);
  lines.push(`> 导出时间: ${new Date().toLocaleString()}`);
  lines.push(``);

  for (const msg of messages) {
    if (msg.role === "user") {
      lines.push(`## 用户`);
      lines.push(``);
      lines.push(msg.content);
      lines.push(``);
    } else if (msg.role === "assistant") {
      lines.push(`## 助手`);
      lines.push(``);

      // 优先使用 parts
      if (msg.parts && msg.parts.length > 0) {
        for (const part of msg.parts) {
          if (part.type === "text") {
            lines.push(part.text);
            lines.push(``);
          } else if (part.type === "thinking") {
            lines.push(`<details>`);
            lines.push(`<summary>思考过程 (${part.text.length} 字符)</summary>`);
            lines.push(``);
            lines.push(part.text);
            lines.push(``);
            lines.push(`</details>`);
            lines.push(``);
          } else if (part.type === "tool") {
            const icon = inlineSuccessIcon(part.success);
            lines.push(`### ${icon} 工具: ${part.tool}`);
            lines.push(``);
            if (part.args) {
              lines.push(`**参数:**`);
              lines.push(``);
              lines.push("```");
              lines.push(part.args.slice(0, 1000));
              lines.push("```");
              lines.push(``);
            }
            if (part.output) {
              lines.push(`**输出:**`);
              lines.push(``);
              lines.push("```");
              lines.push(part.output.slice(0, 3000));
              lines.push("```");
              lines.push(``);
            }
          }
        }
      } else {
        lines.push(msg.content);
        lines.push(``);
      }
    } else if (msg.role === "system" && msg.content) {
      // 跳过系统消息中的任务进度标识
      if (/^[⟳✓✗]/.test(msg.content)) {
        continue;
      }
      lines.push(`## 系统`);
      lines.push(``);
      lines.push(msg.content);
      lines.push(``);
    }
  }

  return lines.join("\n");
}

/** 导出对话到文件 */
export function exportConversation(
  messages: ChatMessage[],
  sessionId?: string,
  eventBus: EventBus = globalBus,
): string | undefined {
  const markdown = exportToMarkdown(messages, sessionId);

  // 写入 ~/Desktop/ 或 ~/Downloads/ 或当前目录
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  const filename = `crab-export-${timestamp}.md`;

  // 尝试多个位置
  const candidates = [path.join(os.homedir(), "Desktop"), path.join(os.homedir(), "Downloads"), process.cwd()];

  for (const dir of candidates) {
    try {
      if (!fs.existsSync(dir)) {
        continue;
      }
      const filePath = path.join(dir, filename);
      fs.writeFileSync(filePath, markdown, "utf8");

      eventBus.publish(AppEvent.Toast, {
        message: `已导出到 ${filePath}`,
        variant: "success",
      });
      return filePath;
    } catch {
      continue;
    }
  }

  eventBus.publish(AppEvent.Toast, {
    message: "导出失败:无法写入文件",
    variant: "error",
  });
  return undefined;
}
