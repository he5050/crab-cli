/**
 * Prompt 部分处理工具 — 触发器检测、引用提取和元信息构建。
 *
 * 职责:
 *   - 检测 prompt 触发器(/ 命令、@ 引用)
 *   - 提取 prompt 中的引用(文件、Agent、Skill、Symbol)
 *   - 构建 prompt 元信息字符串
 *   - 处理引用插入逻辑
 *
 * 模块功能:
 *   - PromptTrigger: 触发器类型
 *   - PromptReference: 引用数据结构
 *   - PromptMetaInput: 元信息输入
 *   - detectPromptTrigger: 检测触发器
 *   - extractPromptReferences: 提取引用列表
 *   - buildPromptMeta: 构建元信息字符串
 *   - insertPromptReference: 插入引用到 prompt
 *
 * 使用场景:
 *   - prompt 输入框的智能提示
 *   - 引用解析和展示
 *   - 自动完成功能支持
 *
 * 边界:
 *   1. 纯函数工具，不涉及 UI
 *   2. 引用格式:@file、@agent:name、@skill:name、@file#symbol
 *   3. 自动推断引用类型
 *
 * 流程:
 *   1. 用户输入包含触发器
 *   2. detectPromptTrigger 识别类型
 *   3. extractPromptReferences 提取所有引用
 *   4. 自动完成时 insertPromptReference 插入新引用
 */
export type PromptTrigger = "/" | "@";

export interface PromptReference {
  kind: "file" | "agent" | "skill" | "symbol";
  value: string;
  raw: string;
}

export interface PromptMetaInput {
  agent?: string;
  mode?: string;
  provider?: string;
  model?: string;
}

export function detectPromptTrigger(value: string): PromptTrigger | undefined {
  const trimmedStart = value.trimStart();
  if (trimmedStart === "/" || /^\/[^\s]*$/.test(trimmedStart)) {
    return "/";
  }
  if (trimmedStart === "@" || /^@[^\s]*$/.test(trimmedStart)) {
    return "@";
  }
  return undefined;
}

export function extractPromptReferences(value: string): PromptReference[] {
  const refs: PromptReference[] = [];
  const matches = value.matchAll(/(^|\s)@([A-Za-z0-9_./:-]+)/g);

  for (const match of matches) {
    const raw = `@${match[2]}`;
    const target = match[2] ?? "";
    if (!target) {
      continue;
    }

    refs.push({
      kind: inferReferenceKind(target),
      raw,
      value: target,
    });
  }

  return refs;
}

export function buildPromptMeta(input: PromptMetaInput): string {
  const agent = input.agent?.trim() || "Agent";
  const mode = input.mode?.trim() || "chat";
  const model = input.model?.trim() || input.provider?.trim() || "model";
  return `${agent} · ${mode} · ${model}`;
}

export function insertPromptReference(value: string, reference: PromptReference): string {
  const activeTrigger = detectPromptTrigger(value);
  if (activeTrigger !== "@") {
    return appendWithSpace(value, reference.raw);
  }

  return `${value.replace(/@\S*$/, reference.raw).trimEnd()} `;
}

function inferReferenceKind(target: string): PromptReference["kind"] {
  if (target.startsWith("agent:")) {
    return "agent";
  }
  if (target.startsWith("skill:")) {
    return "skill";
  }
  if (target.includes("#")) {
    return "symbol";
  }
  return "file";
}

function appendWithSpace(value: string, suffix: string): string {
  const trimmed = value.trimEnd();
  return `${trimmed}${trimmed ? " " : ""}${suffix} `;
}
