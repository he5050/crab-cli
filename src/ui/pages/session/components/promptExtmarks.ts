/**
 * Prompt Extmarks 虚拟文本系统 — @文件引用、#Agent/Skill 引用、多行粘贴折叠。
 *
 * 职责:
 *   - 定义 Extmark 数据结构
 *   - 创建各类 extmark(文件/Agent/Skill/粘贴/URL)
 *   - 展开所有 extmarks 为完整提交文本
 *   - 在文本中插入/移除 extmark
 *
 * 模块功能:
 *   - Extmark: 虚拟文本标记数据结构
 *   - createFileExtmark: 创建文件引用 extmark
 *   - createAgentExtmark: 创建 Agent 引用 extmark
 *   - createSkillExtmark: 创建 Skill 引用 extmark
 *   - createPasteExtmark: 创建粘贴 extmark
 *   - createUrlExtmark: 创建 URL extmark
 *   - expandExtmarks: 展开所有 extmarks 为完整文本
 *   - insertExtmark: 在文本中插入 extmark
 *   - removeExtmark: 移除 extmark
 *   - classifyPastedText: 分类粘贴文本
 *
 * 使用场景:
 *   - prompt 输入框的 @文件引用
 *   - prompt 输入框的 #Agent/Skill 引用
 *   - 多行粘贴内容折叠显示
 *   - 提交时展开虚拟文本
 *
 * 边界:
 *   1. 纯函数工具，不涉及 UI 渲染
 *   2. extmark 的 start/end 基于提交文本中的占位符位置
 *   3. expandTo 为提交时替换占位符的实际内容
 *
 * 流程:
 *   1. 用户通过 @ 或 # 触发引用 → 创建 extmark
 *   2. 用户粘贴多行文本 → 创建 paste extmark
 *   3. 输入框上方显示 extmark 标签列表
 *   4. 提交时调用 expandExtmarks 展开虚拟文本
 */

/** Extmark 样式类型 */
export type ExtmarkStyle = "file" | "agent" | "skill" | "paste" | "url";

/** Extmark 数据结构 */
export interface Extmark {
  /** 唯一标识 */
  id: string;
  /** 文本起始位置(占位符在文本中的起始偏移) */
  start: number;
  /** 文本结束位置(占位符在文本中的结束偏移) */
  end: number;
  /** 显示的虚拟文本(标签上展示的简短文本) */
  virtualText: string;
  /** 样式类型 */
  style: ExtmarkStyle;
  /** 提交时展开为的实际内容(若不提供则使用 virtualText) */
  expandTo?: string;
}

/** 唯一 ID 生成器 */
let extmarkIdCounter = 0;

function generateExtmarkId(): string {
  extmarkIdCounter += 1;
  return `extmark-${Date.now().toString(36)}-${extmarkIdCounter.toString(36)}`;
}

/** 多行粘贴阈值:超过此行数则折叠为 extmark */
export const PASTE_FOLD_LINE_THRESHOLD = 3;

/** URL 正则 */
const URL_PATTERN = /^https?:\/\/[^\s]+$/;

/** 文件路径正则(相对路径或绝对路径) */
const FILE_PATH_PATTERN = /^(?:\.\/|\/|~\/)?[A-Za-z0-9_./-]+$/;

/**
 * 创建文件引用 extmark
 * @param filePath 文件路径
 * @param position 插入位置(默认 0)
 */
export function createFileExtmark(filePath: string, position: number = 0): Extmark {
  const display = filePath.startsWith("@") ? filePath : `@${filePath}`;
  return {
    expandTo: display,
    id: generateExtmarkId(),
    start: position,
    end: position + display.length,
    style: "file",
    virtualText: display,
  };
}

/**
 * 创建 Agent 引用 extmark
 * @param agentName Agent 名称
 * @param position 插入位置(默认 0)
 */
export function createAgentExtmark(agentName: string, position: number = 0): Extmark {
  const display = `@agent:${agentName}`;
  return {
    expandTo: display,
    id: generateExtmarkId(),
    start: position,
    end: position + display.length,
    style: "agent",
    virtualText: display,
  };
}

/**
 * 创建 Skill 引用 extmark
 * @param skillName Skill 名称
 * @param position 插入位置(默认 0)
 */
export function createSkillExtmark(skillName: string, position: number = 0): Extmark {
  const display = `@skill:${skillName}`;
  return {
    expandTo: display,
    id: generateExtmarkId(),
    start: position,
    end: position + display.length,
    style: "skill",
    virtualText: display,
  };
}

/**
 * 创建粘贴 extmark
 * @param text 粘贴的文本
 * @param position 插入位置(默认 0)
 */
export function createPasteExtmark(text: string, position: number = 0): Extmark {
  const lineCount = text.split("\n").length;
  const charCount = text.length;
  const firstLine = text.split("\n")[0] ?? "";
  const preview = firstLine.slice(0, 40);
  const virtualText =
    lineCount > 1
      ? `[粘贴: ${lineCount} 行 · ${charCount} 字符] ${preview}${preview.length < firstLine.length ? "…" : ""}`
      : `[粘贴: ${charCount} 字符] ${preview}${charCount > 40 ? "…" : ""}`;

  return {
    expandTo: text,
    id: generateExtmarkId(),
    start: position,
    end: position + virtualText.length,
    style: "paste",
    virtualText,
  };
}

/**
 * 创建 URL extmark
 * @param url URL 字符串
 * @param position 插入位置(默认 0)
 */
export function createUrlExtmark(url: string, position: number = 0): Extmark {
  const virtualText = url.length > 60 ? `${url.slice(0, 57)}…` : url;
  return {
    expandTo: url,
    id: generateExtmarkId(),
    start: position,
    end: position + virtualText.length,
    style: "url",
    virtualText,
  };
}

/**
 * 展开所有 extmarks 为完整文本
 * 将文本中的 extmark 占位符替换为 expandTo 内容
 * @param text 原始文本(含占位符)
 * @param extmarks extmark 列表
 * @returns 展开后的完整文本
 */
export function expandExtmarks(text: string, extmarks: Extmark[]): string {
  if (extmarks.length === 0) {
    return text;
  }

  // 按 start 降序排列，从后往前替换避免偏移变化
  const sorted = [...extmarks].sort((a, b) => b.start - a.start);

  let result = text;
  for (const extmark of sorted) {
    const replacement = extmark.expandTo ?? extmark.virtualText;
    result = result.slice(0, extmark.start) + replacement + result.slice(extmark.end);
  }

  return result;
}

/**
 * 在文本中插入 extmark
 * 将 extmark 的虚拟文本插入到文本的指定位置，并返回更新后的文本和 extmark 列表
 * @param text 原始文本
 * @param extmark 要插入的 extmark
 * @param existingExtmarks 现有 extmark 列表
 * @returns 更新后的文本和 extmark 列表
 */
export function insertExtmark(
  text: string,
  extmark: Extmark,
  existingExtmarks: Extmark[] = [],
): { text: string; extmarks: Extmark[] } {
  const insertPos = Math.max(0, Math.min(extmark.start, text.length));
  const virtualText = extmark.virtualText;

  // 调整新 extmark 的位置范围
  const newExtmark: Extmark = {
    ...extmark,
    end: insertPos + virtualText.length,
    start: insertPos,
  };

  // 插入文本
  const newText = text.slice(0, insertPos) + virtualText + text.slice(insertPos);

  // 调整现有 extmarks 的位置(在插入点之后的 extmark 需要偏移)
  const offset = virtualText.length;
  const adjustedExtmarks = existingExtmarks.map((em) => {
    if (em.start >= insertPos) {
      return { ...em, start: em.start + offset, end: em.end + offset };
    }
    if (em.end > insertPos) {
      return { ...em, end: em.end + offset };
    }
    return em;
  });

  return {
    extmarks: [...adjustedExtmarks, newExtmark],
    text: newText,
  };
}

/**
 * 移除 extmark
 * 从 extmark 列表中移除指定 ID 的 extmark
 * @param extmarks extmark 列表
 * @param id 要移除的 extmark ID
 * @returns 更新后的 extmark 列表
 */
export function removeExtmark(extmarks: Extmark[], id: string): Extmark[] {
  return extmarks.filter((em) => em.id !== id);
}

/**
 * 分类粘贴文本，决定创建哪种类型的 extmark
 * @param text 粘贴的文本
 * @returns 分类结果: "url" | "file" | "paste"
 */
export function classifyPastedText(text: string): "url" | "file" | "paste" {
  const trimmed = text.trim();

  // URL 检测
  if (URL_PATTERN.test(trimmed)) {
    return "url";
  }

  // 文件路径检测(单行且匹配路径模式)
  const lineCount = trimmed.split("\n").length;
  if (lineCount === 1 && FILE_PATH_PATTERN.test(trimmed) && trimmed.includes("/")) {
    return "file";
  }

  return "paste";
}

/**
 * 根据粘贴文本创建合适的 extmark
 * @param text 粘贴的文本
 * @param position 插入位置
 * @returns 创建的 extmark
 */
export function createExtmarkFromPaste(text: string, position: number = 0): Extmark {
  const kind = classifyPastedText(text);
  const trimmed = text.trim();

  switch (kind) {
    case "url":
      return createUrlExtmark(trimmed, position);
    case "file":
      return createFileExtmark(trimmed, position);
    case "paste":
    default:
      return createPasteExtmark(text, position);
  }
}

/**
 * 判断粘贴文本是否应该折叠为 extmark
 * 多行(>PASTE_FOLD_LINE_THRESHOLD 行)或长文本(>200 字符)或 URL 或文件路径应折叠
 * @param text 粘贴的文本
 * @returns 是否应该折叠
 */
export function shouldFoldPastedText(text: string): boolean {
  const trimmed = text.trim();
  const lineCount = text.split("\n").length;

  // URL 始终折叠为 extmark
  if (URL_PATTERN.test(trimmed)) {
    return true;
  }

  // 文件路径(以 / 或 ~/ 开头)始终折叠为 extmark
  if (lineCount === 1 && (trimmed.startsWith("/") || trimmed.startsWith("~/")) && FILE_PATH_PATTERN.test(trimmed)) {
    return true;
  }

  // 多行文本或长文本折叠
  return lineCount > PASTE_FOLD_LINE_THRESHOLD || text.length > 200;
}
