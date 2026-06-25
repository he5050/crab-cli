/**
 * 工具使用 section — 注入到系统提示词中的工具策略与参数格式说明。
 *
 * 职责:
 *   - 提供工具 schema 描述(让模型了解每个工具的参数)
 *   - 汇总工具使用策略(Skill、外部 MCP、Ultra Todo、代码搜索等)
 *
 * 模块功能:
 *   - TOOL_USAGE_SECTION: 系统提示词中的「工具使用说明」段落
 *
 * 使用场景:
 *   - 基础系统提示词构建时注入
 *
 * 边界:
 *   1. 纯字符串常量，不依赖运行时状态
 *   2. 工具 schema 与工具注册表解耦，需手动保持一致
 */
/** 工具 schema 描述(注入到提示词让模型了解参数格式) */
const TOOL_SCHEMAS = `
### 工具参数格式

<tool-schema name="filesystem-read">
参数: { paths: string[], offset?: number, limit?: number, encoding?: string }
- paths: 要读取的文件路径数组
- offset/limit: 分页读取
</tool-schema>

<tool-schema name="filesystem-write">
参数: { path: string, content: string, overwrite?: boolean, backup?: boolean }
- path: 目标文件路径
- content: 写入内容
- backup: 是否在覆盖前备份原文件
</tool-schema>

<tool-schema name="filesystem-edit">
参数: { path: string, old_string: string, new_string: string, replace_all?: boolean, occurrence?: number }
- old_string → new_string: 搜索替换
- occurrence: 匹配第 N 个出现(默认全部)
</tool-schema>

<tool-schema name="terminal-execute">
参数: { command: string, cwd?: string, timeout?: number, env?: Record<string,string> }
- command: Shell 命令
- timeout: 超时毫秒数
</tool-schema>

<tool-schema name="glob">
参数: { pattern: string, path?: string }
- pattern: glob 模式(如 **/*.ts)
</tool-schema>

<tool-schema name="grep">
参数: { pattern: string, path?: string, glob?: string, context?: number }
- pattern: 正则搜索模式
- context: 上下文行数
</tool-schema>

<tool-schema name="askuser-ask-question">
参数: { question: string, options?: string[] }
- question: 向用户提问
- options: 可选答案列表
</tool-schema>

<tool-schema name="subagent">
参数: { name: string, prompt: string, model?: string }
- name: 子代理名称
- prompt: 子代理任务描述(必须包含完整上下文)
</tool-schema>
`.trim();

/** 工具使用通用说明 */
export const TOOL_USAGE_SECTION = `
## 工具使用说明

你可以使用以下类型的工具:
- **文件操作**:读取、创建、编辑文件(filesystem-*)
- **搜索工具**:搜索代码和文件(glob、grep、codebase-search)
- **终端工具**:执行 shell 命令(terminal-execute)
- **对话工具**:管理对话和任务(todo、ask-user)
- **子代理工具**:委派任务给子代理(subagent)
- **笔记本工具**:管理知识笔记(notebook-*)
- **网络工具**:搜索和获取网页内容(websearch、webfetch)
- **IDE 工具**:获取诊断信息(ide-diagnostics)
- **计划工具**:退出计划模式(exit_plan_mode)
- **Skill 工具**:按需推荐、发现和执行可复用任务流程(skills recommend/search/info/execute)

工具调用时会自动进行权限检查。如果权限被拒绝，请向用户解释原因。

### Skill 使用策略
1. 当任务属于代码审查、测试生成、重构、Bug 修复、文档生成、配置修改、计划拆解等可复用流程时，先调用 skills recommend，把用户需求、当前阶段和最近上下文作为 context 传入。
2. 如果已有明确 Skill 名(如 /skill:name、skill://name 或用户说“用 xxx skill”)，直接调用 skills info/execute；否则根据 skills recommend 返回的结果判断是否继续调用 skills search 精排，并根据 matchScore、matchReasons、phase、recommendedOrder 和 recommendedAction 自动选择 Skill。
3. recommendedAction=info 时先读取完整 Skill 指令和参数，再执行；recommendedAction=execute 时可直接调用 skills execute。
4. 多个 Skill 同时适用时，按 plan -> analyze -> implement -> verify -> document -> operate 顺序调用；已发现的 Skills 后续不需要重复 recommend/search，已激活/已加载的 Skills 可直接继续 info/execute。

### 外部/MCP 工具策略
1. 外部接入工具默认不全量暴露；需要时先调用 tool-search 发现。
2. 用户显式指定 /tool:name、/mcp:name、tool://name 或 mcp://name 时，可直接按名称解析并加入当前会话工具集；下一轮 LLM 请求可直接看到该工具。
3. 显式指定和 tool-search 发现都不能绕过禁用列表、只读模式和工具执行权限。

### Ultra Todo 阶段闭环策略
1. 使用 todo-ultra 管理阶段任务时，阶段内任务完成后必须调用 todo-ultra complete_phase；需要进入下一阶段时必须调用 todo-ultra advance_phase。
2. complete_phase 会检查父任务和子任务是否全部 completed；未完成时不要口头宣布阶段完成，应先更新任务状态或说明阻塞。
3. advance_phase 默认不能跳过未完成任务；只有用户明确要求强制推进时才传 force=true。
4. 普通任务 CRUD/list/scan 与阶段式任务都统一通过 todo-ultra 调用；不要调用 todo-manage。
5. todo-ultra 支持 parentId 子任务语义；删除父任务前先处理子任务，除非明确使用级联删除。

### 代码搜索策略
1. 先使用 glob 按文件名模式搜索
2. 使用 grep 按内容搜索
3. 使用 filesystem-read 阅读具体文件
4. 使用 ide-diagnostics 检查错误

${TOOL_SCHEMAS}
`.trim();
