/**
 * LSP 配置验证器测试 — 配置结构、字段验证、错误报告。
 *
 * 测试用例:
 *   - ValidationResult 接口
 *   - validateLspConfig 完整配置验证
 *   - validateServerConfig 单个服务器验证
 *   - 字段类型验证
 *   - 语言 ID 验证
 *   - 错误和警告级别
 *   - 严格模式验证
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { type ValidationResult, validateLspConfig, validateServerConfig } from "@/lsp/config/configValidator";
import type { LspConfig, UserLspServerConfig } from "@/lsp/config/lspConfig";

describe("配置验证器", () => {
  describe("ValidationResult 接口", () => {
    test("ValidationResult 接口存在", () => {
      const result: ValidationResult = {
        errors: [],
        valid: true,
      };
      expect(result).toBeDefined();
      expect(result.valid).toBe(true);
      expect(Array.isArray(result.errors)).toBe(true);
    });

    test("errors 结构正确", () => {
      const result: ValidationResult = {
        errors: [
          {
            message: "测试错误",
            path: "$.test",
            severity: "error",
          },
        ],
        valid: false,
      };
      expect(result.errors[0]?.path).toBe("$.test");
      expect(result.errors[0]?.message).toBe("测试错误");
      expect(result.errors[0]?.severity).toBe("error");
    });
  });

  describe("validateLspConfig 完整配置验证", () => {
    test("空配置通过验证", () => {
      const config: LspConfig = {};
      const result = validateLspConfig(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("有效配置通过验证", () => {
      const config: LspConfig = {
        disabled: ["typescript-language-server"],
        servers: {
          "test-server": {
            command: "test-command",
            languages: ["typescript"],
          },
        },
        settings: {
          "typescript-language-server": {
            format: { enabled: true },
          },
        },
      };
      const result = validateLspConfig(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("servers 不是对象时报错", () => {
      const config = {
        servers: "invalid",
      } as unknown as LspConfig;

      const result = validateLspConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === "$.servers")).toBe(true);
      expect(result.errors.some((e) => e.severity === "error")).toBe(true);
    });

    test("disabled 不是数组时报错", () => {
      const config = {
        disabled: "invalid",
      } as unknown as LspConfig;

      const result = validateLspConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === "$.disabled")).toBe(true);
    });

    test("settings 不是对象时报错", () => {
      const config = {
        settings: "invalid",
      } as unknown as LspConfig;

      const result = validateLspConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === "$.settings")).toBe(true);
    });

    test("未知字段在严格模式下报警告", () => {
      const config = {
        servers: {},
        unknownField: "value",
      } as unknown as LspConfig;

      const result = validateLspConfig(config, { strict: true });

      expect(result.valid).toBe(true); // 警告不影响 valid
      expect(result.errors.some((e) => e.path === "$.unknownField")).toBe(true);
      expect(result.errors.some((e) => e.severity === "warning")).toBe(true);
    });

    test("未知字段在非严格模式下不报警", () => {
      const config = {
        servers: {},
        unknownField: "value",
      } as unknown as LspConfig;

      const result = validateLspConfig(config, { strict: false });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("disabled 中的未知 Server ID 报警告", () => {
      const config: LspConfig = {
        disabled: ["unknown-server-xyz"],
      };

      const result = validateLspConfig(config, {
        allowedServerIds: new Set(["typescript-language-server"]),
        strict: true,
      });

      expect(result.valid).toBe(true);
      expect(result.errors.some((e) => e.message.includes("unknown-server-xyz"))).toBe(true);
      expect(result.errors.some((e) => e.severity === "warning")).toBe(true);
    });

    test("disabled 中的非字符串报错", () => {
      const config = {
        disabled: [123],
      } as unknown as LspConfig;

      const result = validateLspConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("必须是字符串"))).toBe(true);
    });
  });

  describe("validateServerConfig 单个服务器验证", () => {
    const validServer: UserLspServerConfig = {
      args: ["--arg1"],
      command: "test-command",
      languages: ["typescript", "javascript"],
    };

    test("有效服务器配置通过验证", () => {
      const result = validateServerConfig("test-server", validServer);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("缺少 command 字段报错", () => {
      const invalid = { ...validServer, command: undefined };
      // @ts-expect-error - 测试缺少 command
      const result = validateServerConfig("test", invalid as UserLspServerConfig);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("command 是必需"))).toBe(true);
    });

    test("command 不是字符串报错", () => {
      const invalid = { ...validServer, command: 123 };
      const result = validateServerConfig("test", invalid as unknown as UserLspServerConfig);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("command 是必需的字符串"))).toBe(true);
    });

    test("args 不是数组报错", () => {
      const invalid = { ...validServer, args: "invalid" };
      const result = validateServerConfig("test", invalid as unknown as UserLspServerConfig);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("args 必须是数组"))).toBe(true);
    });

    test("args 元素不是字符串报错", () => {
      const invalid = { ...validServer, args: [123] };
      const result = validateServerConfig("test", invalid as unknown as UserLspServerConfig);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("args[0] 必须是字符串"))).toBe(true);
    });

    test("缺少 languages 字段报错", () => {
      const invalid = { ...validServer, languages: undefined };
      // @ts-expect-error - 测试缺少 languages
      const result = validateServerConfig("test", invalid as UserLspServerConfig);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("languages 是必需"))).toBe(true);
    });

    test("languages 不是数组报错", () => {
      const invalid = {
        args: [],
        command: "test",
        languages: "invalid" as unknown,
      };
      const result = validateServerConfig("test", invalid as UserLspServerConfig);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("languages 必须是数组"))).toBe(true);
    });

    test("languages 为空数组报错", () => {
      const invalid = { ...validServer, languages: [] };
      const result = validateServerConfig("test", invalid);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("languages 不能为空"))).toBe(true);
    });

    test("未知语言 ID 报警告", () => {
      const invalid = { ...validServer, languages: ["unknown-lang-xyz"] };
      const result = validateServerConfig("test", invalid);

      expect(result.valid).toBe(true);
      expect(result.errors.some((e) => e.message.includes("unknown-lang-xyz"))).toBe(true);
      expect(result.errors.some((e) => e.severity === "warning")).toBe(true);
    });

    test("无效的 transport 值报错", () => {
      const invalid = { ...validServer, transport: "invalid" };
      const result = validateServerConfig("test", invalid as UserLspServerConfig);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("transport 必须是"))).toBe(true);
    });

    test("initializationOptions 不是对象报错", () => {
      const invalid = { ...validServer, initializationOptions: "invalid" };
      const result = validateServerConfig("test", invalid as unknown as UserLspServerConfig);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("initializationOptions 必须是对象"))).toBe(true);
    });

    test("settings 不是对象报错", () => {
      const invalid = { ...validServer, settings: "invalid" };
      const result = validateServerConfig("test", invalid as unknown as UserLspServerConfig);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("settings 必须是对象"))).toBe(true);
    });
  });

  describe("常见有效语言 ID", () => {
    const commonLanguages = [
      "typescript",
      "typescriptreact",
      "javascript",
      "javascriptreact",
      "python",
      "go",
      "rust",
      "c",
      "cpp",
      "java",
      "ruby",
      "php",
      "json",
      "yaml",
      "markdown",
    ];

    test("常见语言 ID 通过验证", () => {
      const config: UserLspServerConfig = {
        command: "test",
        languages: commonLanguages,
      };

      const result = validateServerConfig("test", config);

      expect(result.valid).toBe(true);
      // 应该没有警告，因为这些是常见语言
      const warnings = result.errors.filter((e) => e.severity === "warning");
      expect(warnings).toHaveLength(0);
    });
  });

  describe("边界情况", () => {
    test("空对象服务器配置报错", () => {
      const result = validateServerConfig("test", {} as UserLspServerConfig);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test("null 配置对象报错", () => {
      const result = validateLspConfig(null as unknown as LspConfig);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === "$")).toBe(true);
    });

    test("数组配置对象报错", () => {
      const result = validateLspConfig([] as unknown as LspConfig);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === "$")).toBe(true);
    });

    test("最小有效配置通过", () => {
      const config: LspConfig = {
        servers: {
          minimal: {
            command: "cmd",
            languages: ["typescript"],
          },
        },
      };

      const result = validateLspConfig(config);

      expect(result.valid).toBe(true);
    });
  });

  describe("ValidationOptions 选项", () => {
    test("默认 strict 模式", () => {
      const config = { servers: {}, unknownField: "value" } as unknown as LspConfig;
      const result = validateLspConfig(config);

      // 默认 strict=true
      expect(result.valid).toBe(true);
      expect(result.errors.some((e) => e.severity === "warning")).toBe(true);
    });

    test("关闭 strict 模式", () => {
      const config = { servers: {}, unknownField: "value" } as unknown as LspConfig;
      const result = validateLspConfig(config, { strict: false });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("自定义 allowedServerIds", () => {
      const config: LspConfig = {
        disabled: ["custom-server"],
      };

      const result = validateLspConfig(config, {
        allowedServerIds: new Set(["custom-server"]),
        strict: true,
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("不匹配的 allowedServerIds 报警告", () => {
      const config: LspConfig = {
        disabled: ["unknown-server"],
      };

      const result = validateLspConfig(config, {
        allowedServerIds: new Set(["other-server"]),
        strict: true,
      });

      expect(result.valid).toBe(true);
      expect(result.errors.some((e) => e.message.includes("unknown-server"))).toBe(true);
      expect(result.errors.some((e) => e.severity === "warning")).toBe(true);
    });
  });
});
