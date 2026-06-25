/**
 * Skill 遮罩模块
 *
 * 职责:
 *   - 隐藏注入的 Skill 块同时保留原始文本
 *   - 将 Skill 块折叠为单行标记
 *   - 收集所有 Skill ID
 *
 * 模块功能:
 *   - 解析 Skill 块头部("# Skill: <id>")
 *   - 识别 Skill 块结束标记("# Skill End")
 *   - 将 Skill 块内容替换为 "[Skill:id]" 标记
 *   - 保留 Skill 块后的剩余文本
 *
 * 使用场景:
 *   - SkillsPicker 注入内容显示处理
 *   - 聊天界面中折叠 Skill 调用详情
 *   - 提取 Skill 调用记录用于后续处理
 *
 * 边界:
 *   1. Skill 块格式必须严格遵循 "# Skill: <id>" ... "# Skill End"
 *   2. 不验证 Skill ID 的有效性
 *   3. 嵌套 Skill 块按顺序处理，不保留层级关系
 *   4. 不支持 Skill 块内的富文本格式
 *
 * 流程:
 *   1. 按行扫描输入文本
 *   2. 检测到 Skill 头部时，提取 Skill ID
 *   3. 继续扫描直到找到结束标记
 *   4. 用 "[Skill:id]" 替换整个 Skill 块
 *   5. 返回处理后的显示文本和 Skill ID 列表
 */

export interface SkillMaskResult {
  displayText: string;
  skillIds: string[];
}

function isSkillHeaderLine(line: string): boolean {
  return line.startsWith("# Skill:");
}

function isSkillEndLine(line: string): boolean {
  return line.trim() === "# Skill End";
}

function splitSkillEndRemainder(line: string): string | null {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith("# Skill End")) {
    return null;
  }
  return trimmed.slice("# Skill End".length);
}

function parseSkillIdFromHeader(line: string): string {
  return line.replace(/^# Skill:\s*/i, "").trim() || "unknown";
}

/**
 * 将 Skill 注入文本遮罩为显示文本。
 * 保留用户文本，将 Skill 块折叠为 "[Skill:id]" 标记。
 */
export function maskSkillInjectedText(text: string): SkillMaskResult {
  if (!text) {
    return { displayText: text, skillIds: [] };
  }

  const lines = text.split("\n");
  const out: string[] = [];
  const skillIds: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (!isSkillHeaderLine(line)) {
      out.push(line);
      i++;
      continue;
    }

    // 折叠整个 Skill 块为一行标记
    const skillId = parseSkillIdFromHeader(line);
    skillIds.push(skillId);
    out.push(`[Skill:${skillId}]`);

    i++;
    while (i < lines.length) {
      const next = lines[i] ?? "";
      if (isSkillHeaderLine(next)) {
        break;
      }

      const remainder = splitSkillEndRemainder(next);
      if (remainder !== null) {
        i++;
        if (remainder.length > 0) {
          out.push(remainder.replace(/^\s+/, ""));
        }
        break;
      }

      if (isSkillEndLine(next)) {
        i++;
        break;
      }
      i++;
    }
  }

  return { displayText: out.join("\n"), skillIds };
}
