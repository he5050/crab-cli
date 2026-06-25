# Team 模块

团队成员协作管理系统，支持创建与管理子代理团队、分配任务、跟踪执行、合并代码工作区。

## 目录结构

```
src/team/
  types/         # 核心类型定义
    core.ts      #   Teammate, TeamTask, TeamConfig, TeamExecutionResult 等
    index.ts
  core/          # 核心服务
    teamExecutor.ts      #   TeamExecutor — 主执行器，管理队友生命周期与 LLM 循环
    teamTracker.ts       #   TeamTracker — 消息追踪、计划审批 Token 解析
    teamTaskList.ts      #   TeamTaskList — 任务列表维护
    teamActiveContext.ts #   活跃团队上下文
    teamConfig.ts        #   Team 配置加载
    index.ts
  mate/          # 队友管理
    teamMateSpawner.ts        #   队友生成
    teamMateLifecycle.ts      #   队友生命周期（启动/关闭）
    teamAgentPolicy.ts        #   队友代理策略
    teamExecutorHelpers.ts    #   合成工具定义与工具名称集合
    teamPromptBuilder.ts      #   队友系统提示词构建
    teamLeadActions.ts        #   Lead 动作（消息、任务、状态）
    index.ts
  execution/     # LLM 执行与工具调用
    teamLlmLoopAdapter.ts     #   LLM 循环适配器
    teamLoopMessages.ts       #   消息处理（追加、分割、审批阻塞）
    teamLoopCompression.ts    #   循环压缩
    teamRegularToolExecutor.ts #   常规工具执行
    teamSyntheticToolExecutor.ts # 合成工具执行
    teamStandbyHandler.ts      #   Standby 等待处理
    index.ts
  merge/         # 工作区与合并
    teamMergeManager.ts       #   合并管理器
    teamConflictFallback.ts   #   冲突回退处理
    teamWorktree.ts           #   Git 工作区管理、分支合并
    index.ts
  persist/       # 持久化
    storagePaths.ts           #   存储路径解析
    teamPersist.ts            #   团队/成员持久化
    teamSnapshot.ts           #   快照事件记录与回滚
    teamStateSnapshot.ts      #   运行时状态快照
    remoteWorkspace.ts        #   远程工作区管理
    index.ts
  index.ts       # 值导出入口（@team）
  type.ts        # 类型导出入口（@team/type）
  README.md
```

## 出入口约定

| 导入路径     | 内容         | 示例                                               |
| ------------ | ------------ | -------------------------------------------------- |
| `@team`      | 所有运行时值 | `import { TeamExecutor, createTeam } from "@team"` |
| `@team/type` | 所有类型     | `import type { Teammate } from "@team/type"`       |

子目录内部互引用统一使用相对路径，外部统一走 `@team` / `@team/type`。
