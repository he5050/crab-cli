# Crab CLI

[English](README.md) | 简体中文

> AI 编程助手 — 多代理协作 + MCP 原生运行时 + TUI 终端智能编程助手

基于 `Bun + TypeScript + OpenTUI/Solid` 构建，支持多模型、多代理并行协作、MCP 原生集成。

## 核心特性

- **多代理协作** — 模型自主决策子代理数量，Git Worktree 隔离 + 合并冲突解决 + 计划审批
- **MCP 原生运行时** — 完整 MCP 客户端 + 22 个预置目录 + Roots 协议 + OAuth + 风险分类
- **终端原生 TUI** — 键盘驱动，OpenTUI/Solid 渲染，30+ 预置主题，Shiki 代码高亮
- **安全权限体系** — 敏感命令检测 + 审计日志 + 重放防护 + SSH 验证 + 命令注入检测
- **灵活配置** — 自带模型（BYOM），多配置档案，热重载，远程配置，多工作区
- **性能监控** — LRU 缓存 + 令牌桶限流 + 背压处理 + CPU/内存监控 + 熔断器 + 降级探测

## 安装

```bash
# 方式 1: 一键安装脚本（自动下载预编译二进制，回退源码构建）
curl -fsSL https://raw.githubusercontent.com/crab-cli/crab-cli/main/scripts/install.sh | bash

# 方式 2: Homebrew 安装
brew tap crab-cli/tap
brew install crab

# 方式 3: npm 全局安装
npm install -g crab-cli

# 方式 4: 从源码构建
git clone https://github.com/crab-cli/crab-cli.git
cd crab-cli
bun install
bun run build
```

### 预编译二进制

从 [GitHub Releases](https://github.com/crab-cli/crab-cli/releases) 下载对应平台的预编译二进制：

| 平台 | 文件 |
|------|------|
| macOS (Apple Silicon) | `crab-darwin-arm64.tar.gz` |
| macOS (Intel) | `crab-darwin-x64.tar.gz` |
| Linux (x64) | `crab-linux-x64.tar.gz` |

```bash
# 下载并解压
tar -xzf crab-darwin-arm64.tar.gz
chmod +x crab
sudo mv crab /usr/local/bin/
```

## 首次配置

```bash
# 交互式配置向导
crab setup

# 或手动创建 ~/.crab/config.json
```

最小配置示例：

```json
{
  "profile": "default",
  "defaultProvider": {
    "provider": "openai",
    "model": "gpt-4o"
  },
  "providerConfig": {
    "openai": {
      "defaultModel": "gpt-4o",
      "apiKey": "你的-API-密钥",
      "requestMethod": "chat",
      "baseURL": "https://api.openai.com/v1",
      "modelList": ["gpt-4o"]
    }
  }
}
```

## 常用命令

```bash
crab                                    # 启动 TUI 界面
crab --ask "你的问题"                     # 无头模式直接提问
crab --task "任务描述"                    # 执行后台任务
crab --sse                              # 启动 SSE 服务器
crab --acp                              # 启动 ACP 协议服务
crab setup                              # 交互式配置向导
crab update                             # 一键自动更新
crab mcp search "数据库"                 # 搜索 MCP 服务器目录
crab mcp install postgres               # 安装 MCP 服务器
crab agent generate "代码审查专家"         # AI 生成 Agent 配置
crab --schedule "0 9 * * *" "任务"       # 创建定时任务
crab --yolo --ask "修复构建错误"           # YOLO 模式（跳过确认）
crab --continue <session-id>            # 继续上次会话
```

## 支持的 LLM 提供商

| 提供商 | 认证方式 | 说明 |
|--------|---------|------|
| OpenAI | API 密钥 | GPT 系列 |
| Anthropic | API 密钥 | Claude 系列 |
| Google | API 密钥 | Gemini 系列 |
| Azure OpenAI | API 密钥 | Azure 部署 |
| AWS Bedrock | SigV4 签名 | 多模型 |
| OpenRouter | API 密钥 | 统一 API |
| xAI | API 密钥 | Grok 系列 |
| GitHub Copilot | OAuth | Copilot 模型 |
| 自定义 | API 密钥 | OpenAI 兼容接口 |

## TUI 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Enter` | 发送消息 |
| `Ctrl+P` | 命令面板 |
| `Ctrl+X` | Leader 键（快捷入口） |
| `Ctrl+Z` | 终端挂起/恢复 |
| `Ctrl+Shift+R` | 撤销上一轮 |
| `Ctrl+Shift+U` | 恢复撤销 |
| `Ctrl+Shift+T` | 切换思考模式 |
| `ESC` | 中断/清除 |
| `/` | 斜杠命令 |
| `@` | 文件/代理/技能引用 |
| `!` | Shell 模式前缀 |

## 目录结构

```
~/.crab/
├── config.json              # 全局配置
├── mcp.json                 # MCP 服务器配置
├── roles.json               # 角色定义
├── auth/                    # 认证数据
├── data/                    # 运行时数据（数据库/会话/任务）
├── logs/                    # 日志 + 审计
├── skills/                  # 技能文件
├── hooks/                   # Hook 配置
├── themes/                  # 自定义主题
├── agents/                  # 生成的代理定义
└── tmp/                     # 临时文件
```

## 构建和测试

```bash
bun run build                # 构建 CLI
bun run test:isolated        # 运行隔离测试
bun run lint                 # 代码检查
bun run format               # 代码格式化
bun run security:check       # 安全扫描
```

## 技术栈

- **运行时**: Bun
- **语言**: TypeScript
- **TUI 框架**: OpenTUI/Solid (SolidJS)
- **ORM**: Drizzle ORM + SQLite
- **LLM SDK**: Vercel AI SDK
- **HTTP API**: Hono + zod-openapi
- **流式处理**: Effect Stream（可选）+ AsyncIterable
- **可观测性**: OpenTelemetry + Prometheus

## 开源协议

MIT
