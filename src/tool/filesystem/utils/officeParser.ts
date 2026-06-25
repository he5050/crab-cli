/**
 * Office 文件解析 — 提取 PDF/Word/Excel/PowerPoint 文件文本内容。
 *
 * 职责:
 *   - 解析 Office 文档内容
 *   - 支持 PDF/Word/Excel/PowerPoint
 *   - 提取文本和元数据
 *   - 可选依赖管理
 *
 * 模块功能:
 *   - parseWordDocument: 解析 Word 文档
 *   - parseExcelDocument: 解析 Excel 文档
 *   - parsePowerPointDocument: 解析 PPT 文档
 *   - parsePdfDocument: 解析 PDF 文档
 *   - getOfficeFileType: 获取文件类型
 *
 * 使用场景:
 *   - 读取 Office 文档内容
 *   - 文档内容提取
 *   - 文档搜索索引
 *
 * 边界:
 *   1. 支持 .pdf/.docx/.doc/.xlsx/.xls/.pptx/.ppt
 *   2. mammoth/xlsx/pdf-parse 为可选依赖
 *   3. 缺失依赖时返回 null
 *   4. 提取原始文本内容
 *   5. 保留文件元数据
 *
 * 流程:
 *   1. 检测文件类型
 *   2. 加载对应解析器
 *   3. 解析文档内容
 *   4. 提取文本和元数据
 *   5. 返回解析结果
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("tool:filesystem:office-parser");

/** Office 文件类型映射 */
const OFFICE_FILE_TYPES: Record<string, "pdf" | "word" | "excel" | "powerpoint"> = {
  ".doc": "word",
  ".docx": "word",
  ".pdf": "pdf",
  ".ppt": "powerpoint",
  ".pptx": "powerpoint",
  ".xls": "excel",
  ".xlsx": "excel",
};

/** Office 文档解析后的内容，包含文本和文件类型 */
export interface DocumentContent {
  type: "document";
  text: string;
  fileType: "pdf" | "word" | "excel" | "powerpoint";
  metadata?: Record<string, unknown>;
}

/**
 * 根据扩展名获取 Office 文件类型。
 */
/** getOfficeFileType 的实现 */
export function getOfficeFileType(filePath: string): "pdf" | "word" | "excel" | "powerpoint" | undefined {
  const ext = path.extname(filePath).toLowerCase();
  return OFFICE_FILE_TYPES[ext];
}

/**
 * 解析 Word 文档 (.docx)。
 * 使用 mammoth 提取原始文本(可选依赖)。
 */
export async function parseWordDocument(fullPath: string): Promise<DocumentContent | null> {
  try {
    const buffer = await fs.readFile(fullPath);

    // 尝试使用 mammoth
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      return {
        fileType: "word",
        metadata: {
          messages: result.messages.length > 0 ? result.messages : undefined,
        },
        text: result.value,
        type: "document",
      };
    } catch {
      // Mammoth 不可用，回退到 XML 提取
      const text = buffer.toString("utf8");
      const textParts: string[] = [];
      const wordRegex = /<w:t[^>]*>([^<]+)<\/w:t>/g;
      let match;
      while ((match = wordRegex.exec(text)) !== null) {
        const t = match[1]!.trim();
        if (t) {
          textParts.push(t);
        }
      }
      if (textParts.length > 0) {
        return {
          fileType: "word",
          text: textParts.join("\n"),
          type: "document",
        };
      }
    }

    return null;
  } catch (error) {
    log.debug(`Word 解析失败: ${fullPath}`, { error: String(error) });
    return null;
  }
}

/**
 * 解析 PDF 文档。
 * 优先使用 pdf-parse(可选依赖)，回退到简易文本提取。
 */
export async function parsePDFDocument(fullPath: string): Promise<DocumentContent | null> {
  try {
    const buffer = await fs.readFile(fullPath);

    // 尝试 pdf-parse
    try {
      // @ts-expect-error — pdf-parse 是可选依赖
      const pdfParse = (await import("pdf-parse")).default;
      const data = await pdfParse(buffer);
      return {
        fileType: "pdf",
        metadata: {
          pages: data.numpages,
        },
        text: data.text,
        type: "document",
      };
    } catch {
      // Pdf-parse 不可用，回退到简易提取
    }

    // 简易 PDF 文本提取(BT...ET 块中的 Tj/TJ 操作)
    const text = buffer.toString("latin1");
    const textParts: string[] = [];
    const btEtRegex = /BT\s*([\s\S]*?)\s*ET/g;
    let blockMatch;
    while ((blockMatch = btEtRegex.exec(text)) !== null) {
      const block = blockMatch[1]!;
      const tjRegex = /\(([^)]*)\)\s*Tj/g;
      let tjMatch;
      while ((tjMatch = tjRegex.exec(block)) !== null) {
        const t = tjMatch[1]!.trim();
        if (t) {
          textParts.push(t);
        }
      }
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
      return {
        fileType: "pdf",
        text: textParts.join("\n"),
        type: "document",
      };
    }

    return null;
  } catch (error) {
    log.debug(`PDF 解析失败: ${fullPath}`, { error: String(error) });
    return null;
  }
}

/**
 * 解析 Excel 表格 (.xlsx)。
 * 使用 xlsx 库提取所有工作表内容(可选依赖)。
 */
export async function parseExcelDocument(fullPath: string): Promise<DocumentContent | null> {
  try {
    const buffer = await fs.readFile(fullPath);

    try {
      // @ts-expect-error — xlsx 是可选依赖
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(buffer, { type: "buffer" });

      const sheets: string[] = [];
      let allText = "";

      workbook.SheetNames.forEach((sheetName: string) => {
        sheets.push(sheetName);
        const worksheet = workbook.Sheets[sheetName];
        if (worksheet) {
          const sheetText = XLSX.utils.sheet_to_txt(worksheet);
          allText += `\n\n=== Sheet: ${sheetName} ===\n${sheetText}`;
        }
      });

      return {
        fileType: "excel",
        metadata: { sheetCount: sheets.length, sheets },
        text: allText.trim(),
        type: "document",
      };
    } catch {
      // Xlsx 不可用，回退到 XML 提取
      const text = buffer.toString("utf8");
      const textParts: string[] = [];
      const excelRegex = /<t[^>]*>([^<]+)<\/t>/g;
      let match;
      while ((match = excelRegex.exec(text)) !== null) {
        const t = match[1]!.trim();
        if (t && !textParts.includes(t)) {
          textParts.push(t);
        }
      }

      if (textParts.length > 0) {
        return {
          fileType: "excel",
          text: textParts.join("\n"),
          type: "document",
        };
      }
    }

    return null;
  } catch (error) {
    log.debug(`Excel 解析失败: ${fullPath}`, { error: String(error) });
    return null;
  }
}

/**
 * 解析 PowerPoint 演示文稿 (.pptx)。
 * 从 ZIP 中的 XML 提取文本。
 */
export async function parsePowerPointDocument(fullPath: string): Promise<DocumentContent | null> {
  try {
    const buffer = await fs.readFile(fullPath);
    const text = buffer.toString("utf8");
    const textParts: string[] = [];

    // PPT: <a:t>text</a:t>
    const pptRegex = /<a:t>([^<]+)<\/a:t>/g;
    let match;
    while ((match = pptRegex.exec(text)) !== null) {
      const t = match[1]!.trim();
      if (t && !textParts.includes(t)) {
        textParts.push(t);
      }
    }

    if (textParts.length > 0) {
      return {
        fileType: "powerpoint",
        text: textParts.join("\n"),
        type: "document",
      };
    }

    return {
      fileType: "powerpoint",
      metadata: {
        note: "For full PowerPoint text extraction, consider additional tools",
      },
      text: "[PowerPoint parsing - basic text extraction only]",
      type: "document",
    };
  } catch (error) {
    log.debug(`PowerPoint 解析失败: ${fullPath}`, { error: String(error) });
    return null;
  }
}

/**
 * 主入口:读取并解析 Office 文档。
 */
export async function readOfficeDocument(fullPath: string): Promise<DocumentContent | null> {
  const fileType = getOfficeFileType(fullPath);
  if (!fileType) {
    return null;
  }

  switch (fileType) {
    case "word": {
      return parseWordDocument(fullPath);
    }
    case "pdf": {
      return parsePDFDocument(fullPath);
    }
    case "excel": {
      return parseExcelDocument(fullPath);
    }
    case "powerpoint": {
      return parsePowerPointDocument(fullPath);
    }
    default: {
      return null;
    }
  }
}
