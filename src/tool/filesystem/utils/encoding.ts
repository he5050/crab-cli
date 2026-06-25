/**
 * 编码检测与转换 — 自动检测文件编码并正确读取。
 *
 * 职责:
 *   - 自动检测文件编码
 *   - 按正确编码读取文件
 *   - 支持多种编码格式
 *   - 大文件保护
 *
 * 模块功能:
 *   - readFileWithEncoding: 按编码读取文件
 *   - readFileLinesStreaming: 流式读取文件行
 *   - writeFileWithEncoding: 按编码写入文件
 *   - 编码自动检测
 *
 * 使用场景:
 *   - 读取未知编码的文件
 *   - 处理非 UTF-8 文件
 *   - 大文件流式读取
 *   - 编码转换
 *
 * 边界:
 *   1. 支持 UTF-8/UTF-8-BOM/GBK/GB2312/GB18030/Shift-JIS/Latin-1 等
 *   2. 最大可读文件 256MB
 *   3. 依赖 chardet 和 iconv-lite(可选)
 *   4. 缺失依赖时回退 UTF-8
 *   5. 编码检测采样 64KB
 *
 * 流程:
 *   1. 读取文件 Buffer
 *   2. 检测是否为 UTF-8
 *   3. 使用 chardet 检测编码
 *   4. 按检测到的编码转换
 *   5. 返回文本内容
 */

import { createReadStream, promises as fs } from "node:fs";
import { createInterface } from "node:readline";
import { createInternalError } from "@/core/errors/appError";

/** 检测是否为 Node.js 系统错误（含 code 属性） */
function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

/** Node.js 最大字符串长度约 512MB，安全限制 256MB */
const MAX_READABLE_FILE_BYTES = 256 * 1024 * 1024;

/** 检测 Buffer 是否为有效 UTF-8 */
function isUtf8Buffer(buffer: Buffer): boolean {
  // UTF-8 BOM
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return true;
  }

  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    decoder.decode(buffer);
    return true;
  } catch {
    return false;
  }
}

/**
 * 检测文件编码并按正确编码读取内容。
 * 超过 ~256MB 的文件会被拒绝，避免 Node.js 字符串长度溢出。
 */
export async function readFileWithEncoding(filePath: string): Promise<string> {
  const stats = await fs.stat(filePath);
  if (stats.size > MAX_READABLE_FILE_BYTES) {
    throw createInternalError(
      "INTERNAL_ERROR",
      `文件过大无法作为文本读取 (${Math.round(stats.size / 1024 / 1024)}MB, 限制 ${Math.round(MAX_READABLE_FILE_BYTES / 1024 / 1024)}MB): ${filePath}`,
    );
  }

  try {
    const buffer = await fs.readFile(filePath);

    // 优先使用有效 UTF-8
    if (isUtf8Buffer(buffer)) {
      return buffer.toString("utf8");
    }

    // 使用 chardet 检测编码
    let encoding: string | null = null;
    try {
      // @ts-ignore — chardet 是可选依赖，类型可能存在也可能不存在
      const chardet = await import("chardet");
      encoding = chardet.detect(buffer);
    } catch {
      /* Chardet 不可用 */
    }

    if (!encoding || encoding === "utf8" || encoding === "ascii") {
      return buffer.toString("utf8");
    }

    // 转换检测到的编码为 UTF-8
    let targetEncoding = encoding;
    if (targetEncoding === "GB2312" || targetEncoding === "GBK" || targetEncoding === "GB18030") {
      targetEncoding = "GB18030";
    }

    try {
      // @ts-ignore — iconv-lite 是可选依赖，类型可能存在也可能不存在
      const iconv = await import("iconv-lite");
      if (iconv.encodingExists(targetEncoding)) {
        return iconv.decode(buffer, targetEncoding);
      }
    } catch {
      /* Iconv-lite 不可用 */
    }

    // 回退到 UTF-8
    return buffer.toString("utf8");
  } catch (error) {
    if (isErrnoException(error) && error.code === "ERR_STRING_TOO_LONG") {
      throw createInternalError(
        "INTERNAL_ERROR",
        `文件过大无法转换为字符串: ${filePath} (${Math.round(stats.size / 1024 / 1024)}MB)`,
      );
    }

    // 回退到 UTF-8
    return await fs.readFile(filePath, "utf8");
  }
}

/**
 * 流式读取大文件的指定行范围。
 * 不会将整个文件加载到内存中。
 */
export async function readFileLinesStreaming(
  filePath: string,
  startLine: number = 1,
  endLine: number = Infinity,
): Promise<{ lines: string[]; totalLines: number }> {
  const result: string[] = [];
  let lineNumber = 0;

  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath, { encoding: "utf8" });
    const rl = createInterface({ crlfDelay: Infinity, input: stream });

    rl.on("line", (line: string) => {
      lineNumber++;
      if (lineNumber >= startLine && lineNumber <= endLine) {
        result.push(line);
      }
      if (lineNumber > endLine && endLine !== Infinity) {
        rl.close();
      }
    });

    rl.on("close", () => {
      stream.destroy();
      resolve({ lines: result, totalLines: lineNumber });
    });

    rl.on("error", (err) => {
      stream.destroy();
      reject(err);
    });

    stream.on("error", (err) => {
      rl.close();
      reject(err);
    });
  });
}

/**
 * 按正确编码写入文件。
 * 如果文件已存在，保留其原始编码；新文件使用 UTF-8。
 */
export async function writeFileWithEncoding(filePath: string, content: string): Promise<void> {
  try {
    let targetEncoding = "utf8";

    try {
      const existingBuffer = await fs.readFile(filePath);
      if (isUtf8Buffer(existingBuffer)) {
        targetEncoding = "utf8";
      } else {
        let detectedEncoding: string | null = null;
        try {
          // @ts-ignore — chardet 是可选依赖，类型可能存在也可能不存在
          const chardet = await import("chardet");
          detectedEncoding = chardet.detect(existingBuffer);
        } catch {
          /* Chardet 不可用 */
        }

        if (detectedEncoding && detectedEncoding !== "utf8" && detectedEncoding !== "ascii") {
          let enc = detectedEncoding;
          if (enc === "GB2312" || enc === "GBK" || enc === "GB18030") {
            enc = "GB18030";
          }

          try {
            // @ts-ignore — iconv-lite 是可选依赖，类型可能存在也可能不存在
            const iconv = await import("iconv-lite");
            if (iconv.encodingExists(enc)) {
              targetEncoding = enc;
            }
          } catch {
            /* Iconv-lite 不可用 */
          }
        }
      }
    } catch {
      // 文件不存在，使用 UTF-8
    }

    if (targetEncoding === "utf8") {
      await fs.writeFile(filePath, content, "utf8");
    } else {
      try {
        // @ts-ignore — iconv-lite 是可选依赖，类型可能存在也可能不存在
        const iconv = await import("iconv-lite");
        const encoded = iconv.encode(content, targetEncoding);
        await fs.writeFile(filePath, encoded);
      } catch {
        await fs.writeFile(filePath, content, "utf8");
      }
    }
  } catch {
    await fs.writeFile(filePath, content, "utf8");
  }
}
