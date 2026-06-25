/**
 * Git + 代码库 + IDE 命令。
 *
 * 职责:
 *   - 提供 Git 操作命令(分支、Worktree、Diff、代码审查、Blame)
 *   - 提供代码库管理命令(索引、重建索引、添加目录)
 *   - 提供 IDE 集成命令(连接、状态、统计、安装扩展、诊断)
 *
 * 模块功能:
 *   - buildGitCodebaseIdeCommands: 构建 Git、代码库和 IDE 命令
 *   - git.branch: Git 分支管理
 *   - git.worktree: Git Worktree 管理
 *   - git.diff: Git Diff 查看
 *   - git.review: 代码审查
 *   - git.blame: Git Blame
 *   - codebase.index: 代码库索引
 *   - codebase.rebuild-index: 重建代码库索引
 *   - codebase.add-dir: 添加目录到代码库
 *   - ide.connect: 连接 IDE
 *   - ide.status: IDE 状态
 *   - ide.stats: IDE 统计
 *   - ide.install-extension: 安装扩展
 *   - ide.diagnose: IDE 诊断
 *   - ide.ws-server: WebSocket 服务端启停
 *   - ide.ws-clients: WebSocket 客户端列表
 *
 * 使用场景:
 *   - 用户需要执行 Git 操作
 *   - 用户需要管理代码库索引
 *   - 用户需要与 IDE 集成
 *   - 用户需要代码审查
 *
 * 边界:
 *   1. Git 命令依赖 gitTool 模块
 *   2. 代码库命令依赖 codebase 模块
 *   3. IDE 命令依赖 ide 模块
 *   4. 部分命令需要有效的 Git 仓库或 IDE 连接
 *
 * 流程:
 *   1. 接收 CommandDeps 依赖
 *   2. 构建 Git、代码库和 IDE 命令数组
 *   3. 各命令调用对应模块的功能
 *   4. 通过 EventBus 通知操作结果
 */
import type { Command } from "@/commandPalette/types";
import type { CommandDeps } from "../../shared";
import { globalBus, type EventBus } from "@/bus";
import { AppEvent } from "@/bus";
import { buildIdeCommands } from "./ideCommands";
import { rebuildCodebaseIndex } from "@/tool/codebaseSearch/indexer/rebuildIndex";

export function buildGitCodebaseIdeCommands(deps: CommandDeps, eventBus: EventBus = globalBus): Command[] {
  return [
    // ─── Git 命令 ────────────────────────────────────────
    {
      category: "Git",
      description: "查看、切换或创建 Git 分支",
      name: "git.branch",
      run: async (args?: string) => {
        try {
          const { gitTool } = await import("@/tool/git");
          const branchName = args?.trim();

          if (!branchName) {
            // 列出所有分支
            const result = await gitTool.execute({ operation: "branch" });
            eventBus.publish(AppEvent.Log, {
              level: "info",
              message: `Git 分支列表:\n${result}`,
            });
          } else {
            // 切换或创建分支
            const result = String(await gitTool.execute({ args: branchName, operation: "checkout" }));
            if (result.includes("error") || result.includes("fatal")) {
              // 尝试创建新分支
              const createResult = String(await gitTool.execute({ args: `-b ${branchName}`, operation: "checkout" }));
              deps.showToast?.(createResult, createResult.includes("error") ? "error" : "success");
            } else {
              deps.showToast?.(`已切换到分支: ${branchName}`, "success");
            }
          }
        } catch (error) {
          deps.showToast?.(`Git 分支操作失败: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
      slashName: "branch",
      title: "Git 分支",
    },
    {
      category: "Git",
      description: "管理 Git worktree(列出/添加/删除)",
      name: "git.worktree",
      run: async (args?: string) => {
        try {
          const { execFileSync } = await import("node:child_process");
          const cwd = process.cwd();

          if (!args?.trim()) {
            // 列出 worktree
            const result = execFileSync("git", ["worktree", "list"], { cwd, encoding: "utf8" });
            eventBus.publish(AppEvent.Log, {
              level: "info",
              message: `Git Worktree 列表:\n${result}`,
            });
          } else {
            const [subCmd, ...rest] = args.trim().split(/\s+/);

            if (subCmd === "add") {
              const [path, branch] = rest;
              if (!path) {
                deps.showToast?.("用法: /worktree add <path> [branch]", "warning");
                return;
              }
              const worktreeArgs = branch ? ["add", path, branch] : ["add", path];
              execFileSync("git", worktreeArgs, { cwd, encoding: "utf8" });
              deps.showToast?.(`Worktree 添加成功: ${path}`, "success");
            } else if (subCmd === "remove") {
              const [path] = rest;
              if (!path) {
                deps.showToast?.("用法: /worktree remove <path>", "warning");
                return;
              }
              execFileSync("git", ["worktree", "remove", path], { cwd, encoding: "utf8" });
              deps.showToast?.(`Worktree 移除成功: ${path}`, "success");
            } else {
              deps.showToast?.("用法: /worktree [add <path> [branch] | remove <path>]", "info");
            }
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          deps.showToast?.(`Git Worktree 操作失败: ${msg}`, "error");
        }
      },
      slashName: "worktree",
      title: "Git Worktree",
    },
    {
      category: "Git",
      description: "查看 Git diff(工作区、暂存区或指定文件)",
      name: "git.diff",
      run: async (args?: string) => {
        try {
          const { gitTool } = await import("@/tool/git");
          const diffArgs = args?.trim() || "";

          const result = await gitTool.execute({
            args: diffArgs,
            operation: "diff",
          });

          deps.navigate({
            data: {
              args: diffArgs,
              diff: String(result),
              source: "git",
            },
            id: "diff",
            type: "plugin",
          });
          eventBus.publish(AppEvent.Log, {
            level: "info",
            message: `Git Diff:\n\`\`\`diff\n${result}\n\`\`\``,
          });
        } catch (error) {
          deps.showToast?.(`Git Diff 失败: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
      slashName: "diff",
      title: "Git Diff",
    },
    {
      category: "Git",
      description: "AI 代码审查当前变更",
      name: "git.review",
      run: async () => {
        try {
          const { gitTool } = await import("@/tool/git");

          // 获取 diff
          const diff = String(await gitTool.execute({ args: "HEAD", operation: "diff" }));

          if (!diff || diff === "(无输出)" || diff.includes("没有差异")) {
            deps.showToast?.("没有可审查的变更", "info");
            return;
          }

          // 限制 diff 大小
          const maxDiffSize = 50_000;
          const truncatedDiff = diff.length > maxDiffSize ? `${diff.slice(0, maxDiffSize)}\n...(diff 已截断)` : diff;

          eventBus.publish(AppEvent.Log, {
            level: "info",
            message: `准备代码审查...\nDiff 大小: ${diff.length} 字符`,
          });

          eventBus.publish(AppEvent.ConversationMessageSent, {
            content: `请审查以下代码变更:\n\`\`\`diff\n${truncatedDiff}\n\`\`\``,
            role: "user",
          });

          deps.showToast?.("代码审查请求已发送", "success");
        } catch (error) {
          deps.showToast?.(`代码审查失败: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
      slashName: "review",
      title: "代码审查",
    },
    {
      category: "Git",
      description: "按行追踪 Git 历史(blame)",
      name: "git.gitLine",
      run: async (args?: string) => {
        try {
          const { execFileSync } = await import("node:child_process");
          const cwd = process.cwd();

          if (!args?.trim()) {
            deps.showToast?.("用法: /gitline <file> [line]", "info");
            return;
          }

          const [file, line] = args.trim().split(/\s+/);

          if (!file) {
            deps.showToast?.("用法: /gitline <file> [line]", "info");
            return;
          }

          const blameArgs: string[] = ["blame", file];
          if (line) {
            const lineNum = parseInt(line, 10);
            if (!isNaN(lineNum)) {
              blameArgs.push("-L", `${lineNum},${lineNum}`);
            }
          }

          const result = execFileSync("git", blameArgs, { cwd, encoding: "utf8" });
          eventBus.publish(AppEvent.Log, {
            level: "info",
            message: `Git Blame (${file}${line ? `:${line}` : ""}):\n${result}`,
          });
        } catch (error) {
          deps.showToast?.(`Git Blame 失败: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
      slashName: "gitline",
      title: "Git 责任追踪",
    },
    {
      category: "Git",
      description: "合并指定分支到当前分支",
      name: "git.merge",
      run: async (args?: string) => {
        try {
          const branchName = args?.trim();
          if (!branchName) {
            deps.showToast?.("用法: /merge <分支名>", "warning");
            return;
          }

          const { gitMerge } = await import("@/tool/git");
          const result = (await gitMerge.execute({ branch: branchName })) as { success: boolean; error?: string };

          if (!result.success) {
            deps.showToast?.(`合并失败或存在冲突:\n${result.error ?? JSON.stringify(result)}`, "error");
          } else {
            deps.showToast?.(`已合并分支: ${branchName}`, "success");
          }
        } catch (error) {
          deps.showToast?.(`合并失败: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
      slashName: "merge",
      title: "Git 合并",
    },
    {
      category: "Git",
      description: "将当前分支变基到指定分支(/rebase <分支> [--continue|--abort|--skip])",
      name: "git.rebase",
      run: async (args?: string) => {
        try {
          const argsStr = args?.trim() || "";
          if (!argsStr) {
            deps.showToast?.("用法: /rebase <分支> [--continue|--abort|--skip]", "warning");
            return;
          }

          const { gitRebase } = await import("@/tool/git");
          const result = (await gitRebase.execute({ branch: argsStr })) as { success: boolean; error?: string };

          if (!result.success) {
            deps.showToast?.(`变基失败或存在冲突:\n${result.error ?? JSON.stringify(result)}`, "error");
          } else {
            deps.showToast?.(`变基完成`, "success");
          }
        } catch (error) {
          deps.showToast?.(`变基失败: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
      slashName: "rebase",
      title: "Git 变基",
    },
    {
      category: "Git",
      description: "推送当前分支到远程仓库(/push [远程仓库] [分支])",
      name: "git.push",
      run: async (args?: string) => {
        try {
          const argsStr = args?.trim() || "";
          const { gitPush } = await import("@/tool/git");
          const result = (await gitPush.execute({})) as { success: boolean; error?: string };

          if (!result.success) {
            deps.showToast?.(`推送失败:\n${result.error ?? JSON.stringify(result)}`, "error");
          } else {
            deps.showToast?.(`推送成功`, "success");
          }
        } catch (error) {
          deps.showToast?.(`推送失败: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
      slashName: "push",
      title: "Git 推送",
    },
    {
      category: "Git",
      description: "创建或列出 Git 标签(/tag [标签名] [消息])",
      name: "git.tag",
      run: async (args?: string) => {
        try {
          const argsStr = args?.trim();
          if (!argsStr) {
            // 列出所有标签
            const { execFileSync } = await import("node:child_process");
            const cwd = process.cwd();
            const result = execFileSync("git", ["tag", "-l", "-n"], { cwd, encoding: "utf8" });
            const tags = result.trim().split("\n").filter(Boolean);
            if (tags.length === 0) {
              deps.showToast?.("仓库暂无标签", "info");
            } else {
              const lines = [`仓库标签 (${tags.length} 个):`];
              tags.slice(0, 20).forEach((tag) => lines.push(`  ${tag}`));
              if (tags.length > 20) {
                lines.push(`  ... (还有 ${tags.length - 20} 个标签)`);
              }
              deps.showToast?.(lines.join("\n"), "info");
            }
          } else {
            const parts = argsStr.split(/\s+/);
            const tagName = parts[0]!;
            const tagMessage = parts.slice(1).join(" ");

            const { execFileSync } = await import("node:child_process");
            const cwd = process.cwd();

            if (tagMessage) {
              execFileSync("git", ["tag", "-a", tagName, "-m", tagMessage], { cwd, encoding: "utf8" });
              deps.showToast?.(`已创建标签: ${tagName}`, "success");
            } else {
              execFileSync("git", ["tag", tagName], { cwd, encoding: "utf8" });
              deps.showToast?.(`已创建标签: ${tagName}`, "success");
            }
          }
        } catch (error) {
          deps.showToast?.(`标签操作失败: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
      slashName: "tag",
      title: "Git 标签",
    },

    // ─── 代码库命令 ──────────────────────────────────────
    {
      category: "代码库",
      description: "查看代码库索引状态",
      name: "codebase.index",
      run: async () => {
        try {
          const { VectorDb } = await import("@/tool/codebaseSearch/indexer/vectorDb");
          const db = new VectorDb();
          try {
            const stats = db.getStats();
            const sizeKB = (stats.dbSizeBytes / 1024).toFixed(1);
            deps.showToast?.(`代码库索引: ${stats.totalChunks} 分块 / ${stats.totalFiles} 文件 / ${sizeKB}KB`, "info");
            eventBus.publish(AppEvent.Log, {
              level: "info",
              message: `代码库索引状态:\n  已索引文件: ${stats.totalFiles}\n  代码分块: ${stats.totalChunks}\n  数据库大小: ${sizeKB}KB\n  使用 /reindex 重建索引`,
            });
          } finally {
            db.close();
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          deps.showToast?.(`获取索引状态失败: ${msg}`, "error");
        }
      },
      slashName: "codebase",
      title: "代码库索引",
    },
    {
      category: "代码库",
      description: "重建代码库向量索引",
      name: "codebase.reindex",
      run: async () => {
        await rebuildCodebaseIndex({
          publishLog: (level, message) => {
            eventBus.publish(AppEvent.Log, { level, message });
          },
          showToast: deps.showToast,
        });
      },
      slashName: "reindex",
      title: "重建索引",
    },
    {
      category: "代码库",
      description: "添加额外目录到代码库索引",
      name: "codebase.addDir",
      run: async () => {
        try {
          const { VectorDb } = await import("@/tool/codebaseSearch/indexer/vectorDb");
          const { CodebaseIndexer } = await import("@/tool/codebaseSearch/indexer/codebaseIndexer");
          const cwd = process.cwd();
          deps.showToast?.("正在索引当前目录...", "info");
          const db = new VectorDb();
          try {
            const indexer = new CodebaseIndexer({ db, rootDir: cwd });
            const result = await indexer.fullIndex();
            deps.showToast?.(`索引完成: ${result.filesProcessed} 文件, ${result.chunksGenerated} 分块`, "success");
          } finally {
            db.close();
          }
        } catch (error) {
          deps.showToast?.(`索引失败: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
      slashName: "add-dir",
      title: "添加目录",
    },

    ...buildIdeCommands(deps, eventBus),
  ];
}
