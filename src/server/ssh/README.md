# SSH Module — 远程连接与命令执行引擎

## 整体定位

SSH 模块是系统的远程连接与命令执行引擎，提供 SSH 连接池管理、远程命令执行、文件操作和远程工作空间管理能力。它与 Bash 工具（`@tool/bash`）和连接管理器（`@connection`）联动，支持通过 SSH 协议执行远程服务器操作。

## 核心功能

1. **连接池管理** — 管理 SSH 连接的生命周期，实现连接复用、自动清理空闲连接、最大连接数限制
2. **SSH 客户端** — 封装 SSH 连接和远程命令执行，提供 exec、readFile、writeFile、readdir 等操作
3. **远程工作空间** — 管理远程工作空间的配置创建、路径解析和连接验证
4. **工作空间管理器** — 远程工作空间的持久化 CRUD 操作（单例模式）
5. **命令安全** — 集中实现 CWE-78 缓解，包含 shell 元字符检查和危险命令 deny-list

## 目录结构

```
src/ssh/
├── index.ts              # 统一值导出入口（@ssh）
├── type.ts               # 统一类型导出入口（@ssh/type）
├── README.md             # 本文档
│
├── types/                # 类型定义
│   └── index.ts          # SSHConnectionConfig, SSHConnection, SSHExecOptions 等
│
├── client/               # SSH 客户端与连接池
│   ├── index.ts          # 统一导出
│   ├── client.ts         # SSH 客户端类（SSHClient, createSSHClient, shellQuote）
│   └── pool.ts           # 连接池管理（SSHConnectionPool, sshConnectionPool, SSHConnectionError）
│
├── workspace/            # 远程工作空间
│   ├── index.ts          # 统一导出
│   ├── workspace.ts      # RemoteWorkspace 类（配置、路径解析、验证）
│   └── manager.ts        # WorkspaceManager 单例（持久化 CRUD）
│
└── safety/               # 安全工具
    └── index.ts          # sanitizeSSHCommand, checkSSHDenylist, makeSSHCommandSafe
```

## 子模块说明

| 子模块       | 职责                | 主要导出                                                                                                       |
| ------------ | ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `types/`     | SSH 相关类型定义    | `SSHConnectionConfig`, `SSHConnection`, `SSHExecOptions`, `SSHExecResult`                                      |
| `client/`    | SSH 客户端 + 连接池 | `SSHClient`, `createSSHClient`, `SSHConnectionPool`, `sshConnectionPool`, `SSHConnectionError`                 |
| `workspace/` | 远程工作空间        | `RemoteWorkspaceConfig`, `RemoteWorkspace`, `createRemoteWorkspace`, `WorkspaceManager`, `getWorkspaceManager` |
| `safety/`    | 命令安全工具        | `sanitizeSSHCommand`, `checkSSHDenylist`, `makeSSHCommandSafe`                                                 |

## 入口规范

- **值/类入口**：`@ssh` — 所有运行时值、类、工厂函数
- **类型入口**：`@ssh/type` — 所有 TypeScript 类型

```typescript
// 引用值/类
import { SSHClient, sshConnectionPool, WorkspaceManager } from "@ssh";

// 引用类型
import type { SSHConnectionConfig, SSHExecResult } from "@ssh/type";
```

## 完整 API 导出

### 类型导出（@ssh/type）

```typescript
import type {
  SSHConnectionConfig, // SSH 连接配置
  SSHConnection, // SSH 连接对象
  SSHConnectionPoolStats, // 连接池统计
  RemoteWorkspace, // 远程工作空间接口
  SSHExecOptions, // 命令执行选项
  SSHExecResult, // 命令执行结果
  SSHExecContext, // 命令执行上下文
  RemoteWorkspaceConfig, // 远程工作空间配置
} from "@ssh/type";
```

### 值导出（@ssh）

```typescript
import {
  // ─── SSH 客户端 ────────────────────────────────────────
  SSHClient, // SSH 客户端类
  createSSHClient, // 创建并连接 SSH 客户端
  shellQuote, // Shell 安全引用

  // ─── 连接池 ────────────────────────────────────────────
  SSHConnectionPool, // 连接池类
  sshConnectionPool, // 全局连接池实例
  SSHConnectionError, // 连接错误类

  // ─── 远程工作空间 ──────────────────────────────────────
  RemoteWorkspace, // 远程工作空间类
  createRemoteWorkspace, // 创建远程工作空间
  WorkspaceManager, // 工作空间管理器
  getWorkspaceManager, // 获取管理器单例

  // ─── 安全工具 ──────────────────────────────────────────
  sanitizeSSHCommand, // 拒绝含 shell 元字符的命令
  checkSSHDenylist, // 检查危险命令模式
  makeSSHCommandSafe, // 组合安全检查
} from "@ssh";
```

## 使用方法

### SSH 连接和命令执行

```typescript
import { SSHClient, createSSHClient } from "@ssh";
import type { SSHConnectionConfig } from "@ssh/type";

const config: SSHConnectionConfig = {
  host: "192.168.1.100",
  username: "deploy",
  privateKey: "~/.ssh/id_rsa",
};

// 方式一：两步创建
const client = new SSHClient(config);
await client.connect();
const result = await client.exec("ls -la /tmp");
console.log(result.stdout);
await client.disconnect();

// 方式二：便捷函数
const client2 = await createSSHClient(config);
const output = await client2.readFile("/etc/hostname");
await client2.disconnect();
```

### 连接池使用

```typescript
import { sshConnectionPool } from "@ssh";

// 自动复用或创建连接
const conn = await sshConnectionPool.getConnection(config);

// 获取连接池统计
const stats = sshConnectionPool.getStats();
// → { total: 3, active: 2, idle: 1 }

// 关闭所有连接（应用退出时）
await sshConnectionPool.closeAll();
```

### 远程工作空间管理

```typescript
import { WorkspaceManager, RemoteWorkspace } from "@ssh";
import type { RemoteWorkspaceConfig } from "@ssh/type";

const mgr = WorkspaceManager.getInstance();
await mgr.init();

const config: RemoteWorkspaceConfig = {
  id: "prod-server",
  name: "生产服务器",
  connection: { host: "prod.example.com", username: "admin" },
  remotePath: "/var/www/app",
};

await mgr.addWorkspace(config);

// 获取并验证
const ws = mgr.getWorkspace("prod-server");
const absPath = ws.resolvePath("./logs/app.log");
// → "/var/www/app/logs/app.log"

const { valid, error } = await ws.validate();
```

## 与外部系统的交互

| 外部模块                | 交互方式     | 说明                                                                |
| ----------------------- | ------------ | ------------------------------------------------------------------- |
| `@tool/bash`            | 安全检查复用 | Bash 工具通过 `@ssh` 使用 `checkSSHDenylist` / `sanitizeSSHCommand` |
| `@connection`           | 动态导入     | 连接管理器通过 `@ssh` 使用 `sshConnectionPool.getConnection()`      |
| `@core/logger`          | 日志记录     | 所有 SSH 操作的日志输出                                             |
| `@core/errors/appError` | 错误创建     | 安全检查时抛出结构化错误                                            |
| `@config`               | 配置获取     | 工作空间管理器获取配置目录路径                                      |

## 边界与限制

1. **依赖 node-ssh / ssh2** — 底层 SSH 协议依赖 `ssh2` 库（懒加载）
2. **连接池最大 10 个连接** — 超出上限时驱逐最老的空闲连接
3. **空闲连接 5 分钟自动清理** — 由每分钟运行的清理定时器执行
4. **仅支持基于密钥的认证** — 密码认证通过但不推荐用于生产
5. **安全检查不可绕过** — 除非显式传入 `dangerousAllow: true`
6. **工作空间管理器必须 init()** — 使用 CRUD 前需先调用 `init()` 加载持久化数据
7. **单例模式** — `WorkspaceManager` 和 `SSHConnectionPool` 均为单例
