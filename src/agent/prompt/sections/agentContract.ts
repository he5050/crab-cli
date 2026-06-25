/** Agent 专属提示词契约。 */
export interface AgentPromptContract {
  /** Agent 名称。 */
  name: string;
  /** 身份定义。 */
  identity: string;
  /** 核心职责。 */
  responsibility: string;
  /** 能力范围。 */
  capabilities: string[];
  /** 行为边界。 */
  boundaries: string[];
  /** 工具策略。 */
  toolPolicy: string;
  /** 工作流程。 */
  workflow: string[];
  /** 输出格式。 */
  outputFormat: string;
  /** 升级/上报规则。 */
  escalationRules: string[];
}

/** 构建 Agent 专属职责 section。 */
export function buildAgentContractSection(contract?: AgentPromptContract): string {
  if (!contract) {
    return "";
  }

  return [
    "## Agent 专属职责",
    "",
    `Agent: ${contract.name}`,
    "",
    "### 身份",
    contract.identity,
    "",
    "### 核心职责",
    contract.responsibility,
    "",
    "### 能力范围",
    ...contract.capabilities.map((item) => `- ${item}`),
    "",
    "### 行为边界",
    ...contract.boundaries.map((item) => `- ${item}`),
    "",
    "### 工具策略",
    contract.toolPolicy,
    "",
    "### 工作流程",
    ...contract.workflow.map((item, index) => `${index + 1}. ${item}`),
    "",
    "### 输出格式",
    contract.outputFormat,
    "",
    "### 升级规则",
    ...contract.escalationRules.map((item) => `- ${item}`),
  ].join("\n");
}
