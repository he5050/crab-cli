/**
 * 配置 Schema — 配置验证的 Schema 定义。
 *
 * @internal 当前验证框架预留未集成，导出仅供未来扩展使用。
 *           config 加载管线当前仅依赖 Zod safeParse（@/schema/config）。
 *
 * 职责:
 *   - 定义配置字段的验证规则
 *   - 提供默认值
 *   - 验证配置是否符合规范
 *
 * Schema 类型:
 *   - string: 字符串类型
 *   - number: 数字类型
 *   - boolean: 布尔类型
 *   - array: 数组类型
 *   - object: 对象类型
 *   - enum: 枚举类型
 *
 * 验证规则:
 *   - required: 必填字段
 *   - min/max: 数值范围
 *   - pattern: 正则匹配
 *   - enum: 枚举值
 *   - custom: 自定义验证函数
 *
 * 边界:
 *   1. 不处理嵌套字段的默认值(需要递归处理)
 *   2. 自定义验证函数应返回 boolean 或 Error
 */

import { createLogger } from "@/core/logging/logger";

const log = createLogger("config:schema");

// ─── Schema 类型 ─────────────────────────────────────────────────

/** 配置值类型 */
export type ConfigValueType = string | number | boolean | unknown[] | Record<string, unknown>;

/** 验证规则 */
export interface ValidationRule {
  /** 必填 */
  required?: boolean;
  /** 最小值/最小长度 */
  min?: number;
  /** 最大值/最大长度 */
  max?: number;
  /** 正则表达式 */
  pattern?: RegExp;
  /** 枚举值 */
  enum?: unknown[];
  /** 自定义验证 */
  validate?: (value: unknown) => boolean | string;
  /** 默认值 */
  default?: unknown;
  /** 描述 */
  description?: string;
}

/** 字段 Schema */
export interface FieldSchema {
  /** 字段类型 */
  type: "string" | "number" | "boolean" | "array" | "object" | "enum";
  /** 验证规则 */
  rules?: ValidationRule;
  /** 嵌套对象 Schema(仅 type=object 时) */
  fields?: Record<string, FieldSchema>;
  /** 数组元素 Schema(仅 type=array 时) */
  items?: FieldSchema;
}

/** 配置 Schema */
export interface ConfigSchema {
  /** Schema 名称 */
  name: string;
  /** Schema 版本 */
  version: string;
  /** 字段定义 */
  fields: Record<string, FieldSchema>;
}

// ─── 验证结果 ─────────────────────────────────────────────────

/** 验证结果 */
export interface ValidationResult {
  /** 是否有效 */
  valid: boolean;
  /** 错误信息 */
  errors?: string[];
  /** 验证后的默认值(用于替换无效值) */
  defaults?: Record<string, unknown>;
}

// ─── 验证函数 ─────────────────────────────────────────────────

/**
 * 验证配置值
 */
export function validateValue(value: unknown, fieldSchema: FieldSchema, fieldName: string): string[] {
  const errors: string[] = [];
  const { rules } = fieldSchema;

  // 类型检查
  if (value === undefined || value === null) {
    if (rules?.required) {
      errors.push(`${fieldName}: 必填字段不能为空`);
    }
    return errors;
  }

  switch (fieldSchema.type) {
    case "string": {
      if (typeof value !== "string") {
        errors.push(`${fieldName}: 期望字符串类型`);
        return errors;
      }
      break;
    }
    case "number": {
      if (typeof value !== "number") {
        errors.push(`${fieldName}: 期望数字类型`);
        return errors;
      }
      break;
    }
    case "boolean": {
      if (typeof value !== "boolean") {
        errors.push(`${fieldName}: 期望布尔类型`);
        return errors;
      }
      break;
    }
    case "array": {
      if (!Array.isArray(value)) {
        errors.push(`${fieldName}: 期望数组类型`);
        return errors;
      }
      break;
    }
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        errors.push(`${fieldName}: 期望对象类型`);
        return errors;
      }
      break;
    }
    case "enum": {
      if (rules?.enum && !rules.enum.includes(value)) {
        errors.push(`${fieldName}: 值必须是 [${rules.enum.join(", ")}] 之一`);
        return errors;
      }
      break;
    }
  }

  // 字符串验证
  if (fieldSchema.type === "string" && typeof value === "string") {
    if (rules?.min !== undefined && value.length < rules.min) {
      errors.push(`${fieldName}: 长度不能小于 ${rules.min}`);
    }
    if (rules?.max !== undefined && value.length > rules.max) {
      errors.push(`${fieldName}: 长度不能大于 ${rules.max}`);
    }
    if (rules?.pattern && !rules.pattern.test(value)) {
      errors.push(`${fieldName}: 不符合格式要求`);
    }
  }

  // 数字验证
  if (fieldSchema.type === "number" && typeof value === "number") {
    if (rules?.min !== undefined && value < rules.min) {
      errors.push(`${fieldName}: 不能小于 ${rules.min}`);
    }
    if (rules?.max !== undefined && value > rules.max) {
      errors.push(`${fieldName}: 不能大于 ${rules.max}`);
    }
  }

  // 数组验证
  if (fieldSchema.type === "array" && Array.isArray(value)) {
    if (rules?.min !== undefined && value.length < rules.min) {
      errors.push(`${fieldName}: 数组长度不能小于 ${rules.min}`);
    }
    if (rules?.max !== undefined && value.length > rules.max) {
      errors.push(`${fieldName}: 数组长度不能大于 ${rules.max}`);
    }
  }

  // 自定义验证
  if (rules?.validate) {
    try {
      const result = rules.validate(value);
      if (result === false) {
        errors.push(`${fieldName}: 自定义验证失败`);
      } else if (typeof result === "string") {
        errors.push(`${fieldName}: ${result}`);
      }
    } catch {
      errors.push(`${fieldName}: 验证函数出错`);
    }
  }

  return errors;
}

/**
 * 验证配置是否符合 Schema
 */
export function validateConfigAgainstSchema(config: Record<string, unknown>, schema: ConfigSchema): ValidationResult {
  const errors: string[] = [];
  const defaults: Record<string, unknown> = {};

  for (const [fieldName, fieldSchema] of Object.entries(schema.fields)) {
    const value = config[fieldName];

    // 验证
    const fieldErrors = validateValue(value, fieldSchema, fieldName);
    errors.push(...fieldErrors);

    // 收集默认值
    if (fieldSchema.rules?.default !== undefined) {
      defaults[fieldName] = fieldSchema.rules.default;
    }
  }

  return {
    defaults: Object.keys(defaults).length > 0 ? defaults : undefined,
    errors: errors.length > 0 ? errors : undefined,
    valid: errors.length === 0,
  };
}

// ─── 常用 Schema 预定义 ─────────────────────────────────────────────────

/** 端口号 Schema */
export const portSchema: FieldSchema = {
  rules: {
    default: 8080,
    max: 65_535,
    min: 1,
  },
  type: "number",
};

/** 布尔 Schema */
export const booleanSchema: FieldSchema = {
  rules: {
    default: false,
  },
  type: "boolean",
};

/** 字符串非空 Schema */
export const nonEmptyStringSchema: FieldSchema = {
  rules: {
    min: 1,
    required: true,
  },
  type: "string",
};

/** URL Schema */
export const urlSchema: FieldSchema = {
  rules: {
    pattern: /^https?:\/\/.+/,
  },
  type: "string",
};

/** 日志级别 Schema */
export const logLevelSchema: FieldSchema = {
  rules: {
    default: "info",
    enum: ["debug", "info", "warn", "error"],
  },
  type: "enum",
};
