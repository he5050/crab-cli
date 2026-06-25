/**
 * IDE 检测器 — 检测 VSCode 环境
 *
 * 职责:
 *   - 通过环境变量检测当前是否运行在 VSCode 集成终端中
 *   - 扫描可用 IDE 端口文件(crab-ide-ports.json)
 *   - 判断 VSCode 扩展是否已安装
 *
 * 模块功能:
 *   - detectIDE: 检测当前终端所属的 IDE
 *   - isExtensionInstalled: 判断 VSCode 扩展是否已安装
 *   - getAvailableIDEs: 获取所有可用的 VSCode 实例
 *   - hasMatchingIDE: 检查当前工作目录是否有匹配的 IDE 实例
 *
 * 使用场景:
 *   - 检测 crab-cli 是否在 VSCode 集成终端中运行
 *   - 获取 IDE 连接端口信息
 *   - 判断是否可以使用 IDE 扩展功能
 *
 * 边界:
 * 1. 支持 VSCode、VSCode Insiders 和 Cursor
 * 2. 端口信息文件路径固定为 ~/.crab/tmp/ide/crab-ide-ports.json
 * 3. JetBrains 通过 jetbrains.ts 单独处理
 *
 * 流程:
 * 1. 暂无(这是工具函数库，无特定执行流程)
 */

import fs from "node:fs";
import { createLogger } from "@/core/logging/logger";
import type { IDEInfo, IDEName } from "@/ide/types";
import { createIdeError, toIdeLogPayload } from "@/ide/errors";
import { IDE_PORTS_FILE, normalizePath } from "@/ide/shared/pathUtils";

const log = createLogger("ide:detector");

/** GIT_ASKPASS 关键词 → IDE 名称映射 */
const GIT_ASKPASS_IDE_MAP: Record<string, IDEName> = {
  "Visual Studio Code": "VSCode",
  "Visual Studio Code - Insiders": "VSCode Insiders",
};

/** TERM_PROGRAM → IDE 映射(仅无歧义的值) */
const TERM_PROGRAM_MAP: Record<string, IDEName> = {
  cursor: "Cursor",
};

/** 端口文件条目结构（JSON v2 格式） */
interface PortFileEntry {
  port: number;
  ide?: string;
  token?: string;
}

function isSupportedIDEName(value: string): value is Exclude<IDEName, "unknown"> {
  return value === "VSCode" || value === "VSCode Insiders" || value === "Cursor";
}

/**
 * 检测当前终端所属的 IDE。
 * 通过 TERM_PROGRAM 和 GIT_ASKPASS 环境变量检测。
 */
export function detectIDE(): IDEName {
  const termProgram = process.env.TERM_PROGRAM;
  if (termProgram && TERM_PROGRAM_MAP[termProgram]) {
    return TERM_PROGRAM_MAP[termProgram];
  }
  // VSCode 集成终端:通过 GIT_ASKPASS 区分 VSCode / VSCode Insiders
  if (termProgram === "vscode") {
    const askpass = process.env.GIT_ASKPASS ?? "";
    for (const [keyword, name] of Object.entries(GIT_ASKPASS_IDE_MAP)) {
      if (askpass.includes(keyword)) {
        return name;
      }
    }
    return "VSCode";
  }
  return "unknown";
}

/**
 * 判断 VSCode 扩展是否已安装(通过环境变量检测)。
 */
export function isExtensionInstalled(): boolean {
  const caller = process.env.CRAB_CALLER;
  return caller === "vscode" || caller === "vscode-insiders" || caller === "cursor";
}

/**
 * 获取所有可用的 VSCode 实例。
 * 扫描 crab-ide-ports.json 文件，按工作区匹配分类。
 */
export function getAvailableIDEs(): { matched: IDEInfo[]; unmatched: IDEInfo[] } {
  const matched: IDEInfo[] = [];
  const unmatched: IDEInfo[] = [];
  try {
    if (!fs.existsSync(IDE_PORTS_FILE)) {
      return { matched, unmatched };
    }

    const content = fs.readFileSync(IDE_PORTS_FILE, "utf8");
    const portInfo = JSON.parse(content) as Record<string, unknown>;
    const cwd = normalizePath(process.cwd());

    for (const [workspace, value] of Object.entries(portInfo)) {
      let port: number;
      let ideName: string;

      if (typeof value === "number") {
        port = value;
        ideName = "VSCode";
      } else if (typeof value === "object" && value !== null && typeof (value as PortFileEntry).port === "number") {
        const entry = value as PortFileEntry;
        port = entry.port;
        ideName = entry.ide || "VSCode";
        // Normalize "cursor" ideName from port info
        if (ideName === "cursor") {
          ideName = "Cursor";
        }
      } else {
        continue;
      }
      if (!isSupportedIDEName(ideName)) {
        continue;
      }

      const token = typeof value === "object" && value !== null ? (value as PortFileEntry).token : undefined;
      const normalizedWorkspace = normalizePath(workspace);
      const isMatch =
        normalizedWorkspace.length > 1 && (cwd === normalizedWorkspace || cwd.startsWith(`${normalizedWorkspace}/`));

      const info: IDEInfo = { matched: isMatch, name: ideName as IDEName, port, token, workspace };

      if (isMatch) {
        matched.push(info);
      } else {
        unmatched.push(info);
      }
    }
  } catch (error) {
    const ideError = createIdeError(
      error,
      {
        filePath: IDE_PORTS_FILE,
        operation: "getAvailableIDEs",
      },
      "handler",
    );
    log.debug("读取或解析 IDE 端口文件失败", toIdeLogPayload(ideError));
  }

  return { matched, unmatched };
}

/**
 * 检查当前工作目录是否有匹配的 IDE 实例。
 */
export function hasMatchingIDE(): boolean {
  return getAvailableIDEs().matched.length > 0;
}
