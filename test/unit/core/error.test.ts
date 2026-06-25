/**
 * AppError 单元测试
 */
import { describe, expect, test } from "bun:test";
import {
  AgentError,
  AppError,
  ConfigError,
  DatabaseError,
  InternalError,
  SecurityError,
  SessionError,
  SystemError,
  ToolError,
  UserError,
  createAgentError,
  createConfigError,
  createSecurityError,
  createSessionError,
  createSystemError,
  createToolError,
  createUserError,
  onAppError,
  toAppError,
} from "@/core/errors/appError";
import { ERROR_CODES } from "@/core/errors/errorCodes";

describe("AppError", () => {
  test("创建基本错误", () => {
    const error = new AppError("USER-200", "测试错误"); // USER-200 = INVALID_INPUT
    expect(error.code).toBe("USER-200");
    expect(error.message).toBe("测试错误");
    expect(error.domain).toBe("USER");
    expect(error.severity).toBe("low");
    expect(error.recoverable).toBe(true);
    expect(error.timestamp).toBeGreaterThan(0);
  });

  test("错误包含堆栈", () => {
    const error = new AppError("USER-200", "测试错误");
    expect(error.stack).toBeDefined();
    expect(error.stack).toContain("test"); // 包含测试文件名
  });

  test("toJSON 序列化", () => {
    const error = new AppError("USER-200", "测试错误", {
      context: { sessionId: "test" },
    });
    const json = error.toJSON();

    expect(json.code).toBe("USER-200");
    expect(json.message).toBe("测试错误");
    expect(json.domain).toBe("USER");
    expect(json.context).toEqual({ sessionId: "test" });
  });

  test("toUserString 格式化", () => {
    const error = new AppError("SESSION-400", "会话不存在"); // SESSION-400 = SESSION_NOT_FOUND
    const str = error.toUserString();
    expect(str).toContain("SESSION-400");
    expect(str).toContain("会话不存在");
  });

  test("getSuggestion 返回建议", () => {
    const error = new AppError("SESSION-400", "会话不存在");
    const suggestion = error.getSuggestion();
    expect(suggestion).toBe("请重新创建会话");
  });

  test("isRecoverable 返回正确值", () => {
    const lowError = new AppError("USER-200", "低严重错误", { severity: "low" });
    expect(lowError.isRecoverable()).toBe(true);

    const criticalError = new AppError("SYSTEM-001", "严重错误", { severity: "critical" });
    expect(criticalError.isRecoverable()).toBe(false);
  });

  test("cause 链式错误", () => {
    const cause = new Error("原始错误");
    const error = new AppError("AGENT-500", "Agent 错误", { cause }); // AGENT-500 = AGENT_TIMEOUT
    expect(error.cause).toBe(cause);
  });
});

describe("子类错误", () => {
  test("SystemError", () => {
    const error = new SystemError("SYSTEM-001", "系统错误");
    expect(error.domain).toBe("SYSTEM");
    expect(error.name).toBe("SystemError");
  });

  test("UserError", () => {
    const error = new UserError("USER-200", "用户错误");
    expect(error.domain).toBe("USER");
    expect(error.name).toBe("UserError");
  });

  test("AgentError", () => {
    const error = new AgentError("AGENT-500", "Agent 错误");
    expect(error.domain).toBe("AGENT");
    expect(error.name).toBe("AgentError");
  });

  test("ConfigError", () => {
    const error = new ConfigError("CONFIG-300", "配置错误"); // CONFIG-300 = CONFIG_MISSING
    expect(error.domain).toBe("CONFIG");
    expect(error.name).toBe("ConfigError");
  });

  test("SessionError", () => {
    const error = new SessionError("SESSION-400", "会话错误");
    expect(error.domain).toBe("SESSION");
    expect(error.name).toBe("SessionError");
  });

  test("ToolError", () => {
    const error = new ToolError("TOOL-600", "工具错误"); // TOOL-600 = TOOL_NOT_FOUND
    expect(error.domain).toBe("TOOL");
    expect(error.name).toBe("ToolError");
  });

  test("SecurityError", () => {
    const error = new SecurityError("SECURITY-700", "安全错误"); // SECURITY-700 = AUTH_FAILED
    expect(error.domain).toBe("SECURITY");
    expect(error.name).toBe("SecurityError");
  });

  test("DatabaseError", () => {
    const error = new DatabaseError("DATABASE-800", "数据库错误"); // DATABASE-800 = DB_CONNECTION_ERROR
    expect(error.domain).toBe("DATABASE");
    expect(error.name).toBe("DatabaseError");
  });

  test("InternalError", () => {
    const error = new InternalError("INTERNAL-900", "内部错误");
    expect(error.domain).toBe("INTERNAL");
    expect(error.name).toBe("InternalError");
  });
});

describe("错误工厂函数", () => {
  test("createSystemError", () => {
    const error = createSystemError("FS_READ_ERROR", "自定义消息");
    expect(error.code).toBe("SYSTEM-001");
    expect(error.message).toBe("自定义消息");
    expect(error.severity).toBe("critical");
  });

  test("createUserError", () => {
    const error = createUserError("INVALID_INPUT", "输入无效");
    expect(error.code).toBe("USER-200");
    expect(error.message).toBe("输入无效");
  });

  test("createAgentError", () => {
    const error = createAgentError("AGENT_TIMEOUT", "超时了");
    expect(error.code).toBe("AGENT-500");
    expect(error.message).toBe("超时了");
  });

  test("createConfigError", () => {
    const error = createConfigError("CONFIG_MISSING", "配置缺失");
    expect(error.code).toBe("CONFIG-300");
  });

  test("createSessionError", () => {
    const error = createSessionError("SESSION_NOT_FOUND");
    expect(error.code).toBe("SESSION-400");
  });

  test("createToolError", () => {
    const error = createToolError("TOOL_NOT_FOUND");
    expect(error.code).toBe("TOOL-600");
  });

  test("createSecurityError", () => {
    const error = createSecurityError("AUTH_FAILED");
    expect(error.code).toBe("SECURITY-700");
  });
});

describe("全局错误处理", () => {
  test("onAppError 注册处理器", () => {
    const unsubscribe = onAppError(() => {});
    unsubscribe();
  });

  test("toAppError 转换 Error", () => {
    const error = new Error("原始错误");
    const appError = toAppError(error);

    expect(appError).toBeInstanceOf(InternalError);
    expect(appError.message).toBe("原始错误");
  });

  test("toAppError 转换字符串", () => {
    const appError = toAppError("字符串错误");
    expect(appError).toBeInstanceOf(InternalError);
    expect(appError.message).toBe("字符串错误");
  });

  test("toAppError 保留 AppError", () => {
    const original = new UserError("USER-200", "原始用户错误");
    const converted = toAppError(original);
    expect(converted).toBe(original);
  });
});

describe("ERROR_CODES 常量", () => {
  test("所有错误码存在", () => {
    expect(ERROR_CODES.SYSTEM.FS_READ_ERROR.code).toBe("SYSTEM-001");
    expect(ERROR_CODES.USER.INVALID_INPUT.code).toBe("USER-200");
    expect(ERROR_CODES.AGENT.AGENT_TIMEOUT.code).toBe("AGENT-500");
    expect(ERROR_CODES.SESSION.SESSION_NOT_FOUND.code).toBe("SESSION-400");
    expect(ERROR_CODES.CONFIG.CONFIG_MISSING.code).toBe("CONFIG-300");
    expect(ERROR_CODES.TOOL.TOOL_NOT_FOUND.code).toBe("TOOL-600");
    expect(ERROR_CODES.SECURITY.AUTH_FAILED.code).toBe("SECURITY-700");
    expect(ERROR_CODES.DATABASE.DB_CONNECTION_ERROR.code).toBe("DATABASE-800");
    expect(ERROR_CODES.INTERNAL.INTERNAL_ERROR.code).toBe("INTERNAL-900");
  });

  test("错误码格式正确", () => {
    const checkFormat = (code: string) => {
      const match = code.match(/^[A-Z]+-\d{3}$/);
      expect(match).toBeTruthy();
    };

    checkFormat("SYSTEM-001");
    checkFormat("USER-200");
    checkFormat("AGENT-500");
    checkFormat("SECURITY-706");
  });
});
