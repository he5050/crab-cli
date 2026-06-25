# Plugin 系统

## 整体定位

Plugin 子系统提供外部插件的发现、加载、沙箱校验与市场评估能力。当前处于**架构就绪**阶段，已实现完整的加载前安全拦截链，但尚未集成到主应用运行时。

## 架构层次

```
PluginInterface    ← 插件必须实现的接口（load/unload/getMetadata）
    ↑
 BasePlugin      ← 基础插件类，提供通用生命周期实现
    ↑
PluginManager   ← 插件管理器（注册/加载/卸载/依赖拓扑排序）
    ↑           ↘
PluginLoader    ← 插件发现器（目录扫描/package.json 解析/manifest 校验）
PluginSandbox   ← 沙箱校验器（路径白名单/权限白名单）
PluginMarketplace ← 市场评估器（可信源/安装计划/安装锁）
```

## 核心流程

```
扫描插件目录
  → 读取 package.json（PluginManifest 校验：字段白名单 + 长度限制）
  → 验证插件类型、来源白名单、入口文件存在
  → 签名校验（可选，仅格式检查）
  → 动态 import 入口模块
  → 注册到 PluginManager
  → 沙箱 assertCanLoad（路径 + 权限）
  → 依赖检查 → 冲突检查
  → Promise.race(load, timeout)
```

## 文件说明

| 文件                   | 职责                                          | 行数 |
| ---------------------- | --------------------------------------------- | ---- |
| `pluginSystem.ts`      | PluginInterface/BasePlugin/PluginManager 定义 | ~472 |
| `pluginLoader.ts`      | 插件发现 + manifest 校验 + 动态加载 + 缓存    | ~524 |
| `pluginSandbox.ts`     | 路径/权限白名单越权拦截                       | ~100 |
| `pluginMarketplace.ts` | 可信源验证/安装计划/安装锁/市场目录构建       | ~216 |

## 沙箱策略

当前仅实现**加载前拦截**（pre-load interception），不做 OS 级隔离：

| 维度         | 当前状态  | 计划                       |
| ------------ | --------- | -------------------------- |
| 路径白名单   | ✅ 已实现 | -                          |
| 权限白名单   | ✅ 已实现 | -                          |
| 网络隔离     | ⏳ 仅声明 | 后续阶段（seccomp/cgroup） |
| 文件系统隔离 | ⏳ 仅声明 | 后续阶段                   |
| 内存限制     | ⏳ 仅声明 | 后续阶段                   |
| CPU 时间限制 | ⏳ 仅声明 | 后续阶段                   |

## 测试覆盖

| 测试文件                    | 用例数 | 覆盖范围                                           |
| --------------------------- | ------ | -------------------------------------------------- |
| `pluginSandbox.test.ts`     | 20     | 路径/权限白名单 + PluginManager/PluginLoader 校验  |
| `pluginMarketplace.test.ts` | 13     | PluginManager 生命周期 + marketplace 纯逻辑        |
| `pluginSystem.test.ts`      | 10     | PluginManager 生命周期（注册/加载/卸载/依赖/冲突） |
| `sourceValidation.test.ts`  | 7      | 插件来源白名单验证                                 |
| `pluginLoader.test.ts`      | 8      | marketplace 纯函数测试                             |
| **合计**                    | **58** | -                                                  |

## 已知限制

1. `PluginManifestValidationError` 不在 `index.ts` 导出中（仅内部使用）
2. 签名验证仅检查格式合理性（base64/hex 字符串，≥16 字符），非密码学校验
3. `PluginLoader.cache` 为进程内 Map，不支持跨进程缓存失效
4. `PluginManager.loadAll` 中单个插件加载失败不阻止其他插件
