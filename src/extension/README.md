# @extension — 扩展系统

## 整体定位

Extension 模块是 crab-cli 的扩展能力层，负责管理两大子系统：

1. **Skill 系统**（`skill/`）— 内置/自定义 Skill 的发现、加载、搜索、推荐、执行与 AI 生成
2. **Plugin 系统**（`plugin/`）— 外部插件的发现、加载、沙箱校验与市场评估

几乎所有其他模块不直接依赖本模块，而是通过 `@extension/skill` 消费 Skill 能力。Plugin 系统目前处于架构就绪阶段，尚未集成到主应用运行时。

## 目录结构

```
src/extension/
├── index.ts              # 统一出入口，re-export skill + plugin
├── README.md             # 本文档
│
├── skill/               # Skill 系统
│   ├── index.ts          # 值导出入口
│   ├── type.ts           # 类型 re-export（types/）
│   ├── README.md         # Skill 系统详细文档
│   ├── types/            # 核心类型 + Zod Schema
│   ├── manager/          # Skill 管理器（编排核心）
│   ├── discovery/        # 文件扫描与解析
│   ├── runner/           # 执行引擎
│   ├── generator/        # AI Skill 生成
│   ├── recommendation/   # 推荐引擎
│   └── builtin/          # 内置 Skill 定义
│
└── plugin/              # Plugin 系统
    ├── index.ts          # 值导出入口
    ├── pluginSystem.ts    # 插件管理器（生命周期、依赖拓扑排序）
    ├── pluginLoader.ts    # 插件发现、加载与 manifest 校验
    ├── pluginSandbox.ts  # 沙箱越权拦截（路径白名单 + 权限白名单）
    └── pluginMarketplace.ts # 市场评估与安装计划
```

## 子模块说明

| 子模块    | 职责             | 主要导出                                                                                                                   |
| --------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `skill/`  | Skill 全生命周期 | `skillManager`, `discoverSkills`, `parseSkillFile`, `SkillRunner`, `generateSkillDraftWithAI`, `recommendSkillsForContext` |
| `plugin/` | Plugin 架构      | `PluginManager`, `PluginLoader`, `PluginSandbox`, `evaluateMarketplacePlugin`, `buildPluginInstallPlan`                    |

## 完整 API 导出

### Skill（通过 `@extension/skill` 或 `@extension/skill/type`）

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

### Plugin（通过 `@extension/plugin`）

```typescript
import {
  PluginManager,
  BasePlugin,
  createPluginManager,
  PluginLoader,
  createPluginLoader,
  PluginSandbox,
  createPluginSandbox,
  evaluateMarketplacePlugin,
  buildPluginInstallPlan,
  createPluginInstallLock,
  buildPluginMarketplaceCatalog,
  TRUSTED_PLUGIN_SOURCES,
} from "@extension/plugin";
```

## 与外部系统的交互

| 外部模块          | 交互方式                                                          | 说明                        |
| ----------------- | ----------------------------------------------------------------- | --------------------------- |
| `@ui`             | 导入 `skillManager`、`SkillDefinition`                            | UI 面板展示 Skill 列表      |
| `@conversation`   | 导入 `skillManager`、`resolveExplicitSkillReference`              | 对话循环中注入 Skill 上下文 |
| `@tool/skills`    | 导入 `recommendSkillsForContext`、`resolveExplicitSkillReference` | Skill 搜索工具              |
| `@commandPalette` | 导入 `@extension/skill`                                           | 命令面板中执行 Skill        |
| `@api`            | 导入 `completeLlm`                                                | generator 模块调用 LLM      |

## 边界与限制

1. **Skill 单例模式** — `skillManager` 是模块级全局单例，`init()` 只执行一次
2. **Plugin 系统仅架构就绪** — OS 级隔离（network/filesystem/memory）尚未实现，当前仅做加载前拦截
3. **YAML 解析器为简易实现** — 不支持锚点、多文档、复杂类型等 YAML 特性
4. **Plugin 签名校验为格式检查** — 当前仅验证签名文件存在且格式合理，非密码学验证
5. **Skill 内容硬编码** — 内置 Skill 的 prompt 以模板字符串形式写在代码中

## 测试覆盖

| 测试目录                      | 文件数 | 用例数  |
| ----------------------------- | ------ | ------- |
| `test/unit/extension/skill/`  | 6      | 104     |
| `test/unit/extension/plugin/` | 5      | 58      |
| **合计**                      | **11** | **162** |

## 待改进

- [P2] sync→async I/O 统一 — discovery/manager/generator 仍使用 `readFileSync`/`writeFileSync`
- [P2] Plugin 系统实际运行时集成 — 当前仅实现了加载前校验架构
