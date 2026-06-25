# 连接管理模块

管理多类型连接的生命周期和状态。支持 local / SSH / Docker / WSL 四种连接类型。

## 目录结构

```
src/connection/
├── index.ts               # 统一入口：导出所有类型 + 运行时值
├── type.ts                # 类型入口：仅导出类型定义
├── README.md
├── types/                 # 类型定义与辅助工具
│   └── index.ts           # ConnectionType, ConnectionConfig, Connection, 等
└── manager/               # 连接管理器运行时
    ├── index.ts           # 桶文件
    └── connectionManager.ts  # ConnectionManager 类 + 全局实例
```

## 导入方式

```typescript
// 同时需要类型和运行时值
import { connectionManager, ConnectionConfig } from "@connection";

// 只需要类型
import type { ConnectionConfig } from "@connection/type";
```

## 模块边界

- 负责管理连接生命周期（创建、连接、断开、删除）
- 不实现具体连接协议（SSH 等由底层模块实现）
- 连接配置持久化到 `~/.crab/connections.json`
- 连接状态保存在内存，重启后需重新连接
- 单例模式确保全局唯一 ConnectionManager 实例

## 关键类型

| 类型              | 说明                       |
| ----------------- | -------------------------- |
| ConnectionType    | local / ssh / docker / wsl |
| ConnectionConfig  | 完整连接配置               |
| Connection        | 连接运行时实例（含状态）   |
| ConnectionContext | 执行操作时的上下文         |
| ConnectionEvent   | 连接状态变更事件           |
| ConnectionFilter  | 查询连接时的过滤条件       |
