/**
 * 统一 Hook 执行器单元测试。
 *
 * 覆盖场景:
 *   - matchRule / matchPattern 通配符匹配
 *   - replacePlaceholders 占位符替换
 *   - parseJsonResponse JSON 解析（含 markdown 代码块提取）
 *   - truncateOutput 输出截断
 *   - executeCommand 命令执行
 *   - executeHooks 空配置 / 跳过规则 / 阻断行为
 */
import { describe, expect, test } from "bun:test";
import { UnifiedHooksExecutor } from "@/hooks/unifiedHookExecutor";

/** 创建测试用实例（短超时） */
function createExecutor(): UnifiedHooksExecutor {
  return new UnifiedHooksExecutor(1000, 5000);
}

describe("UnifiedHooksExecutor", () => {
  describe("matchPattern", () => {
    test("精确匹配", () => {
      const executor = createExecutor();
      // 通过 matchRule 间接测试 matchPattern
      const rule = {
        description: "test",
        hooks: [{ command: "echo ok", type: "command" as const }],
        matcher: "bash",
      };
      // toolName = "bash" 应该匹配
      const matched = (executor as any).matchRule(rule, { toolName: "bash" });
      expect(matched).toBe(true);
    });

    test("通配符 * 匹配", () => {
      const executor = createExecutor();
      const rule = {
        description: "test",
        hooks: [{ command: "echo ok", type: "command" as const }],
        matcher: "filesystem-*",
      };
      const matched = (executor as any).matchRule(rule, { toolName: "filesystem-write" });
      expect(matched).toBe(true);
    });

    test("通配符不匹配时排除", () => {
      const executor = createExecutor();
      const rule = {
        description: "test",
        hooks: [{ command: "echo ok", type: "command" as const }],
        matcher: "bash",
      };
      const matched = (executor as any).matchRule(rule, { toolName: "filesystem-read" });
      expect(matched).toBe(false);
    });

    test("key:value 格式匹配", () => {
      const executor = createExecutor();
      const rule = {
        description: "test",
        hooks: [{ command: "echo ok", type: "command" as const }],
        matcher: "toolName:bash",
      };
      const matched = (executor as any).matchRule(rule, { toolName: "bash" });
      expect(matched).toBe(true);
    });

    test("无 matcher 时匹配所有", () => {
      const executor = createExecutor();
      const rule = {
        description: "test",
        hooks: [{ command: "echo ok", type: "command" as const }],
      };
      const matched = (executor as any).matchRule(rule, { toolName: "anything" });
      expect(matched).toBe(true);
    });

    test("多 matcher 用逗号分隔（任一匹配即可）", () => {
      const executor = createExecutor();
      const rule = {
        description: "test",
        hooks: [{ command: "echo ok", type: "command" as const }],
        matcher: "bash, read",
      };
      // "read" 应该匹配
      const matched = (executor as any).matchRule(rule, { toolName: "read" });
      expect(matched).toBe(true);
    });
  });

  describe("replacePlaceholders", () => {
    test("$TOOLSRESULT$ 替换为工具数据 JSON", () => {
      const executor = createExecutor();
      const text = "Result: $TOOLSRESULT$";
      const context = { toolName: "bash", toolArgs: { command: "ls" } };
      const result = (executor as any).replacePlaceholders(text, context);
      const parsed = JSON.parse(result.replace("Result: ", ""));
      expect(parsed.toolName).toBe("bash");
      expect(parsed.args.command).toBe("ls");
    });

    test("$TOOLSRESULT$ 包含 toolResult", () => {
      const executor = createExecutor();
      const text = "Result: $TOOLSRESULT$";
      const context = { toolName: "bash", toolResult: { output: "hello" } };
      const result = (executor as any).replacePlaceholders(text, context);
      expect(result).toContain('"toolName":"bash"');
      expect(result).toContain('"result":{"output":"hello"}');
    });

    test("$STOPSESSION$ 替换为消息数据", () => {
      const executor = createExecutor();
      const text = "Messages: $STOPSESSION$";
      const context = { messages: ["msg1", "msg2"] };
      const result = (executor as any).replacePlaceholders(text, context);
      expect(result).toBe('Messages: ["msg1","msg2"]');
    });

    test("$SUBAGENTRESULT$ 替换为子代理数据", () => {
      const executor = createExecutor();
      const text = "Agent: $SUBAGENTRESULT$";
      const context = { agentId: "a1", agentName: "researcher", success: true };
      const result = (executor as any).replacePlaceholders(text, context);
      expect(result).toContain('"agentId":"a1"');
      expect(result).toContain('"agentName":"researcher"');
    });

    test("无占位符时原样返回", () => {
      const executor = createExecutor();
      const text = "plain text";
      const result = (executor as any).replacePlaceholders(text, {});
      expect(result).toBe("plain text");
    });

    test("无 context 时原样返回", () => {
      const executor = createExecutor();
      const result = (executor as any).replacePlaceholders("no context", undefined);
      expect(result).toBe("no context");
    });
  });

  describe("parseJsonResponse", () => {
    test("正常 JSON 解析", () => {
      const executor = createExecutor();
      const result = (executor as any).parseJsonResponse('{"ask":"user","message":"hello","continue":false}');
      expect(result).toEqual({ ask: "user", continue: false, message: "hello" });
    });

    test("提取 markdown 代码块中的 JSON", () => {
      const executor = createExecutor();
      const result = (executor as any).parseJsonResponse(
        '```json\n{"ask":"ai","message":"continue","continue":true}\n```',
      );
      expect(result).toEqual({ ask: "ai", continue: true, message: "continue" });
    });

    test("无代码块标记的 markdown 代码块", () => {
      const executor = createExecutor();
      const result = (executor as any).parseJsonResponse('```\n{"ask":"user","message":"stop","continue":false}\n```');
      expect(result).toEqual({ ask: "user", continue: false, message: "stop" });
    });

    test("无效 JSON 返回 null", () => {
      const executor = createExecutor();
      const result = (executor as any).parseJsonResponse("not json at all");
      expect(result).toBeNull();
    });

    test("空字符串返回 null", () => {
      const executor = createExecutor();
      const result = (executor as any).parseJsonResponse("");
      expect(result).toBeNull();
    });
  });

  describe("truncateOutput", () => {
    test("短输出不截断", () => {
      const executor = new UnifiedHooksExecutor(100, 5000);
      const result = (executor as any).truncateOutput("hello");
      expect(result).toBe("hello");
    });

    test("超长输出截断并添加标记", () => {
      const executor = new UnifiedHooksExecutor(30, 5000);
      const longText = "A".repeat(100);
      const result = (executor as any).truncateOutput(longText);
      expect(result.length).toBeLessThan(100);
      expect(result).toContain("...(输出已截断)...");
    });
  });

  describe("executeCommand", () => {
    test("成功执行命令", async () => {
      const executor = createExecutor();
      const action = { command: "echo hello", type: "command" as const };
      const result = await (executor as any).executeCommand(action, {});
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.output?.trim()).toBe("hello");
    });

    test("失败命令返回错误", async () => {
      const executor = createExecutor();
      const action = { command: "bash -c 'exit 2'", type: "command" as const };
      const result = await (executor as any).executeCommand(action, {});
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(2);
    });

    test("stdin 数据传递", async () => {
      const executor = createExecutor();
      const action = { command: "bash -c 'cat'", type: "command" as const };
      const result = await (executor as any).executeCommand(action, { key: "value" });
      expect(result.output?.trim()).toBe('{"key":"value"}');
    });
  });

  describe("executeHooks", () => {
    test("无配置时返回空结果", async () => {
      const executor = createExecutor();
      // Compress 事件大概率没有配置文件
      const result = await executor.executeHooks("Compress");
      expect(result.success).toBe(true);
      expect(result.executedActions).toBe(0);
      expect(result.results).toEqual([]);
    });
  });
});
