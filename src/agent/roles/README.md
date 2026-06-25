# Roles Module — Markdown 角色文件管理系统

## 整体定位

Roles 模块是系统的角色文件管理引擎，负责管理 Markdown 格式的角色定义文件（`ROLE.md` / `ROLE-<hash>.md`）。它支持全局（`~/.crab/`）和项目级（`./.crab/`）两种作用域，提供角色的 CRUD、切换、Override 模式以及子代理角色绑定功能。

角色文件允许用户自定义 AI 助手的身份定位、工作原则、技术能力和交互风格，在系统提示词构建时注入，实现个性化的 Agent 行为定制。

## 核心功能

1. **角色文件管理** — 支持 `ROLE.md`（活跃角色）和 `ROLE-<hash>.md`（非活跃角色）的创建、读取、删除
2. **双作用域** — 全局作用域（`~/.crab/`）和项目作用域（`./.crab/`），项目级优先于全局级
3. **角色切换** — 通过 `settings.json` 持久化活跃角色 ID，支持多角色切换
4. **Override 模式** — 角色内容替换基础身份提示，保留模式、工具、环境等运行时提示段
5. **子代理角色绑定** — 支持 `ROLE-<agentName>.md` 为特定子代理定制专属角色
6. **默认角色初始化** — 首次运行时自动创建预设的默认角色文件

## 目录结构

```
src/roles/
├── index.ts                  # 统一出入口，所有外部引用通过此文件
├── README.md                 # 本文档
│
├── defaultRoleContent.ts     # 默认角色文件内容（预设模板）
├── roleManager.ts            # 角色文件管理（CRUD、切换、Override）
├── roleInjector.ts           # 角色提示词注入（获取活跃角色内容）
└── roleSubagent.ts           # 子代理角色绑定（ROLE-<agentName>.md）
```

## 子模块说明

| 子模块                  | 职责                            | 主要导出                                                                                                                                                                                     |
| ----------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `defaultRoleContent.ts` | 默认角色模板                    | `DEFAULT_ROLE_CONTENT`                                                                                                                                                                       |
| `roleManager.ts`        | 角色文件 CRUD + 切换 + Override | `RoleLocation`, `RoleItem`, `getRoleFilePath()`, `listRoles()`, `createRoleFile()`, `deleteRole()`, `readRoleContent()`, `switchActiveRole()`, `toggleRoleOverride()`, `ensureDefaultRole()` |
| `roleInjector.ts`       | 提示词注入                      | `RoleInjectionResult`, `getActiveRoleContent()`, `hasOverrideRole()`, `hasActiveOverrideRole()`                                                                                              |
| `roleSubagent.ts`       | 子代理角色绑定                  | `loadSubAgentCustomRole()`, `listAvailableSubAgentRoles()`                                                                                                                                   |

## 完整 API 导出

### 类型导出

```typescript
import type {
  // 角色作用域
  RoleLocation, // "global" | "project"

  // 角色列表项
  RoleItem, // 角色文件元信息（id, name, filename, isActive, isOverride, location, path）

  // 注入结果
  RoleInjectionResult, // 角色注入结果（content, isOverride）
} from "@roles";
```

### 值导出

```typescript
import {
  // ─── 路径工具 ──────────────────────────────────────────
  getRoleFilePath, // 获取角色文件路径
  getRoleDirectory, // 获取角色文件所在目录

  // ─── 文件存在性 ────────────────────────────────────────
  checkRoleExists, // 检查角色文件是否存在

  // ─── 文件创建 ──────────────────────────────────────────
  createRoleFile, // 创建 ROLE.md
  createInactiveRole, // 创建 ROLE-<hash>.md

  // ─── 文件删除 ──────────────────────────────────────────
  deleteRoleFile, // 删除 ROLE.md
  deleteRole, // 删除指定角色（非活跃）

  // ─── 文件读取 ──────────────────────────────────────────
  readRoleContent, // 读取角色文件内容
  readActiveRoleContent, // 读取活跃角色内容

  // ─── 角色列表 ──────────────────────────────────────────
  listRoles, // 列出指定位置的所有角色
  listAllRoles, // 列出所有位置的角色（合并全局和项目）

  // ─── 角色切换 ──────────────────────────────────────────
  switchActiveRole, // 切换活跃角色

  // ─── Override 模式 ─────────────────────────────────────
  toggleRoleOverride, // 切换角色的 Override 标记

  // ─── 默认角色 ──────────────────────────────────────────
  ensureDefaultRole, // 确保全局默认角色文件存在

  // ─── 子代理角色 ────────────────────────────────────────
  loadSubAgentCustomRole, // 加载子代理专属角色
  listAvailableSubAgentRoles, // 列出所有可用的子代理角色

  // ─── 提示词注入 ────────────────────────────────────────
  getActiveRoleContent, // 获取当前活跃角色内容（项目级 > 全局级）
  hasOverrideRole, // 判断指定位置是否有 Override 角色
  hasActiveOverrideRole, // 判断当前是否有 Override 角色生效
} from "@roles";
```

## 使用方法

### 角色文件管理

```typescript
import { createRoleFile, listRoles, switchActiveRole, readActiveRoleContent, deleteRole } from "@roles";

// 创建全局角色文件
await createRoleFile("global");

// 列出所有角色
const roles = listRoles("global");
console.log(roles);
// → [{ id: "active", name: "Active Role", filename: "ROLE.md", isActive: true, ... }]

// 创建非活跃角色
const result = await createInactiveRole("global");
// → { success: true, path: "~/.crab/ROLE-abc123.md" }

// 切换活跃角色
await switchActiveRole("abc123", "global");

// 读取活跃角色内容
const content = readActiveRoleContent("global");

// 删除非活跃角色
await deleteRole("abc123", "global");
```

### Override 模式

```typescript
import { toggleRoleOverride, hasActiveOverrideRole } from "@roles";

// 切换当前角色的 Override 标记
const result = await toggleRoleOverride("active", "global");
// → { success: true, isOverride: true }

// 检查是否有 Override 角色生效
if (hasActiveOverrideRole()) {
  // 角色内容将替换基础身份提示，保留模式、工具、环境等运行时提示段
}
```

### 子代理角色绑定

```typescript
import { loadSubAgentCustomRole, listAvailableSubAgentRoles } from "@roles";

// 加载 explore 子代理的专属角色
const exploreRole = loadSubAgentCustomRole("explore", projectRoot);

// 列出所有可用的子代理角色
const agents = listAvailableSubAgentRoles(projectRoot);
// → ["explore", "general", "security"]
```

### 提示词注入

```typescript
import { getActiveRoleContent } from "@roles";

// 获取当前活跃角色内容（自动处理项目级 > 全局级优先级）
const { content, isOverride } = getActiveRoleContent(projectRoot);

if (content) {
  // 将角色内容注入到系统提示词中
  // 如果 isOverride 为 true，角色内容替换基础身份提示
}
```

### 默认角色初始化

```typescript
import { ensureDefaultRole } from "@roles";

// 在应用启动时确保全局默认角色文件存在
await ensureDefaultRole();
// 如果 ~/.crab/ROLE.md 不存在，会使用预设内容创建
```

## 角色文件命名规范

| 文件名                | 用途       | 说明                                               |
| --------------------- | ---------- | -------------------------------------------------- |
| `ROLE.md`             | 活跃角色   | 当前生效的角色文件，每个作用域只能有一个           |
| `ROLE-<hash>.md`      | 非活跃角色 | 备用角色文件，通过切换激活                         |
| `ROLE-<agentName>.md` | 子代理角色 | 为特定子代理定制的专属角色（如 `ROLE-explore.md`） |

## 作用域优先级

| 场景           | 优先级             |
| -------------- | ------------------ |
| 活跃角色查找   | 项目级 > 全局级    |
| 子代理角色查找 | 项目级 > 全局级    |
| 角色列表展示   | 先项目级，后全局级 |

## 与外部系统的交互

| 外部模块           | 交互方式                        | 说明                               |
| ------------------ | ------------------------------- | ---------------------------------- |
| `@prompt/builder`  | 调用 `getActiveRoleContent()`   | 在构建系统提示词时注入角色内容     |
| `@config/settings` | 读写 `settings.json`            | 持久化活跃角色 ID 和 Override 标记 |
| `@agent/core`      | 调用 `loadSubAgentCustomRole()` | 为子代理加载专属角色               |
| `@ui/components`   | 调用角色管理 API                | 角色选择器、角色管理界面           |

## 边界与限制

1. **活跃角色只能有一个** — 每个作用域（global/project）的活跃角色由 `settings.json` 中的 `activeRoleId` 决定
2. **只能删除非活跃角色** — 活跃角色（`ROLE.md`）不能直接删除，需先切换到其他角色
3. **Override 仅对活跃角色有效** — 只有活跃角色可以标记为 Override 模式
4. **角色内容为空视为无角色** — 如果角色文件内容为空或只包含空白字符，视为无角色
5. **子代理角色独立于活跃角色** — 子代理角色绑定不影响主 Agent 的活跃角色
6. **文件名格式严格校验** — 角色文件名必须符合 `ROLE.md` 或 `ROLE-<hash>.md` 格式

## 设计决策

| 决策           | 原因                                                          |
| -------------- | ------------------------------------------------------------- |
| 双作用域设计   | 支持全局通用角色和项目特定角色，满足不同场景需求              |
| 项目级优先     | 项目级角色更贴近具体业务场景，优先级应高于全局                |
| Override 模式  | 允许用户完全自定义基础身份，同时保留模式、工具等运行时提示段  |
| 子代理角色独立 | 不同子代理可能需要不同的角色定位（如 explore 需要探索者角色） |
| 默认角色预设   | 降低新用户上手门槛，提供开箱即用的基础角色                    |

## 故障排查

| 现象                | 可能原因                 | 排查步骤                                   |
| ------------------- | ------------------------ | ------------------------------------------ |
| 角色文件未创建      | 目录权限不足             | 检查 `~/.crab/` 或 `./.crab/` 目录是否可写 |
| 切换角色无效        | `settings.json` 写入失败 | 检查配置文件路径和权限                     |
| 子代理角色未加载    | 文件名不匹配             | 确认文件名为 `ROLE-<agentName>.md` 格式    |
| Override 模式未生效 | 角色未标记为 Override    | 调用 `toggleRoleOverride()` 确认标记成功   |
| 默认角色未初始化    | 首次运行失败             | 手动调用 `ensureDefaultRole()` 检查错误    |
