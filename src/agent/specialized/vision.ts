/**
 * Vision Agent — 图片分析和视觉理解 Agent
 *
 * 职责:
 *   - 分析图片内容并生成描述
 *   - 提取图片中的文字信息 (OCR)
 *   - 识别图表和数据可视化内容
 *   - 支持截图分析
 *   - 集成 Vision API (Claude 3.5 Sonnet/GPT-4V)
 *
 * 模块功能:
 *   - registerVisionAgent: 注册 Vision Agent
 *   - analyzeImage: 分析图片内容
 *   - extractText: 提取图片中的文字
 *   - analyzeChart: 分析图表和数据可视化
 *   - VisionConfig: Vision 配置接口
 *   - VisionResult: 分析结果接口
 *
 * 使用场景:
 *   - AI 需要理解截图或图片内容
 *   - 提取图片中的文字信息
 *   - 分析图表和数据可视化
 *   - 处理用户提供的图片文件
 *
 * 边界:
 *   1. 支持多种图片格式 (PNG, JPEG, GIF, WebP)
 *   2. 依赖多模态 LLM 进行图片分析
 *   3. 最大图片大小限制为 20MB
 *   4. 支持本地文件路径和 Buffer 输入
 *   5. OCR 准确度受图片质量和语言影响
 *
 * 流程:
 *   1. 接收图片输入(文件路径或 Buffer)
 *   2. 根据操作类型选择分析方法
 *   3. 调用多模态 LLM 进行分析
 *   4. 处理分析结果
 *   5. 返回结构化的分析结果
 */

import { createLogger } from "@/core/logging/logger";
import { completeLlm } from "@/api";
import { type ModelMessage } from "ai";
import { promises as fs } from "node:fs";
import path from "path";
import type { AppConfigSchema } from "@/schema/config";
import { createUserError } from "@/core/errors/appError";

const log = createLogger("agent:vision");

/** 图片类型 */
export type ImageType = "screenshot" | "chart" | "photo" | "document" | "other";

/** Vision 操作类型 */
export type VisionAction = "analyze" | "extract_text" | "analyze_chart";

/** Vision 配置 */
export interface VisionConfig {
  /** 分析类型 */
  action: VisionAction;
  /** 图片类型(可选，用于优化分析) */
  imageType?: ImageType;
  /** 是否包含详细描述，默认 true */
  detailed?: boolean;
  /** 语言，默认 "zh" */
  language?: "zh" | "en";
  /** 是否提取文字(仅 extract_text 时有效) */
  extractText?: boolean;
  /** 上下文信息(可选，用于提高分析准确度) */
  context?: string;
}

/** Vision 结果 */
export interface VisionResult {
  /** 是否成功 */
  success: boolean;
  /** 操作类型 */
  action: VisionAction;
  /** 图片内容描述 */
  description?: string;
  /** 提取的文字 */
  text?: string;
  /** 识别的元素列表 */
  elements?: {
    type: string;
    content: string;
    confidence: number;
    position?: { x: number; y: number; width: number; height: number };
  }[];
  /** 图表类型(仅 analyze_chart 时有效) */
  chartType?: string;
  /** 图表数据(仅 analyze_chart 时有效) */
  chartData?: {
    label: string;
    value: number | string;
    color?: string;
  }[];
  /** 错误信息 */
  error?: string;
  /** 处理时间(毫秒) */
  processingTime?: number;
}

/** 图片输入 */
export interface VisionInput {
  /** 图片类型 */
  type: "file" | "buffer";
  /** 文件路径(type=file 时) */
  filePath?: string;
  /** 图片数据(type=buffer 时) */
  buffer?: Buffer;
  /** 图片类型(可选) */
  imageType?: ImageType;
}

/** 默认配置 */
const DEFAULT_CONFIG: Omit<VisionConfig, "action"> = {
  detailed: true,
  extractText: false,
  language: "zh",
};

/** 创建 Vision 错误结果(统一错误处理) */
function createVisionErrorResult(action: VisionAction, error: unknown, processingTime: number): VisionResult {
  const errorMsg = error instanceof Error ? error.message : String(error);
  return {
    action,
    error: errorMsg,
    processingTime,
    success: false,
  };
}

/**
 * Vision Agent 类
 */
export class VisionAgent {
  private config: AppConfigSchema;

  constructor(config: AppConfigSchema) {
    this.config = config;
  }

  /**
   * 统一 Vision 任务执行管道
   */
  private async executeVisionTask<T>(
    input: VisionInput,
    action: VisionAction,
    configOverrides: VisionConfig | undefined,
    task: (imageData: Buffer, config: VisionConfig) => Promise<T>,
    formatResult: (result: T, processingTime: number) => VisionResult,
  ): Promise<VisionResult> {
    const startTime = Date.now();
    const finalConfig = { ...DEFAULT_CONFIG, ...configOverrides, action };

    try {
      const imageData = await this.loadImage(input);
      const result = await task(imageData, finalConfig);
      return formatResult(result, Date.now() - startTime);
    } catch (error) {
      log.error(`Vision ${action} 失败`, { error: error instanceof Error ? error.message : String(error) });
      return createVisionErrorResult(action, error, Date.now() - startTime);
    }
  }

  /**
   * 分析图片内容
   */
  async analyzeImage(input: VisionInput, config?: VisionConfig): Promise<VisionResult> {
    return this.executeVisionTask(
      input,
      "analyze",
      config,
      (imageData, finalConfig) => this.callVisionAPI(imageData, finalConfig),
      (description, processingTime) => ({
        action: "analyze",
        description,
        processingTime,
        success: true,
      }),
    );
  }

  /**
   * 提取图片中的文字
   */
  async extractText(input: VisionInput, config?: VisionConfig): Promise<VisionResult> {
    return this.executeVisionTask(
      input,
      "extract_text",
      config,
      (imageData, finalConfig) => this.callVisionOCR(imageData, finalConfig),
      (text, processingTime) => ({
        action: "extract_text",
        processingTime,
        success: true,
        text,
      }),
    );
  }

  /**
   * 分析图表和数据可视化
   */
  async analyzeChart(input: VisionInput, config?: VisionConfig): Promise<VisionResult> {
    return this.executeVisionTask(
      input,
      "analyze_chart",
      config,
      (imageData, finalConfig) => this.callVisionChartAPI(imageData, finalConfig),
      (result, processingTime) => ({
        action: "analyze_chart",
        chartData: result.chartData,
        chartType: result.chartType,
        description: result.description,
        elements: result.elements,
        processingTime,
        success: true,
      }),
    );
  }

  /**
   * 加载图片数据
   */
  private async loadImage(input: VisionInput): Promise<Buffer> {
    if (input.type === "file" && input.filePath) {
      // 从文件加载
      const absolutePath = path.resolve(input.filePath);
      try {
        const buffer = await fs.readFile(absolutePath);
        // 检查文件大小(限制 20MB)
        if (buffer.length > 20 * 1024 * 1024) {
          throw createUserError("INVALID_INPUT", "图片文件过大，最大支持 20MB");
        }
        return buffer;
      } catch {
        throw createUserError("INVALID_INPUT", `无法读取图片文件: ${absolutePath}`);
      }
    } else if (input.type === "buffer" && input.buffer) {
      // 使用 Buffer
      if (input.buffer.length > 20 * 1024 * 1024) {
        throw createUserError("INVALID_INPUT", "图片数据过大，最大支持 20MB");
      }
      return input.buffer;
    } else {
      throw createUserError("INVALID_INPUT", "无效的图片输入类型");
    }
  }

  /**
   * 调用 Vision API 进行图片分析
   */
  private async callVisionAPI(imageData: Buffer, config: VisionConfig): Promise<string> {
    const { language, detailed, context } = config;

    // 构建图片分析提示词
    let prompt = `请分析这张图片`;
    if (language === "zh") {
      prompt += `(用中文回答)`;
    }

    if (context) {
      prompt += `\n上下文信息:${context}`;
    }

    if (detailed) {
      prompt += `\n请提供详细描述，包括:\n- 图片的主要内容\n- 识别出的元素(文字、图标、UI组件等)\n- 整体风格和用途`;
    }

    prompt += `\n\n## 降级规则\n- 图片模糊或无法识别：说明「图像质量不足，无法准确分析」\n- 图片内容与请求类型不匹配：说明实际内容类型，不要强行分析\n- 图片过大或格式不支持：说明限制和要求`;

    // 转换图片为 base64
    const base64Image = imageData.toString("base64");

    // 构建 AI SDK 消息 - 使用多模态内容格式
    const messages: ModelMessage[] = [
      {
        content: [
          { text: prompt, type: "text" },
          { image: `data:image/jpeg;base64,${base64Image}`, type: "image" },
        ],
        role: "user",
      },
    ];

    // 调用 LLM
    const { text: response } = await completeLlm(this.config, messages, {
      maxTokens: 1000,
      temperature: 0.3,
    });

    return response;
  }

  /**
   * 调用 Vision API 进行 OCR
   */
  private async callVisionOCR(imageData: Buffer, config: VisionConfig): Promise<string> {
    const { language } = config;

    let prompt = `请提取这张图片中的所有文字内容`;
    if (language === "zh") {
      prompt += `(包括中文)`;
    }

    prompt += `\n请按原文输出，保持格式和布局`;

    prompt += `\n\n## 降级规则\n- 图片中无文字：直接返回「图片中未检测到文字内容」\n- 文字模糊无法识别：标注为 [无法识别]，不要猜测\n- 图片为纯图表/截图：提取可见文字，不添加解释\n- 多语言混合：按原始语言输出，不翻译`;

    const base64Image = imageData.toString("base64");

    const messages: ModelMessage[] = [
      {
        content: [
          { text: prompt, type: "text" },
          {
            image: `data:image/jpeg;base64,${base64Image}`,
            type: "image",
          },
        ],
        role: "user",
      },
    ];

    const { text: response } = await completeLlm(this.config, messages, {
      maxTokens: 2000,
      temperature: 0.1,
    });

    return response;
  }

  /**
   * 调用 Vision API 进行图表分析
   */
  private async callVisionChartAPI(
    imageData: Buffer,
    config: VisionConfig,
  ): Promise<{
    description: string;
    chartType: string;
    chartData: { label: string; value: number | string; color?: string }[];
    elements: { type: string; content: string; confidence: number }[];
  }> {
    const { language, context } = config;

    let prompt = `请分析这张图表或数据可视化图片`;
    if (language === "zh") {
      prompt += `(用中文回答)`;
    }

    if (context) {
      prompt += `\n上下文:${context}`;
    }

    prompt += `\n请提供:\n- 图表类型(如柱状图、折线图、饼图等)\n- 数据趋势和关键发现\n- 图表中的具体数值信息`;

    prompt += `\n\n## 降级规则\n- 非图表图片（如照片、截图）：说明「非图表图片」，返回描述而非图表分析\n- 图表模糊无法辨认：说明「图表内容无法辨认」，列出可见元素\n- 无数据标签的图表：描述趋势和形状，不编造数值`;

    const base64Image = imageData.toString("base64");

    const messages: ModelMessage[] = [
      {
        content: [
          { text: prompt, type: "text" },
          {
            image: `data:image/jpeg;base64,${base64Image}`,
            type: "image",
          },
        ],
        role: "user",
      },
    ];

    const { text: response } = await completeLlm(this.config, messages, {
      maxTokens: 1500,
      temperature: 0.2,
    });

    // 解析响应(尝试提取结构化数据)
    const content = response;

    // 这里可以添加更复杂的解析逻辑来提取图表数据
    // 目前先返回描述性结果
    return {
      chartData: [],
      chartType: "unknown",
      description: content,
      elements: [],
    };
  }
}

/**
 * 注册 Vision Agent
 */
export function registerVisionAgent(config: AppConfigSchema): VisionAgent {
  return new VisionAgent(config);
}
