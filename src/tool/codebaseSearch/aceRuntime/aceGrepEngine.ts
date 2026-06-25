import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createLogger } from "@/core/logging/logger";
import { FILE_READ_CHUNK_SIZE, GREP_EXCLUDE_DIRS } from "./constants";
import { expandGlobBraces, parseGrepOutput } from "./search";
import type { TextSearchResult } from "./types";

const log = createLogger("tool:ace-grep-engine");

/** Grep 搜索引擎，封装 git grep、ripgrep 和系统 grep 的子进程调用 */
export class GrepSearchEngine {
  constructor(
    private basePath: string,
    private markActivity: () => void,
  ) {}

  async gitGrepSearch(
    pattern: string,
    fileGlob?: string,
    maxResults: number = 100,
    isRegex: boolean = true,
  ): Promise<TextSearchResult[]> {
    this.markActivity();
    const timeoutMs = 15_000;

    return new Promise((resolve, reject) => {
      const args = ["grep", "--untracked", "-n", "--ignore-case"];

      if (isRegex) {
        args.push("-E");
      } else {
        args.push("--fixed-strings");
      }

      args.push(pattern);

      if (fileGlob) {
        let gitGlob = fileGlob.replace(/\\/g, "/");
        gitGlob = gitGlob.replace(/\*\*/g, "*");
        const expandedGlobs = expandGlobBraces(gitGlob);
        args.push("--", ...expandedGlobs);
      }

      const child = spawn("git", args, {
        cwd: this.basePath,
        windowsHide: true,
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let isCompleted = false;

      const finalize = (handler: () => void, killProcess: boolean = false): void => {
        if (isCompleted) {
          return;
        }
        isCompleted = true;
        clearTimeout(timeoutId);
        if (killProcess && !child.killed) {
          child.kill("SIGTERM");
        }
        handler();
      };

      const timeoutId = setTimeout(() => {
        finalize(() => {
          log.warn(`git grep timed out after ${timeoutMs}ms`);
          reject(new Error(`git grep timed out after ${timeoutMs}ms`));
        }, true);
      }, timeoutMs);
      timeoutId.unref?.();

      child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

      child.once("error", (err: Error) => {
        finalize(() => {
          reject(new Error(`Failed to start git grep: ${err.message}`));
        });
      });

      child.once("close", (code: number | null) => {
        const stdoutData = Buffer.concat(stdoutChunks).toString("utf8");
        const stderrData = Buffer.concat(stderrChunks).toString("utf8").trim();

        finalize(() => {
          if (code === 0) {
            const results = parseGrepOutput(stdoutData, this.basePath);
            resolve(results.slice(0, maxResults));
          } else if (code === 1) {
            resolve([]);
          } else {
            reject(new Error(`git grep exited with code ${code}: ${stderrData}`));
          }
        });
      });
    });
  }

  async systemGrepSearch(
    pattern: string,
    fileGlob?: string,
    maxResults: number = 100,
    grepCommand: "rg" | "grep" = "grep",
  ): Promise<TextSearchResult[]> {
    this.markActivity();
    const isRipgrep = grepCommand === "rg";
    const timeoutMs = 15_000;

    return new Promise((resolve, reject) => {
      const args = isRipgrep ? ["-n", "-i", "--no-heading"] : ["-r", "-n", "-H", "-E", "-i"];

      if (isRipgrep) {
        GREP_EXCLUDE_DIRS.forEach((dir) => args.push("--glob", `!${dir}/`));
        if (fileGlob) {
          const normalizedGlob = fileGlob.replace(/\\/g, "/");
          const expandedGlobs = expandGlobBraces(normalizedGlob);
          expandedGlobs.forEach((glob) => args.push("--glob", glob));
        }
      } else {
        GREP_EXCLUDE_DIRS.forEach((dir) => args.push(`--exclude-dir=${dir}`));
        if (fileGlob) {
          const normalizedGlob = fileGlob.replace(/\\/g, "/");
          const expandedGlobs = expandGlobBraces(normalizedGlob);
          expandedGlobs.forEach((glob) => args.push(`--include=${glob}`));
        }
      }
      args.push(pattern, ".");

      const child = spawn(grepCommand, args, {
        cwd: this.basePath,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let isCompleted = false;

      const finalize = (handler: () => void, killProcess: boolean = false): void => {
        if (isCompleted) {
          return;
        }
        isCompleted = true;
        clearTimeout(timeoutId);
        if (killProcess && !child.killed) {
          child.kill("SIGTERM");
        }
        handler();
      };

      const timeoutId = setTimeout(() => {
        finalize(() => {
          log.warn(`${grepCommand} timed out after ${timeoutMs}ms`);
          reject(new Error(`${grepCommand} timed out after ${timeoutMs}ms`));
        }, true);
      }, timeoutMs);
      timeoutId.unref?.();

      child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => {
        const stderrStr = chunk.toString();
        if (!stderrStr.includes("Permission denied") && !/grep:.*: Is a directory/i.test(stderrStr)) {
          stderrChunks.push(chunk);
        }
      });

      child.once("error", (err: Error) => {
        finalize(() => {
          reject(new Error(`Failed to start ${grepCommand}: ${err.message}`));
        });
      });

      child.once("close", (code: number | null) => {
        const stdoutData = Buffer.concat(stdoutChunks).toString("utf8");
        const stderrData = Buffer.concat(stderrChunks).toString("utf8").trim();

        finalize(() => {
          if (code === 0) {
            const results = parseGrepOutput(stdoutData, this.basePath);
            resolve(results.slice(0, maxResults));
          } else if (code === 1) {
            resolve([]);
          } else if (stderrData) {
            reject(new Error(`${grepCommand} exited with code ${code}: ${stderrData}`));
          } else {
            resolve([]);
          }
        });
      });
    });
  }

  async searchInLargeFile(
    fileInfo: { fullPath: string; relativePath: string },
    searchRegex: RegExp,
    results: TextSearchResult[],
    maxResults: number,
    isAborted: () => boolean,
  ): Promise<void> {
    this.markActivity();

    return new Promise((resolve) => {
      const stream = createReadStream(fileInfo.fullPath, {
        encoding: "utf8",
        highWaterMark: FILE_READ_CHUNK_SIZE,
      });

      const rl = createInterface({
        crlfDelay: Infinity,
        input: stream,
      });

      let lineNumber = 0;
      let isResolved = false;

      const finalize = (): void => {
        if (isResolved) {
          return;
        }
        isResolved = true;
        rl.removeAllListeners();
        stream.removeAllListeners();
        stream.destroy();
        resolve();
      };

      rl.on("line", (line: string) => {
        if (isAborted() || results.length >= maxResults) {
          rl.close();
          return;
        }

        lineNumber++;
        if (!line) {
          return;
        }

        searchRegex.lastIndex = 0;
        const match = searchRegex.exec(line);
        if (match) {
          results.push({
            column: match.index + 1,
            content: line.trim(),
            filePath: fileInfo.relativePath,
            line: lineNumber,
          });
        }
      });

      rl.once("close", finalize);
      rl.once("error", () => finalize());
      stream.once("error", () => finalize());
    });
  }
}
