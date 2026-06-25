/**
 * 内置 Skill 定义
 *
 * 职责:
 *   - 定义随 crab-cli 发布的默认 Skill 集合
 *   - 提供常用的代码辅助 Skill
 *   - 作为 Skill 系统的默认能力基线
 *
 * 模块功能:
 *   - explain-code: 解释代码工作原理
 *   - review-code: 代码审查
 *   - write-test: 编写单元测试
 *   - refactor: 重构代码
 *   - generate-docs: 生成文档
 *   - fix-bug: 修复 Bug 流程
 *   - customize-crab: 编辑 crab-cli 配置文件
 *
 * 使用场景:
 *   - 用户需要解释代码时调用 explain-code
 *   - 代码审查时调用 review-code
 *   - 需要测试时调用 write-test
 *   - 重构代码时调用 refactor
 *   - 生成文档时调用 generate-docs
 *   - 修复 Bug 时调用 fix-bug
 *   - 编辑配置时调用 customize-crab
 *
 * 边界:
 *   1. 内置 Skill 优先级低于磁盘上的同名 Skill
 *   2. Skill 内容以字符串形式硬编码
 *   3. 位置标记为 "<builtin>" 以区分文件 Skill
 *   4. 部分 Skill 支持参数，部分为固定提示词
 *   5. 可通过 trigger 字段匹配特定输入
 *
 * 流程:
 *   1. 定义 SkillDefinition 数组
 *   2. 为每个 Skill 设置名称、描述、分类
 *   3. 编写 Skill 的 prompt 内容
 *   4. 配置可选的参数定义
 *   5. 导出供 SkillManager 加载
 */
import type { SkillDefinition } from "../types";

export const builtinSkills: SkillDefinition[] = [
  {
    category: "代码",
    content: `请详细解释以下代码的工作原理。分析要点:

1. 整体功能和目的
2. 关键逻辑和算法
3. 使用的设计模式
4. 数据流和控制流
5. 依赖关系和接口

请用清晰易懂的语言解释，对复杂部分给出示例。`,
    description: "解释代码的工作原理",
    location: "<builtin>",
    name: "explain-code",
    parameters: [{ description: "要解释的代码", name: "code", required: true, type: "string" }],
    source: "builtin",
  },
  {
    category: "代码",
    content: `请对以下代码进行全面审查。关注以下方面:

1. **潜在 Bug**:逻辑错误、边界条件、空指针
2. **性能问题**:时间/空间复杂度、不必要的计算
3. **安全风险**:注入攻击、权限问题、敏感数据泄露
4. **代码风格**:命名规范、一致性、可读性
5. **可维护性**:模块化、扩展性、文档完整性

请给出具体的改进建议和修改示例。`,
    description: "代码审查",
    location: "<builtin>",
    name: "review-code",
    parameters: [{ description: "要审查的代码", name: "code", required: true, type: "string" }],
    source: "builtin",
  },
  {
    category: "测试",
    content: `请为以下代码编写全面的单元测试。要求:

1. 使用项目已有的测试框架(优先 bun:test)
2. 覆盖正常路径(happy path)
3. 覆盖边界情况(空输入、极大/极小值、null/undefined)
4. 覆盖错误处理(异常、错误返回值)
5. 每个测试用例有清晰的描述
6. 使用 describe/test 分组

请直接输出可运行的测试代码。`,
    description: "编写单元测试",
    location: "<builtin>",
    name: "write-test",
    parameters: [{ description: "要测试的代码", name: "code", required: true, type: "string" }],
    source: "builtin",
  },
  {
    category: "代码",
    content: `请重构以下代码。重构目标:

1. 提高可读性(清晰的命名、合理的结构)
2. 减少重复(DRY 原则)
3. 改善函数签名和接口设计
4. 优化性能(如果适用)
5. 增强错误处理

约束:
- 保持原有功能不变
- 不改变外部 API(除非明确要求)
- 每项改动说明理由`,
    description: "重构代码",
    location: "<builtin>",
    name: "refactor",
    parameters: [{ description: "要重构的代码", name: "code", required: true, type: "string" }],
    source: "builtin",
  },
  {
    category: "文档",
    content: `请为以下代码生成清晰的文档。包含:

1. 模块/文件概述
2. 函数签名(参数、返回值、泛型)
3. 参数说明(类型、用途、约束)
4. 返回值说明
5. 使用示例(完整可运行)
6. 注意事项和常见陷阱

格式:使用 JSDoc/TSDoc 注释风格。`,
    description: "生成文档",
    location: "<builtin>",
    name: "generate-docs",
    source: "builtin",
  },
  {
    category: "调试",
    content: `以下代码存在 Bug，请按流程修复:

1. **分析 Bug 描述**:理解问题的症状和预期行为
2. **定位根因**:追踪代码路径，找出导致问题的代码行
3. **设计修复方案**:说明修复思路，评估影响范围
4. **实施修复**:给出修改后的代码
5. **验证修复**:说明如何验证修复有效
6. **防止回归**:建议添加的测试用例`,
    description: "修复 Bug 流程",
    location: "<builtin>",
    name: "fix-bug",
    source: "builtin",
  },
  {
    category: "配置",
    content: `用户正在编辑 crab-cli 的配置文件。请参考 crab-cli 的配置 schema 来确保配置正确。

crab-cli 配置文件位置:
- 全局:~/.crab/config.json
- 项目级:.crab/config.json

配置支持的字段包括:
- providers:AI 服务商配置
- defaultProvider:默认服务商和模型
- permissions:权限规则
- hooks:Hook 配置
- agents:自定义 Agent
- roles:自定义角色
- skills:Skill 路径和禁用列表

请确保修改后的配置格式正确，不要破坏已有配置。`,
    description: "编辑 crab-cli 配置文件",
    location: "<builtin>",
    name: "customize-crab",
    source: "builtin",
    trigger: "crab config",
  },
];
