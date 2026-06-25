/**
 * 代码库索引 Agent
 *
 * 职责:
 *   - 分析代码库结构，构建目录和文件索引
 *   - 识别项目类型和技术栈
 *   - 提取关键文件和模块关系
 *   - 生成代码库概览和统计信息
 *   - 支持多种文件类型分类
 *
 * 模块功能:
 *   - registerCodebaseIndexAgent: 注册代码库索引 Agent
 *   - createCodebaseIndex: 创建代码库索引
 *   - generateCodebaseOverview: 生成代码库概览
 *   - CodebaseIndexConfig: 索引配置接口
 *   - CodebaseIndexResult: 索引结果接口
 *   - FileType: 文件类型定义
 *
 * 使用场景:
 *   - 新项目探索时快速了解代码结构
 *   - 代码库重构前的结构分析
 *   - 生成代码库文档
 *   - 技术栈识别和统计
 *
 * 边界:
 *   1. 仅分析代码库结构，不修改任何文件
 *   2. 依赖文件系统读取，需要有效的项目路径
 *   3. 支持的最大文件数受配置限制
 *   4. 默认忽略 node_modules 等目录
 *
 * 流程:
 *   1. 扫描代码库目录结构
 *   2. 识别文件类型和分类
 *   3. 提取关键文件和模块关系
 *   4. 生成技术栈统计信息
 *   5. 构建代码库概览文档
 */

import { createLogger } from "@/core/logging/logger";
import { completeLlm } from "@/api";
import type { ModelMessage } from "ai";
import type { AppConfigSchema } from "@/schema/config";
import { createAgentRuntimeError, getAgentErrorMessage, toAgentLogPayload } from "@/agent/core/errors";
import {
  DEFAULT_CONFIG,
  EXTENSION_TO_LANGUAGE,
  TECH_STACK_INDICATORS,
  classifyFile,
  isEntryFile,
  shouldIgnoreDir,
  shouldIgnoreExtension,
} from "./codebaseIndexDefinitions";
import type {
  CodebaseIndexConfig,
  CodebaseIndexResult,
  DirectoryNode,
  FileType,
  IndexStatistics,
  IndexedFile,
  TechStack,
} from "./codebaseIndexDefinitions";
import { promises as fs } from "fs";
import path from "path";

const log = createLogger("agent:codebase-index");

export type {
  CodebaseIndexConfig,
  CodebaseIndexResult,
  DirectoryNode,
  FileType,
  IndexedFile,
  IndexStatistics,
  TechStack,
} from "./codebaseIndexDefinitions";
export { registerCodebaseIndexAgent } from "./codebaseIndexAgent";

async function fileExists(filePath: string, operation: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    log.debug(`文件不存在或不可访问: ${filePath}`, {
      error: getAgentErrorMessage(error),
      operation,
    });
    return false;
  }
}

/**
 * 识别技术栈
 */
async function identifyTechStack(rootPath: string): Promise<TechStack> {
  const techStack: TechStack = {
    buildTools: [],
    frameworks: [],
    languages: [],
  };

  try {
    const packageJsonPath = path.join(rootPath, "package.json");
    const packageContent = await fs.readFile(packageJsonPath, "utf8");
    const packageJson = JSON.parse(packageContent);

    if (packageJson.dependencies || packageJson.devDependencies) {
      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };

      const tsconfigExists = await fileExists(path.join(rootPath, "tsconfig.json"), "identifyTechStack.tsconfig");
      if (allDeps.typescript || tsconfigExists) {
        techStack.languages.push("TypeScript");
      } else if (Object.keys(allDeps).length > 0) {
        techStack.languages.push("JavaScript");
      }

      const frameworks = ["react", "vue", "next", "nuxt", "svelte", "express", "fastify", "nestjs"];
      for (const framework of frameworks) {
        if (Object.keys(allDeps).some((dep) => dep.toLowerCase().includes(framework))) {
          techStack.frameworks.push(framework.charAt(0).toUpperCase() + framework.slice(1));
        }
      }

      if (allDeps["@opentui/core"] || allDeps["@opentui/solid"]) {
        techStack.frameworks.push("OpenTUI");
      }
      if (allDeps["drizzle-orm"]) {
        (techStack.buildTools ??= []).push("Drizzle ORM");
      }
      if (allDeps["zod"]) {
        (techStack.buildTools ??= []).push("Zod");
      }
    }

    const bunLockExists = await fileExists(path.join(rootPath, "bun.lock"), "identifyTechStack.packageManager");
    const bunLockbExists = await fileExists(path.join(rootPath, "bun.lockb"), "identifyTechStack.packageManager");
    const packageLockExists = await fileExists(
      path.join(rootPath, "package-lock.json"),
      "identifyTechStack.packageManager",
    );
    const yarnLockExists = await fileExists(path.join(rootPath, "yarn.lock"), "identifyTechStack.packageManager");
    const pnpmLockExists = await fileExists(path.join(rootPath, "pnpm-lock.yaml"), "identifyTechStack.packageManager");

    if (bunLockExists || bunLockbExists) {
      techStack.packageManager = "bun";
    } else if (packageLockExists) {
      techStack.packageManager = "npm";
    } else if (yarnLockExists) {
      techStack.packageManager = "yarn";
    } else if (pnpmLockExists) {
      techStack.packageManager = "pnpm";
    }
  } catch (err) {
    const error = createAgentRuntimeError(
      err,
      {
        agent: "codebase-index",
        operation: "identifyTechStack.packageJson",
        rootPath,
      },
      "fs_read",
    );
    log.debug("package.json 不存在或解析失败，继续使用特征文件识别技术栈", toAgentLogPayload(error));
  }

  for (const [tech, files] of Object.entries(TECH_STACK_INDICATORS)) {
    for (const file of files) {
      const filePath = path.join(rootPath, file);
      const exists = await fileExists(filePath, "identifyTechStack.indicator");
      if (exists) {
        if (!techStack.frameworks.includes(tech) && !techStack.languages.includes(tech)) {
          if (["React", "Vue", "Next.js", "Nuxt", "Svelte"].includes(tech)) {
            techStack.frameworks.push(tech);
          } else if (["Node.js", "Python", "Rust", "Go", "Java", "TypeScript", "Bun", "Docker"].includes(tech)) {
            if (!techStack.languages.includes(tech) && !(techStack.buildTools ??= []).includes(tech)) {
              (techStack.buildTools ??= []).push(tech);
            }
          }
        }
        break;
      }
    }
  }

  return techStack;
}

/**
 * 递归扫描目录构建索引
 */
async function scanDirectory(
  dirPath: string,
  config: CodebaseIndexConfig,
  depth: number = 0,
  basePath: string = "",
): Promise<DirectoryNode> {
  const dirName = path.basename(dirPath);
  const node: DirectoryNode = {
    children: [],
    depth,
    files: [],
    name: dirName,
    path: basePath || dirPath,
  };

  if (depth >= (config.maxDepth ?? DEFAULT_CONFIG.maxDepth)) {
    return node;
  }

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (
          !shouldIgnoreDir(entry.name, config.ignoreDirs) ||
          (entry.name === "node_modules" && config.includeNodeModules) ||
          (entry.name === ".git" && config.includeGit)
        ) {
          const childNode = await scanDirectory(entryPath, config, depth + 1, relativePath);
          if (childNode.children.length > 0 || childNode.files.length > 0) {
            node.children.push(childNode);
          }
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (!shouldIgnoreExtension(ext, config.ignoreExtensions)) {
          try {
            const stat = await fs.stat(entryPath);
            if (stat.size <= (config.maxFileSize ?? DEFAULT_CONFIG.maxFileSize)) {
              const file: IndexedFile = {
                extension: ext,
                isEntry: isEntryFile(relativePath),
                language: EXTENSION_TO_LANGUAGE[ext.toLowerCase()],
                name: entry.name,
                path: relativePath,
                size: stat.size,
                type: classifyFile(relativePath, ext),
              };
              node.files.push(file);
            }
          } catch (err) {
            const error = createAgentRuntimeError(
              err,
              {
                agent: "codebase-index",
                filePath: entryPath,
                operation: "scanDirectory.fileStat",
              },
              "fs_read",
            );
            log.debug(`文件访问失败，跳过: ${entryPath}`, toAgentLogPayload(error));
          }
        }
      }
    }
  } catch (err) {
    const error = createAgentRuntimeError(
      err,
      {
        agent: "codebase-index",
        filePath: dirPath,
        operation: "scanDirectory",
      },
      "fs_read",
    );
    log.warn(`扫描目录失败: ${dirPath}`, toAgentLogPayload(error));
  }

  node.children.sort((a, b) => a.name.localeCompare(b.name));
  node.files.sort((a, b) => a.name.localeCompare(b.name));

  return node;
}

/**
 * 计算统计信息
 */
function computeStatistics(directoryTree: DirectoryNode[], allFiles: IndexedFile[]): IndexStatistics {
  const stats: IndexStatistics = {
    byLanguage: {},
    byType: {
      asset: 0,
      build: 0,
      config: 0,
      data: 0,
      doc: 0,
      source: 0,
      test: 0,
      unknown: 0,
    },
    configFiles: 0,
    docFiles: 0,
    sourceFiles: 0,
    testFiles: 0,
    totalDirectories: 0,
    totalFiles: 0,
    totalSize: 0,
  };

  function countDirectory(node: DirectoryNode) {
    stats.totalDirectories++;
    for (const file of node.files) {
      stats.totalFiles++;
      stats.totalSize! += file.size;
      stats.byType![file.type] = (stats.byType![file.type] || 0) + 1;

      if (file.type === "source") {
        stats.sourceFiles++;
      }
      if (file.type === "config") {
        stats.configFiles++;
      }
      if (file.type === "test") {
        stats.testFiles++;
      }
      if (file.type === "doc") {
        stats.docFiles++;
      }

      if (file.language) {
        stats.byLanguage[file.language] = (stats.byLanguage[file.language] || 0) + 1;
      }
    }
    for (const child of node.children) {
      countDirectory(child);
    }
  }

  for (const root of directoryTree) {
    countDirectory(root);
  }

  return stats;
}

/**
 * 识别关键文件
 */
function identifyKeyFiles(files: IndexedFile[]): string[] {
  const keyFiles: string[] = [];

  const entries = files.filter((f) => f.isEntry);
  keyFiles.push(...entries.map((f) => f.path));

  const configs = files.filter(
    (f) =>
      f.name === "package.json" ||
      f.name === "tsconfig.json" ||
      f.name === "vite.config.ts" ||
      f.name === "webpack.config.js" ||
      f.name === "next.config.js" ||
      f.name === "bunfig.toml",
  );
  keyFiles.push(...configs.map((f) => f.path));

  const readmes = files.filter((f) => f.name.toLowerCase() === "readme.md" || f.name.toLowerCase() === "readme.txt");
  keyFiles.push(...readmes.map((f) => f.path));

  return keyFiles;
}

/**
 * 创建代码库索引
 */
export async function createCodebaseIndex(
  rootPath: string,
  partialConfig?: Partial<CodebaseIndexConfig>,
): Promise<CodebaseIndexResult> {
  const config: CodebaseIndexConfig = {
    ...DEFAULT_CONFIG,
    ...partialConfig,
  };

  try {
    const stat = await fs.stat(rootPath);
    if (!stat.isDirectory()) {
      const error = createAgentRuntimeError(
        new Error("指定的路径不是目录"),
        {
          agent: "codebase-index",
          operation: "createCodebaseIndex.validateRoot",
          rootPath,
        },
        "invalid_input",
      );
      return {
        allFiles: [],
        directoryTree: { children: [], fileCount: 0, files: [], name: "", path: "" },
        error: error.message,
        errorCode: error.code,
        keyFiles: [],
        rootPath,
        statistics: {
          assetFiles: 0,
          byLanguage: {},
          configFiles: 0,
          docFiles: 0,
          otherFiles: 0,
          sourceFiles: 0,
          testFiles: 0,
          totalDirectories: 0,
          totalFiles: 0,
        },
        success: false,
        techStack: { buildTools: [], frameworks: [], languages: [] },
      };
    }

    log.info(`开始索引代码库: ${rootPath}`);

    const techStack = await identifyTechStack(rootPath);

    const directoryTree = [await scanDirectory(rootPath, config, 0, path.basename(rootPath))];

    const allFiles: IndexedFile[] = [];
    function collectFiles(node: DirectoryNode) {
      allFiles.push(...node.files);
      for (const child of node.children) {
        collectFiles(child);
      }
    }
    for (const root of directoryTree) {
      collectFiles(root);
    }

    const statistics = computeStatistics(directoryTree, allFiles);

    const keyFiles = identifyKeyFiles(allFiles);

    let projectName: string | undefined;
    try {
      const packageJsonPath = path.join(rootPath, "package.json");
      const content = await fs.readFile(packageJsonPath, "utf8");
      const pkg = JSON.parse(content);
      projectName = pkg.name;
    } catch (err) {
      const error = createAgentRuntimeError(
        err,
        {
          agent: "codebase-index",
          operation: "createCodebaseIndex.projectName",
          rootPath,
        },
        "fs_read",
      );
      log.debug("读取项目名称失败，使用目录名作为项目名称", toAgentLogPayload(error));
      projectName = path.basename(rootPath);
    }

    log.info(`代码库索引完成: ${statistics.totalFiles} 个文件, ${statistics.totalDirectories} 个目录`);

    return {
      allFiles,
      directoryTree: directoryTree[0] ?? { name: "", path: "", children: [], files: [], fileCount: 0 },
      keyFiles,
      projectName,
      rootPath,
      statistics,
      success: true,
      techStack,
    };
  } catch (err) {
    const error = createAgentRuntimeError(
      err,
      {
        agent: "codebase-index",
        operation: "createCodebaseIndex",
        rootPath,
      },
      "resource_missing",
    );
    log.error(`代码库索引失败`, { ...toAgentLogPayload(error), rootPath });
    return {
      allFiles: [],
      directoryTree: { children: [], fileCount: 0, files: [], name: "", path: "" },
      error: error.message,
      errorCode: error.code,
      keyFiles: [],
      rootPath,
      statistics: {
        assetFiles: 0,
        byLanguage: {},
        configFiles: 0,
        docFiles: 0,
        otherFiles: 0,
        sourceFiles: 0,
        testFiles: 0,
        totalDirectories: 0,
        totalFiles: 0,
      },
      success: false,
      techStack: { buildTools: [], frameworks: [], languages: [] },
    };
  }
}

/**
 * 使用 AI 生成代码库概览
 */
export async function generateCodebaseOverview(
  indexResult: CodebaseIndexResult,
  config?: AppConfigSchema,
): Promise<string> {
  if (!indexResult.success) {
    return `索引失败: ${indexResult.error}`;
  }

  const prompt = `基于以下代码库索引信息，生成一个简洁的代码库概览:

项目名称: ${indexResult.projectName || "未知"}
技术栈: ${indexResult.techStack.languages.join(", ")} + ${indexResult.techStack.frameworks.join(", ")}
包管理器: ${indexResult.techStack.packageManager || "未知"}

统计信息:
- 总文件数: ${indexResult.statistics.totalFiles}
- 总目录数: ${indexResult.statistics.totalDirectories}
- 源代码文件: ${indexResult.statistics.sourceFiles}
- 配置文件: ${indexResult.statistics.configFiles}
- 测试文件: ${indexResult.statistics.testFiles}
- 文档文件: ${indexResult.statistics.docFiles}

关键文件:
${indexResult.keyFiles
  .slice(0, 10)
  .map((f) => `- ${f}`)
  .join("\n")}

语言分布:
${Object.entries(indexResult.statistics.byLanguage)
  .toSorted((a, b) => b[1] - a[1])
  .slice(0, 5)
  .map(([lang, count]) => `- ${lang}: ${count} 个文件`)
  .join("\n")}

请生成一个 200 字以内的代码库概览，包括项目类型、技术栈、代码组织方式等关键信息。`;

  try {
    const messages: ModelMessage[] = [
      {
        content: prompt,
        role: "user",
      },
    ];

    const loadedConfig = await (config ? Promise.resolve(config) : import("@config").then((m) => m.loadConfig()));
    const { text: result } = await completeLlm(loadedConfig!, messages, {
      maxTokens: 500,
      modelId: config?.defaultProvider?.model ?? "claude-3-5-sonnet",
      temperature: 0.3,
    });

    return result || "生成概览失败";
  } catch (err) {
    const error = createAgentRuntimeError(
      err,
      {
        agent: "codebase-index",
        operation: "generateCodebaseOverview",
        rootPath: indexResult.rootPath,
      },
      "execution",
    );
    log.error(`生成代码库概览失败`, toAgentLogPayload(error));
    return `生成概览失败: ${error.message} (${error.code})`;
  }
}
