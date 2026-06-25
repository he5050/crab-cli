# Skills Module — Skill 系统

## 整体定位

Skills 模块是 crab-cli 的 Skill 系统，负责 Skill 的发现、加载、执行、生成和推荐。Skill 是可复用的结构化提示词模板，用户可通过自然语言触发特定的 AI 行为（如解释代码、审查代码、编写测试等）。

## 核心功能

1. **Skill 发现** — 从项目级、全局等多目录扫描 SKILL.md 文件，解析 frontmatter 元数据
2. **Skill 管理** — 加载内置 + 磁盘 Skill，支持启用/禁用，持久化配置
3. **Skill 执行** — 组装 prompt（参数替换 + 用户输入追加），注入 toolRegistry
4. **Skill 生成** — 调用 LLM 生成 Skill 草稿并写入磁盘
5. **Skill 推荐** — 基于任务上下文关键词/标签多维度匹配打分
6. **内置 Skill** — 7 个随系统发布的默认 Skill

## 目录结构

```
src/extension/skill/
├── index.ts              # 统一值出入口
├── type.ts               # 统一类型出入口（re-export types/）
├── README.md
│
├── types/                # 核心类型定义 + Zod Schema
│   └── index.ts          # SkillDefinition, SkillSource, SkillParameter 等
│
├── manager/              # Skill 管理器（编排核心）
│   └── index.ts          # skillManager, SkillSearchResult
│
├── discovery/            # Skill 发现扫描与解析
│   └── index.ts          # discoverSkills, parseSkillFile
│
├── runner/               # Skill 执行引擎
│   └── index.ts          # SkillRunner, ToolRegistryView
│
├── generator/            # AI Skill 生成
│   └── index.ts          # generateSkillDraftWithAI, writeSkillDraft
│
├── recommendation/       # Skill 推荐引擎
│   └── index.ts          # recommendSkillsForContext, resolveExplicitSkillReference 等
│
└── builtin/              # 内置 Skill 定义
    └── index.ts          # builtinSkills
```

## 子模块说明

| 子模块            | 职责                  | 主要导出                                                                                                                                |
| ----------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `types/`          | 类型定义 + Zod Schema | `SkillDefinition`, `SkillSource`, `SkillParameter`, `SkillExecutionResult`, `SkillConfig`, `SkillFrontmatter`, `skillFrontmatterSchema` |
| `manager/`        | Skill 管理器          | `skillManager`, `SkillSearchResult`                                                                                                     |
| `discovery/`      | 文件扫描与解析        | `discoverSkills`, `parseSkillFile`                                                                                                      |
| `runner/`         | 执行引擎              | `SkillRunner`, `ToolRegistryView`                                                                                                       |
| `generator/`      | AI 生成               | `generateSkillDraftWithAI`, `writeSkillDraft`, `GeneratedSkillDraft`                                                                    |
| `recommendation/` | 推荐引擎              | `recommendSkillsForContext`, `resolveExplicitSkillReference`, `buildSkillIndexReminder`                                                 |
| `builtin/`        | 内置 Skill            | `builtinSkills`                                                                                                                         |

## 完整 API 导出

### 值导出

```typescript
import {
  skillManager, // 全局 Skill 管理器实例
  discoverSkills, // 从目录发现 Skill
  parseSkillFile, // 解析单个 Skill 文件
  SkillRunner, // Skill 执行器类
  builtinSkills, // 内置 Skill 列表
  skillFrontmatterSchema, // Zod 验证 Schema
  generateSkillDraftWithAI, // LLM 生成 Skill 草稿
  writeSkillDraft, // 写入 Skill 文件
  recommendSkillsForContext, // 基于上下文推荐 Skill
  resolveExplicitSkillReference, // 解析显式 Skill 引用
  buildSkillIndexReminder, // 构建索引提示
} from "@extension/skill";
```

### 类型导出

```typescript
import type {
  SkillDefinition, // Skill 定义
  SkillSource, // Skill 来源
  SkillParameter, // Skill 参数
  SkillExecutionResult, // Skill 执行结果
  SkillConfig, // Skill 配置
  SkillFrontmatter, // Frontmatter 类型
  SkillSearchResult, // Skill 搜索结果
  ToolRegistryView, // 工具注册表视图
  GeneratedSkillDraft, // 生成 Skill 草稿
  GenerateSkillDraftOptions, // 生成选项
  WriteSkillDraftOptions, // 写入选项
  WriteSkillDraftResult, // 写入结果
  SkillIndexEntry, // 索引项
  SkillRecommendation, // 推荐项
  ExplicitSkillResolution, // 显式解析结果
  SkillRecommendationContext, // 推荐上下文
} from "@extension/skill/type";
```

## 使用方法

```typescript
import { skillManager, discoverSkills } from "@extension/skill";
import type { SkillDefinition } from "@extension/skill/type";

// 初始化
await skillManager.init(projectDir);

// 查询
const allSkills = skillManager.list();
const skill = skillManager.get("review-code");

// 执行
const result = await skillManager.run("review-code", { file: "src/main.ts" });

// 推荐
import { recommendSkillsForContext } from "@extension/skill";
const candidates = recommendSkillsForContext({ userInput: "帮我检查这段代码" });
```

## 与外部系统的交互

| 外部模块          | 交互方式                                             | 说明                        |
| ----------------- | ---------------------------------------------------- | --------------------------- |
| `@conversation`   | 导入 `skillManager`、`resolveExplicitSkillReference` | 对话循环中注入 Skill 上下文 |
| `@commandPalette` | 动态导入 `@extension/skill`                          | 命令面板中执行/生成 Skill   |
| `@tool/skills`    | 导入 `@extension/skill` 推荐接口                     | Skill 搜索工具              |
| `@ui`             | 导入 `skillManager`、`SkillDefinition`               | UI 面板展示 Skill 列表      |

## 边界与限制

1. 内置 Skill 优先级低于磁盘同名 Skill
2. 禁用的 Skill 不会加载到内存中
3. 配置优先写入项目级，其次全局
4. 内置 7 个 Skill：explain-code / review-code / write-test / refactor / generate-docs / fix-bug / customize-crab
