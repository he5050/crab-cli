/**
 * 错误码定义 — 应用程序错误的错误码规范。
 *
 * 格式:DOMAIN-编号
 *   - DOMAIN: 错误域(2-8个字母)
 *   - 编号: 3位数字，001-999
 *
 * 错误域:
 *   - SYSTEM: 系统级错误
 *   - USER: 用户输入错误
 *   - AGENT: Agent 执行错误
 *   - CONFIG: 配置错误
 *   - SESSION: 会话错误
 *   - TOOL: 工具执行错误
 *   - NETWORK: 网络错误
 *   - SECURITY: 安全错误
 *   - DATABASE: 数据库错误
 *   - INTERNAL: 内部错误
 *
 * 严重级别:
 *   - low: 低，影响很小
 *   - medium: 中，影响部分功能
 *   - high: 高，影响主要功能
 *   - critical: 严重，系统不可用
 *
 * 边界:
 *   1. 新增错误码必须在对应域的编号范围内
 *   2. 错误码不可重复
 *   3. 描述应简洁明了
 */

// ─── 错误码注册表 ─────────────────────────────────────────────────

export const ERROR_CODES = {
  // ── SYSTEM errors (001-099) ──────────────────────────────────
  SYSTEM: {
    /** 006: 磁盘空间不足 */
    DISK_FULL: { code: "SYSTEM-006", message: "磁盘空间不足", severity: "critical" as const },
    /** 008: 文件不存在 */
    FILE_NOT_FOUND: { code: "SYSTEM-008", message: "文件不存在", severity: "medium" as const },
    /** 001: 文件系统错误 */
    FS_READ_ERROR: { code: "SYSTEM-001", message: "文件读取失败", severity: "critical" as const },
    /** 002: 文件系统写入错误 */
    FS_WRITE_ERROR: { code: "SYSTEM-002", message: "文件写入失败", severity: "critical" as const },
    /** 009: 路径格式错误 */
    INVALID_PATH: { code: "SYSTEM-009", message: "路径格式错误", severity: "medium" as const },
    /** 005: 系统内存不足 */
    OUT_OF_MEMORY: { code: "SYSTEM-005", message: "系统内存不足", severity: "critical" as const },
    /** 007: 权限不足 */
    PERMISSION_DENIED: { code: "SYSTEM-007", message: "权限不足", severity: "high" as const },
    /** 004: 子进程异常退出 */
    PROCESS_EXIT_ERROR: { code: "SYSTEM-004", message: "子进程异常退出", severity: "high" as const },
    /** 003: 进程启动失败 */
    PROCESS_SPAWN_ERROR: { code: "SYSTEM-003", message: "进程启动失败", severity: "critical" as const },
  },

  // ── NETWORK errors (100-199) ──────────────────────────────
  NETWORK: {
    /** 100: 网络连接失败 */
    CONNECTION_FAILED: { code: "NETWORK-100", message: "网络连接失败", severity: "high" as const },
    /** 101: 连接超时 */
    CONNECTION_TIMEOUT: { code: "NETWORK-101", message: "连接超时", severity: "medium" as const },
    /** 105: DNS 解析失败 */
    DNS_ERROR: { code: "NETWORK-105", message: "DNS 解析失败", severity: "high" as const },
    /** 104: 无效响应格式 */
    INVALID_RESPONSE: { code: "NETWORK-104", message: "无效响应格式", severity: "medium" as const },
    /** 102: 请求超时 */
    REQUEST_TIMEOUT: { code: "NETWORK-102", message: "请求超时", severity: "medium" as const },
    /** 103: 服务器错误响应 */
    SERVER_ERROR: { code: "NETWORK-103", message: "服务器错误", severity: "high" as const },
    /** 106: SSL/TLS 错误 */
    SSL_ERROR: { code: "NETWORK-106", message: "SSL/TLS 错误", severity: "high" as const },
  },

  // ── USER errors (200-299) ─────────────────────────────────
  USER: {
    /** 206: 格式错误 */
    FORMAT_ERROR: { code: "USER-206", message: "格式错误", severity: "medium" as const },
    /** 200: 无效输入 */
    INVALID_INPUT: { code: "USER-200", message: "无效输入", severity: "low" as const },
    /** 202: 参数无效 */
    INVALID_PARAMETER: { code: "USER-202", message: "参数无效", severity: "medium" as const },
    /** 201: 参数缺失 */
    MISSING_PARAMETER: { code: "USER-201", message: "参数缺失", severity: "medium" as const },
    /** 207: 超出配额 */
    QUOTA_EXCEEDED: { code: "USER-207", message: "超出配额", severity: "high" as const },
    /** 205: 资源已存在 */
    RESOURCE_EXISTS: { code: "USER-205", message: "资源已存在", severity: "low" as const },
    /** 204: 资源不存在 */
    RESOURCE_NOT_FOUND: { code: "USER-204", message: "资源不存在", severity: "medium" as const },
    /** 203: 操作取消 */
    USER_CANCELLED: { code: "USER-203", message: "用户取消操作", severity: "low" as const },
  },

  // ── CONFIG errors (300-399) ───────────────────────────────
  CONFIG: {
    /** 302: 配置过期 */
    CONFIG_DEPRECATED: { code: "CONFIG-302", message: "配置已过期", severity: "low" as const },
    /** 305: 配置文件不存在 */
    CONFIG_FILE_NOT_FOUND: { code: "CONFIG-305", message: "配置文件不存在", severity: "medium" as const },
    /** 301: 配置无效 */
    CONFIG_INVALID: { code: "CONFIG-301", message: "配置无效", severity: "high" as const },
    /** 300: 配置缺失 */
    CONFIG_MISSING: { code: "CONFIG-300", message: "配置缺失", severity: "high" as const },
    /** 303: Schema 验证失败 */
    CONFIG_SCHEMA_INVALID: { code: "CONFIG-303", message: "配置 Schema 验证失败", severity: "high" as const },
    /** 304: 环境变量缺失 */
    ENV_VAR_MISSING: { code: "CONFIG-304", message: "环境变量缺失", severity: "high" as const },
  },

  // ── SESSION errors (400-499) ──────────────────────────────
  SESSION: {
    /** 401: 会话已过期 */
    SESSION_EXPIRED: { code: "SESSION-401", message: "会话已过期", severity: "medium" as const },
    /** 404: 会话初始化失败 */
    SESSION_INIT_ERROR: { code: "SESSION-404", message: "会话初始化失败", severity: "high" as const },
    /** 403: 会话已满 */
    SESSION_LIMIT: { code: "SESSION-403", message: "会话数量已达上限", severity: "high" as const },
    /** 400: 会话不存在 */
    SESSION_NOT_FOUND: { code: "SESSION-400", message: "会话不存在", severity: "medium" as const },
    /** 405: 会话恢复失败 */
    SESSION_RECOVERY_ERROR: { code: "SESSION-405", message: "会话恢复失败", severity: "high" as const },
    /** 402: 会话状态错误 */
    SESSION_STATE_ERROR: { code: "SESSION-402", message: "会话状态错误", severity: "high" as const },
  },

  // ── AGENT errors (500-599) ─────────────────────────────────
  AGENT: {
    /** 505: Agent 熔断触发 */
    AGENT_CIRCUIT_OPEN: { code: "AGENT-505", message: "Agent 熔断器已触发", severity: "high" as const },
    /** 504: Agent 执行失败 */
    AGENT_EXEC_ERROR: { code: "AGENT-504", message: "Agent 执行失败", severity: "high" as const },
    /** 503: Agent 初始化失败 */
    AGENT_INIT_ERROR: { code: "AGENT-503", message: "Agent 初始化失败", severity: "critical" as const },
    /** 502: Agent 循环检测 */
    AGENT_LOOP_DETECTED: { code: "AGENT-502", message: "Agent 执行循环", severity: "high" as const },
    /** 501: Agent 无响应 */
    AGENT_NO_RESPONSE: { code: "AGENT-501", message: "Agent 无响应", severity: "high" as const },
    /** 506: Agent 消息序列化失败 */
    AGENT_SERIALIZE_ERROR: { code: "AGENT-506", message: "Agent 消息序列化失败", severity: "medium" as const },
    /** 500: Agent 执行超时 */
    AGENT_TIMEOUT: { code: "AGENT-500", message: "Agent 执行超时", severity: "high" as const },
  },

  // ── TOOL errors (600-699) ─────────────────────────────────
  TOOL: {
    /** 601: 工具执行失败 */
    TOOL_EXEC_ERROR: { code: "TOOL-601", message: "工具执行失败", severity: "high" as const },
    /** 600: 工具不存在 */
    TOOL_NOT_FOUND: { code: "TOOL-600", message: "工具不存在", severity: "medium" as const },
    /** 603: 工具参数无效 */
    TOOL_PARAM_ERROR: { code: "TOOL-603", message: "工具参数无效", severity: "medium" as const },
    /** 605: 工具权限不足 */
    TOOL_PERMISSION_DENIED: { code: "TOOL-605", message: "工具权限不足", severity: "high" as const },
    /** 602: 工具超时 */
    TOOL_TIMEOUT: { code: "TOOL-602", message: "工具执行超时", severity: "medium" as const },
    /** 604: 工具不可用 */
    TOOL_UNAVAILABLE: { code: "TOOL-604", message: "工具不可用", severity: "medium" as const },
  },

  // ── SECURITY errors (700-799) ──────────────────────────────
  SECURITY: {
    /** 701: 授权失败 */
    AUTHZ_FAILED: { code: "SECURITY-701", message: "授权失败", severity: "high" as const },
    /** 700: 认证失败 */
    AUTH_FAILED: { code: "SECURITY-700", message: "认证失败", severity: "high" as const },
    /** 706: 命令注入检测 */
    COMMAND_INJECTION: { code: "SECURITY-706", message: "命令注入检测", severity: "critical" as const },
    /** 707: 提示注入检测 */
    PROMPT_INJECTION: { code: "SECURITY-707", message: "提示注入检测", severity: "high" as const },
    /** 708: ReDoS 攻击检测 */
    REDOS_DETECTED: { code: "SECURITY-708", message: "ReDoS 攻击检测", severity: "high" as const },
    /** 705: 重放攻击检测 */
    REPLAY_DETECTED: { code: "SECURITY-705", message: "重放攻击检测", severity: "high" as const },
    /** 704: 请求签名错误 */
    SIGNATURE_ERROR: { code: "SECURITY-704", message: "请求签名错误", severity: "high" as const },
    /** 702: Token 过期 */
    TOKEN_EXPIRED: { code: "SECURITY-702", message: "Token 已过期", severity: "high" as const },
    /** 703: Token 无效 */
    TOKEN_INVALID: { code: "SECURITY-703", message: "Token 无效", severity: "high" as const },
  },

  // ── DATABASE errors (800-899) ─────────────────────────────
  DATABASE: {
    /** 804: 数据冲突 */
    DB_CONFLICT: { code: "DATABASE-804", message: "数据冲突", severity: "medium" as const },
    /** 800: 数据库连接失败 */
    DB_CONNECTION_ERROR: { code: "DATABASE-800", message: "数据库连接失败", severity: "critical" as const },
    /** 803: 数据不存在 */
    DB_NOT_FOUND: { code: "DATABASE-803", message: "数据不存在", severity: "medium" as const },
    /** 801: 查询错误 */
    DB_QUERY_ERROR: { code: "DATABASE-801", message: "数据库查询错误", severity: "high" as const },
    /** 802: 事务失败 */
    DB_TRANSACTION_ERROR: { code: "DATABASE-802", message: "数据库事务失败", severity: "high" as const },
  },

  // ── INTERNAL errors (900-999) ────────────────────────────
  INTERNAL: {
    /** 903: 断言失败 */
    ASSERTION_FAILED: { code: "INTERNAL-903", message: "断言失败", severity: "high" as const },
    /** 900: 内部错误 */
    INTERNAL_ERROR: { code: "INTERNAL-900", message: "内部错误", severity: "critical" as const },
    /** 901: 未实现 */
    NOT_IMPLEMENTED: { code: "INTERNAL-901", message: "功能未实现", severity: "medium" as const },
    /** 902: 状态不一致 */
    STATE_INCONSISTENT: { code: "INTERNAL-902", message: "状态不一致", severity: "high" as const },
    /** 904: 未知错误 */
    UNKNOWN_ERROR: { code: "INTERNAL-904", message: "未知错误", severity: "critical" as const },
  },
} as const;

// ─── 类型别名 ─────────────────────────────────────────────────

export type ErrorCodeKey = keyof typeof ERROR_CODES;
/** Individual error code entry */
export interface ErrorCode {
  readonly code: string;
  readonly severity: ErrorSeverity;
  readonly message: string;
}
/** All domain-specific error code keys */
export type DomainErrorCodeKey = keyof (typeof ERROR_CODES)[ErrorCodeKey];
export type ErrorDomain =
  | "SYSTEM"
  | "NETWORK"
  | "USER"
  | "CONFIG"
  | "SESSION"
  | "AGENT"
  | "TOOL"
  | "SECURITY"
  | "DATABASE"
  | "INTERNAL";
export type ErrorSeverity = "low" | "medium" | "high" | "critical";

// ─── 辅助函数 ─────────────────────────────────────────────────

/**
 * 获取错误码信息
 */
export function getErrorCodeInfo(code: string): ErrorCode | undefined {
  for (const domain of Object.values(ERROR_CODES)) {
    for (const entry of Object.values(domain) as ErrorCode[]) {
      if (entry.code === code) {
        return entry;
      }
    }
  }
  return undefined;
}

/**
 * 判断错误码是否已知
 */
export function isKnownErrorCode(code: string): boolean {
  return getErrorCodeInfo(code) !== undefined;
}

/**
 * 获取错误严重级别对应的日志方法
 */
export function getSeverityLogMethod(severity: ErrorSeverity): "debug" | "info" | "warn" | "error" {
  switch (severity) {
    case "low": {
      return "debug";
    }
    case "medium": {
      return "info";
    }
    case "high": {
      return "warn";
    }
    case "critical": {
      return "error";
    }
  }
}
