# Changelog

All notable changes to crab-cli will be documented in this file.

## [0.5.0] - 2026-06-25

### Added — OpenCode 对齐（P0-P3，33 项）

#### TUI 界面
- OpenTUI 原生 Diff 组件（split/unified/auto 视图 + 文件树导航 + 语法高亮）
- Shiki 代码高亮（9 种语法元素 + 30 个预置主题 + SIGUSR2 热重载）
- Prompt Extmarks 虚拟文本系统（文件/Agent/Skill/粘贴/URL 5 种类型）
- 智能粘贴处理（URL/文件路径/多行自动折叠为 Extmark）
- Shell 模式（`!` 前缀直接执行命令，不走 LLM）
- 编辑器集成（`/editor` 命令打开 $EDITOR 编辑 prompt）
- 终端挂起/恢复（Ctrl+Z suspend + `/fg` resume）
- 多模式键位栈（createCrabModeStack push/pop + Leader 键 + ESC/Backspace addon）
- 30 个预置主题 + dark/light 模式切换 + 模式锁定
- 动画系统（createFadeIn + bgPulse + animations_enabled 配置）
- 鼠标交互增强（选区复制 + 右键复制 + 滚动加速）
- 三态 Thinking 模式（show/hide/auto + Ctrl+Shift+T 循环切换）
- TUI 插件路由注册（createPluginRoutes + 自定义路由渲染）

#### LLM 与 Provider
- 5 个新 LLM Provider（OpenRouter/Azure/Bedrock/xAI/GitHub Copilot）+ 认证链
- LLM Route 抽象层（Route→Endpoint→Transport→Executor）
- 声明式重试策略（指数退避 + retry-after 头解析 + 5xx/429 重试）
- Token 精确计算（Decimal.js + context tier 定价 + 统一入口 `@/core/token`）
- LLM 缓存策略（ephemeral/persistent + shouldCache + buildCacheControl）
- WebSocket 传输支持（WebSocketTransportImpl + Transport 接口扩展）

#### 架构与数据流
- 声明式 HTTP API（Hono + zod-openapi + OpenAPI 自动生成 + Swagger UI）
- 数据库 PRAGMA 优化（synchronous=NORMAL + cache_size=64MB）
- 事件持久化（durable events 表 + seq + aggregateID + replayEvents）
- Part 粒度消息模型（parts 独立表 + 双写兼容 + getPartsByType）
- Effect Stream 流式处理（可选开关，6 模块迁移）
- 文件系统快照（git status/diff + diffSnapshots）
- 远程配置支持（URL 拉取 + 变量替换）

#### 功能模块
- MCP 资源访问工具（list_mcp_resources / read_mcp_resource）
- MCP Roots 协议支持（ListRootsRequestSchema + cwd root）
- MCP Catalog（22 个预置服务器 + `crab mcp search/install`）
- LLM Agent 生成（`crab agent generate` + generateObject + Zod schema）
- 会话 Revert 系统（revertToMessage + unrevert + Ctrl+Shift+R/U）
- 安装渠道显示（detectInstallationChannel + 版本输出 + 底部栏）
- Workspace 多工作区管理（配置 + 切换 + 侧边栏显示）

### Changed
- 版本号 0.1.0 → 0.5.0
- Token 计算统一为单一公用入口 `@/core/token`
- `~/.crab/` 目录重组：配置/数据/认证/日志分离 + 自动迁移
- CostUsage 类型合并为 TokenUsage 的 type alias
- tokenBudget.ts 移除重复 TokenUsage 定义

### Fixed
- MCP Roots capabilities 声明缺失（导致所有 MCP 服务器连接失败）
- SSH 连接无主机密钥验证（添加 hostVerifier）
- Drizzle ORM 实例 any 类型（替换为 DrizzleDb 类型）
- 257 个文件格式不合规
- 关键路径 as any 类型断言（toolExecutionCore/orchestrator/hooks/teamTools）
- 空 catch 块和静默吞错（10 处）
- chatExporter.ts 模板字符串语法错误
- p0Features.ts 多余闭合括号
- acpManager.ts 未使用 catch 变量
- toolRenderers.tsx 未闭合 import
- BlockTool.tsx 未闭合 import

### Removed
- tokenBudget.ts 中重复的 TokenUsage 类型定义
- p0Features.ts（合并到 quickCommands.ts）

## [0.1.0] - 2026-04-23

### Added
- 初始版本
- Multi-Agent 协作系统
- MCP 原生 Runtime
- TUI 终端界面
- Headless/SSE/ACP 服务模式
- 权限控制与安全体系
- 会话管理与检查点
- 上下文压缩
- Goal 持续驱动
