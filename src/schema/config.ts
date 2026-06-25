/**
 * 应用配置 Schema
 *
 * 职责:
 *   - 定义配置结构的验证规则
 *   - 为所有字段提供默认值，支持 parse({}) 安全调用
 *   - 支持 MCP Server、代理、Provider 等多种配置类型
 *
 * 模块功能:
 *   - 定义 MCP OAuth 配置 Schema(McpOAuthConfig)
 *   - 定义 MCP Server 配置 Schema(McpServerConfig)
 *   - 定义 MCP 配置文件 Schema(McpConfigFileSchema)
 *   - 定义代理配置 Schema(ProxyConfig)
 *   - 定义请求方法枚举(RequestMethod)
 *   - 定义单一 Provider 配置 Schema(SingleProviderConfig)
 *   - 定义应用主配置 Schema(AppConfigSchema)
 *
 * 使用场景:
 *   - 验证用户配置文件(~/.crab/config.json)
 *   - 验证 MCP 配置文件(~/.crab/mcp.json)
 *   - 验证 API 请求参数和 Provider 配置
 *   - 提供类型安全的配置访问
 *
 * 边界:
 *   1. 仅定义 schema，不加载文件
 *   2. 所有字段必须有默认值或标记为 optional
 *   3. 使用 Zod 进行运行时类型验证
 *   4. 不处理配置文件的读写操作
 *
 * 流程:
 *   1. 定义各配置模块的基础 Schema
 *   2. 组合基础 Schema 构建完整配置
 *   3. 使用 parse() 或 safeParse() 验证数据
 *   4. 导出 Schema 和推断类型供业务使用
 */
import { z } from "zod";
import { AgentMode, AgentName } from "@/schema/agent";
import { PermissionRule } from "@/schema/permission";

/** 默认最大工具调用轮次。仅作为防失控保护，不应限制复杂任务容量。 */
const DEFAULT_MAX_TOOL_ROUNDS = 50;

/** 配置中的 Agent 条目(简化版，model 为字符串而非 AgentModel) */
const ConfigAgentEntry = z.object({
  description: z.string().optional(),
  mode: AgentMode.default("primary"),
  model: z.string().optional(),
  name: AgentName,
  options: z.record(z.string(), z.unknown()).default({}),
  permission: z.array(PermissionRule).optional(),
  prompt: z.string().optional(),
});
export type ConfigAgentEntry = z.infer<typeof ConfigAgentEntry>;

/** MCP 服务器配置 */
export const McpOAuthConfig = z.object({
  authorizationUrl: z.url().optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  redirectUri: z.url().optional(),
  scope: z.string().optional(),
});
export type McpOAuthConfig = z.infer<typeof McpOAuthConfig>;

export const McpServerConfig = z.object({
  args: z.array(z.string()).default([]),
  /** 启动命令(STDIO 模式) */
  command: z.string().optional(),
  cwd: z.string().optional(),
  /** 禁用的工具名列表(原始 tool name，不含 server 前缀) */
  disabledTools: z.array(z.string()).optional(),
  /** 是否启用(可临时禁用某个 server) */
  enabled: z.boolean().optional(),
  env: z.record(z.string(), z.string()).optional(),
  /** 自定义请求头(用于 Auth 等) */
  headers: z.record(z.string(), z.string()).optional(),
  name: z.string().min(1, "MCP Server 名称不能为空"),
  /** OAuth 认证配置，false 表示显式关闭自动认证 */
  oauth: z.union([McpOAuthConfig, z.literal(false)]).optional(),
  /** 工具调用超时(毫秒)，默认 300000 */
  timeout: z.number().int().positive().optional(),
  /** 传输类型:stdio / sse / http */
  type: z.enum(["stdio", "sse", "http"]).optional(),
  /** HTTP 远程服务器 URL(SSE/HTTP 模式) */
  url: z.url().optional(),
});
export type McpServerConfig = z.infer<typeof McpServerConfig>;

/** MCP Server 配置(不含 name，因为 name 来自 mcpServers 的 key) */
const McpServerEntry = McpServerConfig.omit({ name: true });
export type McpServerEntry = z.infer<typeof McpServerEntry>;

/** MCP 配置文件 Schema(唯一真值源:~/.crab/mcp.json) */
export const McpConfigFileSchema = z.object({
  mcpServers: z.record(z.string(), McpServerEntry).default({}),
});
export type McpConfigFileSchema = z.infer<typeof McpConfigFileSchema>;

/** 代理配置 */
export const ProxyConfig = z.object({
  /** 浏览器调试端口(WSL 模式) */
  browserDebugPort: z.number().default(9222),
  enabled: z.boolean().default(false),
  /** HTTP 代理端口 */
  port: z.number().default(7890),
  /** 搜索引擎选择(duckduckgo / bing) */
  searchEngine: z.enum(["duckduckgo", "bing"]).default("duckduckgo"),
  url: z.url().optional(),
});
export type ProxyConfig = z.infer<typeof ProxyConfig>;

/**
 * 请求方法类型。
 *
 * chat    → /v1/chat/completions    (OpenAI Chat API)
 * responses → /v1/responses         (OpenAI Responses API)
 * claude  → /v1/messages            (Anthropic Claude API)
 * gemini  → /v1beta/models/{model}:generateContent (Google Gemini API)
 *
 * 所有 4 种默认走 OpenAI 兼容接口(@ai-sdk/openai)，
 * 仅 claude 走 @ai-sdk/anthropic，gemini 走 @ai-sdk/google。
 */
export const RequestMethod = z.enum(["chat", "responses", "claude", "gemini"]);
export type RequestMethod = z.infer<typeof RequestMethod>;

/** Thinking 配置 Schema */
export const ThinkingConfig = z.object({
  budgetTokens: z.number().int().positive().optional(),
  enabled: z.boolean().default(false),
  /** Gemini thinking summary visibility */
  includeThoughts: z.boolean().optional(),
  /** OpenAI chat/responses reasoning effort */
  reasoningEffort: z.enum(["low", "medium", "high"]).optional(),
  /** Gemini 3 thinking level */
  thinkingLevel: z.enum(["minimal", "low", "medium", "high"]).optional(),
});
export type ThinkingConfig = z.infer<typeof ThinkingConfig>;

/** RequestMethod 级 thinking 覆盖 */
export const RequestThinkingConfig = z
  .object({
    chat: ThinkingConfig.optional(),
    claude: ThinkingConfig.optional(),
    gemini: ThinkingConfig.optional(),
    responses: ThinkingConfig.optional(),
  })
  .partial();
export type RequestThinkingConfig = z.infer<typeof RequestThinkingConfig>;

/** Prompt caching 配置 Schema */
export const PromptCachingConfig = z.object({
  enabled: z.boolean().default(true),
});
export type PromptCachingConfig = z.infer<typeof PromptCachingConfig>;

/** Provider OAuth 认证配置 */
export const ProviderOAuthConfigSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string().optional(),
  authorizeUrl: z.string().optional(),
  tokenUrl: z.string().optional(),
  scopes: z.array(z.string()).default([]),
  redirectUri: z.string().optional(),
});
export type ProviderOAuthConfig = z.infer<typeof ProviderOAuthConfigSchema>;

/** Provider AWS 凭证配置 */
export const ProviderAwsConfigSchema = z.object({
  region: z.string().default("us-east-1"),
  accessKeyId: z.string(),
  secretAccessKey: z.string(),
  sessionToken: z.string().optional(),
});
export type ProviderAwsConfig = z.infer<typeof ProviderAwsConfigSchema>;

/** 单个 Provider 配置 */
export const SingleProviderConfig = z.object({
  apiKey: z.string().optional(),
  baseURL: z.url().optional(),
  /** 认证类型:api-key（默认）/ oauth / aws */
  authType: z.enum(["api-key", "oauth", "aws"]).optional().default("api-key"),
  /** AWS 凭证配置（authType=aws 时使用） */
  aws: ProviderAwsConfigSchema.optional(),
  /** 自定义请求头 */
  customHeaders: z.record(z.string(), z.string()).optional(),
  defaultModel: z.string().optional(),
  /** Token 限制配置 */
  maxTokens: z.number().int().positive().optional(),
  modelList: z.array(z.string()).optional(),
  /** 模型级协议覆盖:优先级高于 provider.requestMethod */
  modelRequestMethods: z.record(z.string(), RequestMethod).optional(),
  /** 模型级 thinking 覆盖:优先级高于 provider.thinking */
  modelThinking: z.record(z.string(), ThinkingConfig).optional(),
  /** OAuth 认证配置（authType=oauth 时使用） */
  oauth: ProviderOAuthConfigSchema.optional(),
  /** Prompt caching 配置 */
  promptCaching: PromptCachingConfig.optional(),
  /** ReasoningEffort 配置(OpenAI o1/o3/o4 推理模型) */
  reasoningEffort: z.enum(["low", "medium", "high"]).optional(),
  /** 请求方法:chat / responses / claude / gemini */
  requestMethod: RequestMethod.default("chat"),
  /** RequestMethod 级 thinking 覆盖:优先级低于 modelThinking，高于 provider.thinking */
  requestThinking: RequestThinkingConfig.optional(),
  /** 流式超时(毫秒) */
  streamTimeout: z.number().int().positive().optional(),
  /** 自定义系统提示词 */
  systemPrompt: z.string().optional(),
  /** 温度 */
  temperature: z.number().min(0).max(2).optional(),
  /** Thinking 配置(Extended Thinking，provider 级别默认值) */
  thinking: ThinkingConfig.optional(),
  /** Vision 专用 API Key */
  visionApiKey: z.string().optional(),
  /** Vision 专用 Base URL(处理包含图片的消息) */
  visionBaseURL: z.url().optional(),
  /** Vision 专用请求头 */
  visionCustomHeaders: z.record(z.string(), z.string()).optional(),
  /** Vision 专用模型(处理包含图片的消息) */
  visionModel: z.string().optional(),
  /** Vision 专用 Provider(处理包含图片的消息) */
  visionProvider: z.string().optional(),
  /** Vision 专用请求方法 */
  visionRequestMethod: RequestMethod.optional(),
});
export type SingleProviderConfig = z.infer<typeof SingleProviderConfig>;

/** Workspace 配置项 */
export const WorkspaceConfig = z.object({
  /** 工作区唯一标识 */
  id: z.string().min(1),
  /** 工作区显示名称 */
  name: z.string().min(1),
  /** 工作区目录路径 */
  directory: z.string().min(1),
  /** 是否启用 */
  enabled: z.boolean().default(true),
});
export type WorkspaceConfig = z.infer<typeof WorkspaceConfig>;

/** 远程配置源配置 */
export const RemoteConfigSchema = z.object({
  /** 远程配置 URL */
  url: z.url(),
  /** 自定义请求头 */
  headers: z.record(z.string(), z.string()).optional(),
  /** 请求超时（毫秒，默认 10000） */
  timeout: z.number().int().positive().optional(),
});
export type RemoteConfigSchema = z.infer<typeof RemoteConfigSchema>;

/** 应用配置 Schema — 适配生产环境 */
export const AppConfigSchema = z
  .object({
    /** 配置文件版本号（用于向前兼容迁移） */
    configVersion: z.number().int().positive().default(1),

    /** 模型面板:高级模型(复杂任务) */
    advancedModel: z.string().optional(),

    /** Agent 定义列表 — 与 AgentDefinition 对齐 */
    agents: z.array(ConfigAgentEntry).default([]),

    /** 是否在工具写入后自动格式化 */
    autoformat: z.boolean().default(true),

    /** 模型面板:基础模型(简单任务) */
    basicModel: z.string().optional(),

    /** 代码库索引配置(用于 codebaseConfig 页面) */
    codebase: z
      .object({
        /** 支持的文档类型 */
        documentTypes: z.array(z.enum(["pdf", "docx", "xlsx", "pptx"])).default(["pdf", "docx", "xlsx", "pptx"]),
        /** Embedding 配置 */
        embedding: z
          .object({
            /** 自定义 API Key(可选，覆盖 Provider 默认) */
            apiKey: z.string().optional(),
            /** 自定义 API Base URL(可选，覆盖默认) */
            baseUrl: z.string().optional(),
            /** 向量维度 */
            dimensions: z.number().int().positive().default(1536),
            /** 模型名称 */
            model: z.string().default("text-embedding-3-small"),
            /** Embedding Provider 类型 */
            type: z.enum(["openai", "jina", "ollama", "gemini", "mistral"]).default("openai"),
          })
          .default({
            dimensions: 1536,
            model: "text-embedding-3-small",
            type: "openai",
          }),
        ignorePatterns: z.array(z.string()).default([]),
        /** 是否索引 Office 文档 */
        includeDocuments: z.boolean().default(false),
        indexingEnabled: z.boolean().default(true),
        maxFileSize: z.number().int().min(1024).default(1_048_576),
        watchMode: z.boolean().default(true),
      })
      .default({
        documentTypes: ["pdf", "docx", "xlsx", "pptx"],
        embedding: {
          dimensions: 1536,
          model: "text-embedding-3-small",
          type: "openai",
        },
        ignorePatterns: [],
        includeDocuments: false,
        indexingEnabled: true,
        maxFileSize: 1_048_576,
        watchMode: true,
      }),

    /** 自定义 HTTP 请求头(用于 LLM API 调用，如企业网关认证) */
    customHeaders: z.record(z.string(), z.string()).default({}),

    /** 追加到系统提示词的自定义内容 */
    customSystemPrompt: z.string().default(""),

    /** 默认 Provider 和模型选择 */
    defaultProvider: z
      .object({
        model: z.string().default(""),
        provider: z.string().default("openai"),
      })
      .default({ model: "", provider: "openai" }),

    /** Profile 描述(用于 profile 管理 UI) */
    description: z.string().optional(),

    /** 开发模式 */
    devMode: z.boolean().default(false),

    /** Diff 显示风格:auto(自动选择 split/unified)或 stacked(强制 unified) */
    diffStyle: z.enum(["auto", "stacked"]).default("auto"),

    /** Diff wrap 模式:word(换行)或 none(不换行) */
    diffWrapMode: z.enum(["word", "none"]).default("word"),

    /**
     * 死循环检测阈值:连续 N 次相同工具+参数触发中断，默认 5。
     * 主链路工具执行与 Team 队友循环共享此配置；非法值由 AppConfigSchema 默认值兜底。
     */
    doomLoopThreshold: z.number().int().min(1, "最小值为 1").default(5),

    /** Loop 调度配置 */
    loops: z
      .object({
        maxActive: z.number().min(1).max(50).default(10),
      })
      .default({ maxActive: 10 }),

    /** 最大上下文 Token 数(用于 token limiter 计算，至少 1000) */
    maxContextTokens: z.number().int().min(1000, "最小值为 1000").default(200_000),

    /** 子代理最大递归深度(默认 3，范围 1-10) */
    maxSpawnDepth: z.number().int().min(1, "最小值为 1").max(10, "最大值为 10").default(3),

    /** 默认活跃 Agent 名称(应用启动时使用) */
    defaultAgent: z.string().min(1, "Agent 名称不能为空").default("general"),

    /**
     * 最大工具调用轮次:仅作为防失控保护，不作为复杂任务容量限制。
     * 单次 headless 可用 --max-tool-rounds 覆盖；Agent steps 也可覆盖。
     */
    maxToolRounds: z.number().int().min(1, "最小值为 1").default(DEFAULT_MAX_TOOL_ROUNDS),

    /** 权限规则列表 — 复用 PermissionRule Schema，统一结构 */
    permissions: z.array(PermissionRule).default([]),

    /** 当前 Profile 名称 */
    profile: z.string().default("default"),

    /** 各 Provider 的连接配置 */
    providerConfig: z.record(z.string(), SingleProviderConfig).default({}),

    /** 代理配置 */
    proxy: ProxyConfig.default({ browserDebugPort: 9222, enabled: false, port: 7890, searchEngine: "duckduckgo" }),

    /** Rerank 上下文裁剪配置 */
    rerank: z
      .object({
        defaultModel: z.string().optional(),
        maxContextTokens: z.number().int().min(1000).optional(),
        maxDocumentRatio: z.number().min(0.05).max(1).optional(),
      })
      .optional(),

    /** 降级探测备选顺序（默认: ["chat","responses","claude","gemini"]） */
    fallbackChain: z.array(RequestMethod).optional(),

    /** 敏感命令配置 */
    sensitiveCommands: z
      .object({
        commands: z
          .array(
            z.object({
              action: z.enum(["confirm", "block"]).default("confirm"),
              description: z.string().optional(),
              pattern: z.string(),
            }),
          )
          .default([]),
        enabled: z.boolean().default(true),
      })
      .default({ commands: [], enabled: true }),

    /** 小模型(用于 hook 快速分类/小任务，默认沿用 model) */
    smallModel: z.string().optional(),

    /** 系统提示词主内容(systemPromptConfig 页面编辑) */
    systemPrompt: z.string().optional(),

    /** Tavily API Key(用于 websearch 工具) */
    tavilyApiKey: z.string().optional(),

    /** Tavily Base URL(可选，用于自定义 Tavily 端点) */
    tavilyBaseURL: z.url().optional(),

    /** OpenTelemetry 遥测配置 */
    telemetry: z
      .object({
        enabled: z.boolean().default(false),
        /** OTLP HTTP endpoint，如 http://localhost:4318/v1/traces */
        endpoint: z.url().optional(),
        exporterType: z.enum(["otlp", "console", "prometheus", "none"]).default("none"),
        sampleRate: z.number().min(0).max(1).default(1),
        serviceName: z.string().default("crab-cli"),
      })
      .default({ enabled: false, exporterType: "none", sampleRate: 1, serviceName: "crab-cli" }),

    /** 主题名称 */
    theme: z.string().default("dark"),

    /** 模型面板:思考模式开关 */
    thinking: z
      .object({
        enabled: z.boolean().default(false),
        /** 三态 Thinking 模式: show=始终展开, hide=始终折叠, auto=有内容时展开 */
        mode: z.enum(["show", "hide", "auto"]).default("auto"),
      })
      .default({ enabled: false, mode: "auto" }),

    /** 工具返回结果 token 限制百分比(基于 maxContextTokens，范围 20-80) */
    toolResultTokenLimitPercent: z.number().min(20, "最小值为 20").max(80, "最大值为 80").default(30),

    /**
     * 是否使用 Effect Stream 模式处理 LLM 流式响应(P2-A6)。
     * 启用后使用 Effect Stream(Stream.tap/runDrain/takeUntil)替代 AsyncIterable，
     * 默认 false 保持现有行为不变。
     */
    useEffectStream: z.boolean().default(false),

    /**
     * 启用 Effect Stream 中间件模式。
     * 启用后流中间件管道使用 Effect Stream 管道替代 AsyncGenerator 链。
     */
    useEffectMiddleware: z.boolean().default(false),

    /**
     * 启用 Effect Stream 处理器模式。
     * 启用后流式处理器使用 Stream.tap/runDrain 替代 for-await。
     */
    useEffectProcessor: z.boolean().default(false),

    /**
     * 启用 Effect Stream 熔断器模式。
     * 启用后熔断器用 Effect.fail/catchAll 替代手动 try/catch。
     */
    useEffectCircuitBreaker: z.boolean().default(false),

    /**
     * 启用 Effect Stream BTW 旁路问答模式。
     * 启用后 abort 用 Stream.takeUntil 替代手动检查。
     */
    useEffectBtwStream: z.boolean().default(false),

    /**
     * 启用 Effect Stream Route 执行器模式。
     * 启用后 SSE 解析使用 Stream.map/filter 替代 for 循环。
     */
    useEffectRouteExecutor: z.boolean().default(false),

    /**
     * 启用 Effect Stream DeepResearch 模式。
     * 启用后 LLM 收集使用 Stream.runDrain 替代 for-await。
     */
    useEffectDeepResearch: z.boolean().default(false),

    /** 远程配置源 — 从指定 URL 拉取 JSON 配置并合并（优先级低于本地配置） */
    remoteConfig: RemoteConfigSchema.optional(),

    /** 工作区列表 — 多工作区管理(P3-F8) */
    workspaces: z.array(WorkspaceConfig).default([]),

    /** 当前激活的工作区 ID */
    currentWorkspaceId: z.string().optional(),
  })
  .strict();
export type AppConfigSchema = z.infer<typeof AppConfigSchema>;
