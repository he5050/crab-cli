/**
 * 用户提问工具测试。
 *
 * 覆盖:askUserTool 的 execute 逻辑
 * - ToolContext.askUser 回调路径
 * - 用户取消路径
 * - 参数验证
 */
import { describe, expect, mock, test } from "bun:test";
import { askUserQuestionTool } from "@/tool/askUser/index";
import { globalBus } from "@/bus";
import { AppEvent } from "@/bus";

describe("askUserQuestionTool", () => {
  test("无 ToolContext 时通过 EventBus 收到回答", async () => {
    globalBus.clearHistory();
    const pending = askUserQuestionTool.execute(
      {
        defaultValue: "crab-cli",
        question: "请输入项目名",
      },
      undefined,
    );

    const req = globalBus.getHistory({ limit: 1, type: AppEvent.UserInputRequested.type })[0] as
      | { payload: { properties: { question: string; defaultValue: string; requestId: string } } }
      | undefined;
    expect(req?.payload.properties.question).toBe("请输入项目名");
    expect(req?.payload.properties.defaultValue).toBe("crab-cli");

    globalBus.publish(AppEvent.UserInput, {
      answer: "codex",
      requestId: req!.payload.properties.requestId,
    });
    await globalBus.flush();

    await expect(pending).resolves.toMatchObject({
      answer: "codex",
      success: true,
    });
  });

  test("无 ToolContext 时通过 EventBus 收到取消信号", async () => {
    globalBus.clearHistory();
    const pending = askUserQuestionTool.execute(
      {
        multiSelect: false,
        options: [{ label: "是", value: "yes" }],
        question: "确认执行？",
      },
      undefined,
    );

    const req = globalBus.getHistory({ limit: 1, type: AppEvent.UserInputRequested.type })[0] as
      | { payload: { properties: { requestId: string } } }
      | undefined;
    globalBus.publish(AppEvent.UserInput, {
      cancelled: true,
      requestId: req!.payload.properties.requestId,
    });
    await globalBus.flush();

    await expect(pending).resolves.toMatchObject({
      cancelled: true,
      success: false,
    });
  });

  test("工具定义正确", () => {
    expect(askUserQuestionTool.name).toBe("askuser-ask-question");
    expect(askUserQuestionTool.permission).toBe("ask-user");
    expect(askUserQuestionTool.description).toBeTruthy();
  });

  test("通过 ToolContext.askUser 回调获取回答", async () => {
    const askUser = mock(() => Promise.resolve("Yes"));
    const result = await askUserQuestionTool.execute({ question: "继续吗？" }, { askUser } as any);
    expect(result).toMatchObject({
      answer: "Yes",
      question: "继续吗？",
      success: true,
    });
    expect(askUser).toHaveBeenCalled();
  });

  test("用户取消时返回 cancelled=true", async () => {
    const askUser = mock(() => Promise.reject(new Error("user cancelled")));
    const result = await askUserQuestionTool.execute({ question: "确认删除？" }, { askUser } as any);
    expect(result).toMatchObject({
      cancelled: true,
      success: false,
    });
  });

  test("带选项的提问", async () => {
    const askUser = mock(() => Promise.resolve("option_a"));
    const result = await askUserQuestionTool.execute(
      {
        multiSelect: false,
        options: [
          { label: "A", value: "option_a" },
          { label: "B", value: "option_b" },
        ],
        question: "选择一个选项",
      },
      { askUser } as any,
    );
    expect(result).toMatchObject({ success: true });
  });

  test("多选模式", async () => {
    const askUser = mock(() => Promise.resolve(["a", "b"]));
    const result = await askUserQuestionTool.execute(
      {
        multiSelect: true,
        options: [
          { label: "A", value: "a" },
          { label: "B", value: "b" },
        ],
        question: "选择多个",
      },
      { askUser } as any,
    );
    expect(result).toMatchObject({ success: true });
  });

  test("ToolContext 回调收到完整参数", async () => {
    const askUser = mock(async (payload) => {
      expect(payload).toMatchObject({
        defaultValue: "dev",
        multiSelect: true,
        question: "需要哪些环境？",
      });
      expect(payload.options[0]).toMatchObject({ label: "开发", value: "dev" });
      return ["dev", "prod"];
    });

    const result = await askUserQuestionTool.execute(
      {
        defaultValue: "dev",
        multiSelect: true,
        options: [
          { description: "开发环境", label: "开发", value: "dev" },
          { label: "生产", value: "prod" },
        ],
        question: "需要哪些环境？",
      },
      { askUser } as any,
    );

    expect(result).toMatchObject({
      answer: ["dev", "prod"],
      success: true,
    });
  });

  test("支持自由输入和多阶段步骤参数", async () => {
    const askUser = mock(async (payload) => {
      expect(payload.allowFreeInput).toBe(true);
      expect(payload.placeholder).toBe("请输入其他方案");
      expect(payload.steps).toHaveLength(2);
      expect(payload.steps[0]).toMatchObject({
        allowFreeInput: true,
        title: "迁移策略选择",
      });
      expect(payload.steps[1]).toMatchObject({
        multiSelect: false,
        title: "API 适配方案",
      });
      return JSON.stringify({
        api: "legacy_proxy",
        strategy: "rewrite",
      });
    });

    const result = await askUserQuestionTool.execute(
      {
        allowFreeInput: true,
        placeholder: "请输入其他方案",
        question: "请选择迁移方案",
        steps: [
          {
            allowFreeInput: true,
            id: "strategy",
            options: [{ description: "质量最高", label: "完整重写", value: "rewrite" }],
            question: "3 个 React 模块迁到 Vue 项目，采用哪种迁移策略？",
            title: "迁移策略选择",
          },
          {
            id: "api",
            multiSelect: false,
            options: [{ label: "继续调用老 /api 接口", value: "legacy_proxy" }],
            question: "后端 API 路径差异如何处理？",
            title: "API 适配方案",
          },
        ],
      },
      { askUser } as any,
    );

    expect(result).toMatchObject({
      answer: JSON.stringify({
        api: "legacy_proxy",
        strategy: "rewrite",
      }),
      success: true,
    });
  });

  test("无 ToolContext 时发布自由输入和步骤配置到 EventBus", async () => {
    globalBus.clearHistory();
    const pending = askUserQuestionTool.execute(
      {
        allowFreeInput: true,
        question: "请选择迁移方案",
        steps: [
          {
            allowFreeInput: true,
            id: "strategy",
            options: [{ label: "完整重写", value: "rewrite" }],
            question: "采用哪种迁移策略？",
            title: "迁移策略选择",
          },
        ],
      },
      undefined,
    );

    const req = globalBus.getHistory({ limit: 1, type: AppEvent.UserInputRequested.type })[0] as
      | {
          payload: {
            properties: {
              requestId: string;
              allowFreeInput: boolean;
              steps: { id?: string; title: string; allowFreeInput?: boolean }[];
            };
          };
        }
      | undefined;
    expect(req?.payload.properties.allowFreeInput).toBe(true);
    expect(req?.payload.properties.steps[0]).toMatchObject({
      allowFreeInput: true,
      id: "strategy",
      title: "迁移策略选择",
    });

    globalBus.publish(AppEvent.UserInput, {
      answer: JSON.stringify({ strategy: "rewrite" }),
      requestId: req!.payload.properties.requestId,
    });
    await globalBus.flush();

    await expect(pending).resolves.toMatchObject({
      answer: JSON.stringify({ strategy: "rewrite" }),
      success: true,
    });
  });

  test("无 ToolContext 时返回 Promise(等待 EventBus)", async () => {
    // 没有 context.askUser，工具会通过 EventBus 等待
    // 使用 Promise.race 来避免无限等待
    const result = await Promise.race([
      askUserQuestionTool.execute({ question: "test" }, undefined),
      new Promise((r) => setTimeout(() => r("timeout"), 100)),
    ]);
    // 100ms 内应该还没有结果(等待 EventBus 响应)
    expect(result).toBe("timeout");
  });
});
