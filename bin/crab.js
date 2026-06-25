#!/usr/bin/env node
/**
 * crab-cli npm 入口点 — 兼容 Node.js 环境。
 *
 * 当通过 `npm install -g crab-cli` 安装时，npm 会创建指向此文件的符号链接。
 * 此文件负责检测运行时环境：
 *   - 如果 Bun 可用，使用 Bun 运行原始 TypeScript 入口
 *   - 如果只有 Node.js，使用编译后的 JavaScript 入口
 *
 * 使用场景:
 *   - npm 全局安装: npm install -g crab-cli
 *   - npx 调用: npx crab-cli
 */

const { existsSync } = require("node:fs");
const { join } = require("node:path");
const { spawn } = require("node:child_process");

const pkgDir = join(__dirname, "..");

// 优先尝试 Bun 运行时（原生 TypeScript 支持）
try {
  const bunPath = require("child_process").execSync("which bun 2>/dev/null", { encoding: "utf-8" }).trim();

  if (bunPath) {
    const tsEntry = join(pkgDir, "bin", "crab.ts");
    if (existsSync(tsEntry)) {
      const child = spawn(bunPath, ["run", tsEntry, ...process.argv.slice(2)], {
        stdio: "inherit",
        env: process.env,
      });
      child.on("exit", (code) => process.exit(code ?? 1));
      return;
    }
  }
} catch {
  // Bun 不可用，继续使用 Node.js
}

// Node.js 模式：使用编译后的 JavaScript 入口
const jsEntry = join(pkgDir, "dist", "index.js");

if (!existsSync(jsEntry)) {
  console.error("错误: crab-cli 未正确构建。");
  console.error("");
  console.error("如果你通过 npm 安装，请尝试重新安装:");
  console.error("  npm uninstall -g crab-cli && npm install -g crab-cli");
  console.error("");
  console.error("如果你从源码安装，请先运行构建:");
  console.error("  bun install && bun run build");
  process.exit(1);
}

require(jsEntry);
