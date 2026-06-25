/**
 * 文档内容解析器 — PDF 和 Office Open XML 的文本提取。
 */
import { createLogger } from "@/core/logging/logger";
import fs from "node:fs";

const log = createLogger("tool:fs_read");

/**
 * 解析文档文件内容。
 *
 * 策略:
 *   - .pdf: 尝试提取文本内容(简单解析，非 OCR)
 *   - .docx/.xlsx/.pptx: 这些是 ZIP 格式，尝试提取 XML 中的文本节点
 *   - .doc/.xls/.ppt: 旧版二进制格式，返回元数据
 */
/** parseDocumentContent 的实现 */
export function parseDocumentContent(filePath: string, ext: string): string | null {
  switch (ext) {
    case ".pdf": {
      return parsePdfContent(filePath);
    }
    case ".docx":
    case ".xlsx":
    case ".pptx": {
      return parseOfficeXmlContent(filePath);
    }
    default: {
      return null;
    }
  }
}

/**
 * 简易 PDF 文本提取。
 *
 * PDF 内部结构复杂，这里使用一个轻量策略:
 * 提取 stream 中的文本对象(BT...ET 块中的 Tj/TJ 操作)。
 * 不覆盖所有 PDF 规范，但能处理大部分文本型 PDF。
 */
function parsePdfContent(filePath: string): string | null {
  try {
    const buf = fs.readFileSync(filePath);
    const text = buf.toString("latin1"); // PDF 内部编码

    const textParts: string[] = [];

    // 提取 BT...ET 块中的文本
    const btEtRegex = /BT\s*([\s\S]*?)\s*ET/g;
    let blockMatch;
    while ((blockMatch = btEtRegex.exec(text)) !== null) {
      const block = blockMatch[1]!;

      // 提取 Tj 操作: (text) Tj
      const tjRegex = /\(([^)]*)\)\s*Tj/g;
      let tjMatch;
      while ((tjMatch = tjRegex.exec(block)) !== null) {
        const t = tjMatch[1]!.trim();
        if (t) {
          textParts.push(t);
        }
      }

      // 提取 TJ 操作: [(text) num] TJ
      const tjArrayRegex = /\[(.*?)\]\s*TJ/g;
      let arrMatch;
      while ((arrMatch = tjArrayRegex.exec(block)) !== null) {
        const inner = arrMatch[1]!;
        const strRegex = /\(([^)]*)\)/g;
        let strMatch;
        while ((strMatch = strRegex.exec(inner)) !== null) {
          const t = strMatch[1]!.trim();
          if (t) {
            textParts.push(t);
          }
        }
      }
    }

    if (textParts.length > 0) {
      return textParts.join("\n");
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Office Open XML 文本提取(.docx/.xlsx/.pptx)。
 *
 * 这些文件本质是 ZIP 压缩包，内部包含 XML 文件。
 * 提取主要 XML 中的文本节点内容。
 */
function parseOfficeXmlContent(filePath: string): string | null {
  try {
    // 使用 Bun 内置的 ZIP 支持(如果可用)，否则回退
    // 这里使用简单方法:直接在二进制数据中搜索 XML 文本标签
    const buf = fs.readFileSync(filePath);
    const text = buf.toString("utf8");

    // 在 ZIP 中查找 <w:t> (Word), <v> (Excel shared strings), <a:t> (PPT) 标签
    const textParts: string[] = [];

    // Word: <w:t>text</w:t> 或 <w:t xml:space="preserve">text</w:t>
    const wordRegex = /<w:t[^>]*>([^<]+)<\/w:t>/g;
    let match;
    while ((match = wordRegex.exec(text)) !== null) {
      const t = match[1]!.trim();
      if (t) {
        textParts.push(t);
      }
    }

    // Excel: <t>text</t> (shared strings)
    const excelRegex = /<t[^>]*>([^<]+)<\/t>/g;
    while ((match = excelRegex.exec(text)) !== null) {
      const t = match[1]!.trim();
      if (t && !textParts.includes(t)) {
        textParts.push(t);
      }
    }

    // PPT: <a:t>text</a:t>
    const pptRegex = /<a:t>([^<]+)<\/a:t>/g;
    while ((match = pptRegex.exec(text)) !== null) {
      const t = match[1]!.trim();
      if (t && !textParts.includes(t)) {
        textParts.push(t);
      }
    }

    if (textParts.length > 0) {
      return textParts.join("\n");
    }

    return null;
  } catch {
    return null;
  }
}
