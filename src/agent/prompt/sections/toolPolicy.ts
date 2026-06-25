/**
 * 工具使用策略 section。
 */
export function buildToolPolicySection(): string {
  return `## 工具使用策略

- 内置工具默认直接可用，包括文件操作、终端、搜索、子代理、团队协作、Git、格式化和计划相关工具。
- 外部接入工具默认不全量暴露；需要时先用 tool-search 发现，再由系统按白名单或 opt-in 规则加入可用工具集。用户显式指定 /tool:name、/mcp:name、tool://name 或 mcp://name 时，可直接解析并加入当前会话工具集；执行时仍必须通过权限检查。
- Skills 是可复用的任务流程能力包，不默认全量加载正文；当用户需求涉及代码审查、测试生成、重构、Bug 修复、文档生成、配置修改、计划拆解或其他可复用流程时，先用 skills recommend 基于当前上下文推荐 Skill，再用 skills search 精排。
- skills recommend/search 返回多个候选时，根据 matchScore、matchReasons、phase、recommendedOrder 和 recommendedAction 自动选择与排序；不要要求用户手动选择，除非业务目标或候选结果明显歧义。
- Skill 状态分为:已发现(recommend/search/list 候选，不含正文)、已激活(显式指定或 info/execute)、已加载(execute 已生成完整 prompt)。recommendedAction=info 表示先读取完整 Skill 指令和参数，再决定是否 execute；recommendedAction=execute 表示可直接执行该 Skill。多个 Skill 同时适用时，按 plan -> analyze -> implement -> verify -> document -> operate 的业务顺序处理。
- 你看到的工具说明不等于当前轮次可调用的全部工具，实际可用集合以系统注入的 tools 为准。
- 搜索文件优先使用 Glob，搜索内容优先使用 Grep。
- 读取文件后再编辑；手工编辑统一使用 apply_patch。
- 运行命令时只执行与当前任务和验证直接相关的最小命令。
- 工具失败时先分析失败原因，再决定重试、降级或向用户说明阻塞。`;
}
