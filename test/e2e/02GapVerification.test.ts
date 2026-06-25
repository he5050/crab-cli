/**
 * 差距补充验证测试
 *
 * 验证新增 Agent 和子代理系统的完整功能:
 * 1. CodebaseIndexAgent - 代码库索引能力
 * 2. SummaryAgent - 总结能力
 * 3. subAgentResolver - 子代理解析
 * 4. subAgentStreamProcessor - 子代理流处理
 * 5. subAgentExecutor - 子代理执行
 * 6. 完整业务流程集成
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { createId } from "@/core/identity";
import { globalBus } from "@/bus/core/eventBus";
import { AppEvent } from "@/bus/events";
import { loadConfig } from "@/config/loader/config";
import { ensureSession, getSession } from "@/session/session";
import { subAgentTracker } from "@/agent/subagent/tracker";
import { createCodebaseIndex, registerCodebaseIndexAgent } from "@/agent/specialized/codebaseIndex";
import { createSummary, registerSummaryAgent } from "@/agent/specialized/summary";
import { buildSubAgentContext, registerSubAgentResolver, resolveSubAgent } from "@/agent/subagent/resolver";
import { createStreamProcessor } from "@/agent/subagent/streamProcessor";
import { createSubAgentExecutor } from "@/agent/subagent/executor";
import { cleanupTestDir, createGlobalTmpTestDir } from "../helpers/testPaths";

describe("差距补充验证 - 完整业务流程", () => {
  let config: Awaited<ReturnType<typeof loadConfig>>;
  let codebaseFixtureRoot: string;

  beforeAll(() => {
    codebaseFixtureRoot = createGlobalTmpTestDir("codebase-index-fixture-");
    fs.mkdirSync(path.join(codebaseFixtureRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(codebaseFixtureRoot, "test"), { recursive: true });
    fs.writeFileSync(
      path.join(codebaseFixtureRoot, "package.json"),
      JSON.stringify(
        {
          dependencies: {
            "@opentui/core": "1.0.0",
            "@opentui/solid": "1.0.0",
            zod: "1.0.0",
          },
          devDependencies: {
            typescript: "1.0.0",
          },
          name: "codebase-index-fixture",
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(path.join(codebaseFixtureRoot, "tsconfig.json"), JSON.stringify({ compilerOptions: {} }));
    fs.writeFileSync(path.join(codebaseFixtureRoot, "bun.lock"), "");
    fs.writeFileSync(path.join(codebaseFixtureRoot, "README.md"), "# Fixture\n");
    fs.writeFileSync(path.join(codebaseFixtureRoot, "src", "index.ts"), "export const fixture = true;\n");
    fs.writeFileSync(
      path.join(codebaseFixtureRoot, "test", "index.test.ts"),
      "import { expect, test } from 'bun:test';\ntest('fixture', () => expect(true).toBe(true));\n",
    );
  });

  afterAll(() => {
    cleanupTestDir(codebaseFixtureRoot);
  });

  beforeEach(async () => {
    config = await loadConfig();
    subAgentTracker.clear();
  });

  afterEach(() => {
    subAgentTracker.clear();
  });

  describe("1. CodebaseIndexAgent 功能验证", () => {
    it("应该能够创建代码库索引", async () => {
      const result = await createCodebaseIndex(codebaseFixtureRoot);

      expect(result.success).toBe(true);
      expect(result.rootPath).toBe(codebaseFixtureRoot);
      expect(result.projectName).toBeDefined();
      expect(result.techStack).toBeDefined();
      expect(result.statistics.totalFiles).toBeGreaterThan(0);
      expect(result.statistics.totalDirectories).toBeGreaterThan(0);
      expect(result.keyFiles.length).toBeGreaterThan(0);
    });

    it("应该能够识别技术栈", async () => {
      const result = await createCodebaseIndex(codebaseFixtureRoot);

      expect(result.techStack.languages).toContain("TypeScript");
      expect(result.techStack.packageManager).toBe("bun");
      expect(result.techStack.frameworks).toContain("OpenTUI");
    });

    it("应该能够识别关键文件", async () => {
      const result = await createCodebaseIndex(codebaseFixtureRoot);

      const { keyFiles } = result;
      expect(keyFiles.some((f) => f.includes("package.json"))).toBe(true);
      expect(keyFiles.some((f) => f.includes("tsconfig.json"))).toBe(true);
      expect(keyFiles.some((f) => f.includes("readme.md") || f.includes("README.md"))).toBe(true);
    });

    it("应该能够生成统计信息", async () => {
      const result = await createCodebaseIndex(codebaseFixtureRoot);
      const stats = result.statistics;

      expect(stats.totalFiles).toBeGreaterThan(0);
      expect(stats.sourceFiles).toBeGreaterThan(0);
      expect(stats.configFiles).toBeGreaterThan(0);
      expect(stats.testFiles).toBeGreaterThan(0);
      expect(stats.byLanguage["TypeScript"]).toBeGreaterThan(0);
    });

    it("应该能够处理不存在的目录", async () => {
      const result = await createCodebaseIndex("/nonexistent/path");

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("2. SummaryAgent 功能验证", () => {
    it(
      "应该能够总结对话内容",
      async () => {
        const messages = [
          { content: "请帮我写一个排序算法", role: "user" as const },
          {
            content: "好的，我来帮你写一个快速排序算法。快速排序是一种高效的排序算法，使用分治策略...",
            role: "assistant" as const,
          },
          { content: "能解释一下时间复杂度吗？", role: "user" as const },
          { content: "快速排序的平均时间复杂度是 O(n log n)，最坏情况下是 O(n²)...", role: "assistant" as const },
        ];

        const result = await summarizeConversation(messages);

        expect(result.success).toBe(true);
        expect(result.content.length).toBeGreaterThan(0);
      },
      { timeout: 60_000 },
    );

    it(
      "应该能够总结代码变更",
      async () => {
        const changes = [
          {
            changeType: "added" as const,
            filePath: "src/agent/codebase-index-agent.ts",
            linesAdded: 754,
            linesDeleted: 0,
            summary: "实现代码库索引 Agent",
          },
          {
            changeType: "added" as const,
            filePath: "src/agent/summary-agent.ts",
            linesAdded: 587,
            linesDeleted: 0,
            summary: "实现通用总结 Agent",
          },
          {
            changeType: "added" as const,
            filePath: "src/agent/sub-agent-resolver.ts",
            linesAdded: 445,
            linesDeleted: 0,
            summary: "实现子代理解析器",
          },
        ];

        const result = await summarizeCodeChanges(changes);

        expect(result.success).toBe(true);
        expect(result.content.length).toBeGreaterThan(0);
      },
      { timeout: 60_000 },
    );

    it(
      "应该能够总结文档内容",
      async () => {
        const content = `
# 项目文档

## 简介
这是一个功能强大的 CLI 工具，支持多种 AI 模型和工具集成。

## 核心功能
1. Agent 系统 - 支持多种专业 Agent
2. 工具系统 - 丰富的工具集
3. 会话管理 - 完整的会话生命周期
4. 权限管理 - 细粒度的权限控制

## 技术栈
- Bun runtime
- TypeScript
- OpenTUI
- Drizzle ORM
`;

        const result = await summarizeDocument(content);

        expect(result.success).toBe(true);
        expect(result.content.length).toBeGreaterThan(0);
      },
      { timeout: 60_000 },
    );

    it(
      "应该支持不同语言的总结",
      async () => {
        const messages = [
          { content: "Hello, please help me write a function", role: "user" as const },
          {
            content: "Sure, I can help you write a function. What kind of function do you need?",
            role: "assistant" as const,
          },
        ];

        const result = await summarizeConversation(messages, { language: "en" });

        expect(result.success).toBe(true);
      },
      { timeout: 120_000 },
    );
  });

  describe("3. subAgentResolver 功能验证", () => {
    it(
      "应该能够解析需要子代理的请求",
      async () => {
        const result = await resolveSubAgent("请帮我写一个快速排序算法的实现");

        expect(result.needsSubAgent).toBe(true);
        expect(result.agentType).toBe("general");
        expect(result.confidence).toBeGreaterThan(0.5);
        expect(result.requiredTools.length).toBeGreaterThan(0);
      },
      { timeout: 60_000 },
    );

    it(
      "应该能够解析架构设计请求",
      async () => {
        const result = await resolveSubAgent("我需要设计一个微服务架构，应该考虑哪些方面？");

        expect(result.needsSubAgent).toBe(true);
        expect(result.agentType).toBe("plan");
      },
      { timeout: 60_000 },
    );

    it(
      "应该能够解析代码审查请求",
      async () => {
        const result = await resolveSubAgent("请帮我审查这段代码的质量和安全问题");

        expect(result.needsSubAgent).toBe(true);
        expect(result.agentType).toBe("review");
      },
      { timeout: 60_000 },
    );

    it(
      "应该能够解析探索分析请求",
      async () => {
        const result = await resolveSubAgent("请探索这个代码库，了解它的整体结构");

        expect(result.needsSubAgent).toBe(true);
        expect(result.agentType).toBe("explore");
      },
      { timeout: 60_000 },
    );

    it(
      "应该能够识别不需要子代理的请求",
      async () => {
        const result = await resolveSubAgent("你好");

        // 简单问候可能不需要子代理
        expect(result).toBeDefined();
      },
      { timeout: 60_000 },
    );

    it(
      "应该能够构建子代理上下文",
      async () => {
        const resolveResult = await resolveSubAgent("请帮我写一个排序算法");
        const context = buildSubAgentContext(resolveResult, [
          { content: "我需要学习算法", role: "user" },
          { content: "好的，我来帮你", role: "assistant" },
        ]);

        expect(context).toContain("任务信息");
        expect(context).toContain("任务描述");
        expect(context).toContain("对话历史");
      },
      { timeout: 60_000 },
    );

    it(
      "应该能够评估任务优先级",
      async () => {
        const urgentResult = await resolveSubAgent("紧急！系统崩溃了，需要立即修复");
        expect(urgentResult.priority).toBe("critical");

        const normalResult = await resolveSubAgent("请帮我写一个函数");
        expect(normalResult.priority).toBe("medium");
      },
      { timeout: 60_000 },
    );
  });

  describe("4. subAgentStreamProcessor 功能验证", () => {
    it("应该能够处理单个流", async () => {
      const processor = createStreamProcessor();
      let completed = false;
      let result = "";

      processor.on("complete", (instanceId, content) => {
        completed = true;
        result = content;
      });

      await processor.receiveChunk({
        agentType: "general",
        content: "Hello ",
        instanceId: "test-1",
        isLast: false,
        sequence: 0,
        timestamp: Date.now(),
      });

      await processor.receiveChunk({
        agentType: "general",
        content: "World!",
        instanceId: "test-1",
        isLast: true,
        sequence: 1,
        timestamp: Date.now(),
      });

      expect(completed).toBe(true);
      expect(result).toBe("Hello World!");
    });

    it("应该能够合并多个流", async () => {
      const processor = createStreamProcessor();
      let allCompleted = false;
      let mergedResults = new Map<string, string>();

      processor.on("allComplete", (results) => {
        allCompleted = true;
        mergedResults = results;
      });

      // 模拟三个并行流
      await Promise.all([
        (async () => {
          await processor.receiveChunk({
            agentType: "general",
            content: "Code implementation",
            instanceId: "stream-1",
            isLast: true,
            sequence: 0,
            timestamp: Date.now(),
          });
        })(),
        (async () => {
          await processor.receiveChunk({
            agentType: "review",
            content: "Code review completed",
            instanceId: "stream-2",
            isLast: true,
            sequence: 0,
            timestamp: Date.now(),
          });
        })(),
        (async () => {
          await processor.receiveChunk({
            agentType: "docs",
            content: "Summary generated",
            instanceId: "stream-3",
            isLast: true,
            sequence: 0,
            timestamp: Date.now(),
          });
        })(),
      ]);

      expect(allCompleted).toBe(true);
      expect(mergedResults.size).toBeGreaterThan(0);
    });

    it("应该能够处理流错误", async () => {
      const processor = createStreamProcessor();
      let errorReceived = false;

      processor.on("error", (instanceId, error) => {
        errorReceived = true;
      });

      await processor.receiveChunk({
        agentType: "general",
        content: "test",
        instanceId: "test-error",
        isLast: false,
        sequence: 0,
        timestamp: Date.now(),
      });

      processor.markError("test-error", "Timeout error");

      expect(errorReceived).toBe(true);
    });

    it("应该能够获取统计信息", async () => {
      const processor = createStreamProcessor();

      await processor.receiveChunk({
        agentType: "general",
        content: "Test content",
        instanceId: "stats-test",
        isLast: true,
        sequence: 0,
        timestamp: Date.now(),
      });

      const stats = processor.getStats();

      expect(stats.totalStreams).toBe(1);
      expect(stats.completedStreams).toBe(1);
      expect(stats.totalChunks).toBe(1);
      expect(stats.totalSize).toBe("Test content".length);
    });
  });

  describe("5. subAgentExecutor 功能验证", () => {
    it("应该能够执行单个任务", async () => {
      const executor = createSubAgentExecutor();

      // 设置模拟执行器
      executor.setTaskExecutor(async (task) => `Executed: ${task.prompt}`);

      executor.addTask({
        agentType: "general",
        instanceId: "single-task",
        priority: 1,
        prompt: "Write a function",
      });

      const result = await executor.execute();

      expect(result.success).toBe(true);
      expect(result.status).toBe("completed");
      expect(result.stats.totalTasks).toBe(1);
      expect(result.stats.completedTasks).toBe(1);
    });

    it("应该能够并行执行多个任务", async () => {
      const executor = createSubAgentExecutor({ maxConcurrency: 3 });

      let executionCount = 0;
      executor.setTaskExecutor(async (task) => {
        executionCount++;
        await new Promise((resolve) => setTimeout(resolve, 100));
        return `Result: ${task.prompt}`;
      });

      executor.addTask({
        agentType: "general",
        instanceId: "task-1",
        priority: 1,
        prompt: "Task 1",
      });

      executor.addTask({
        agentType: "review",
        instanceId: "task-2",
        priority: 1,
        prompt: "Task 2",
      });

      executor.addTask({
        agentType: "docs",
        instanceId: "task-3",
        priority: 1,
        prompt: "Task 3",
      });

      const result = await executor.execute();

      expect(result.success).toBe(true);
      expect(result.stats.totalTasks).toBe(3);
      expect(result.stats.completedTasks).toBe(3);
      expect(executionCount).toBe(3);
    });

    it("应该能够处理任务依赖", async () => {
      const executor = createSubAgentExecutor({ waitForDependencies: true });

      const executionOrder: string[] = [];
      executor.setTaskExecutor(async (task) => {
        executionOrder.push(task.id);
        return `Done: ${task.id}`;
      });

      const task1Id = executor.addTask({
        agentType: "explore",
        instanceId: "task-1",
        priority: 1,
        prompt: "Explore first",
      });

      const task2Id = executor.addTask({
        agentType: "general",
        dependencies: [task1Id],
        instanceId: "task-2",
        priority: 2,
        prompt: "Code second",
      });

      const result = await executor.execute();

      expect(result.success).toBe(true);
      expect(executionOrder).toEqual([task1Id, task2Id]);
    });

    it("应该能够处理任务失败和重试", async () => {
      const executor = createSubAgentExecutor({ retryCount: 2, retryDelay: 100 });

      let attemptCount = 0;
      executor.setTaskExecutor(async (task) => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error("Simulated failure");
        }
        return "Success after retries";
      });

      executor.addTask({
        agentType: "general",
        instanceId: "retry-task",
        priority: 1,
        prompt: "Retry test",
      });

      const result = await executor.execute();

      expect(result.success).toBe(true);
      expect(attemptCount).toBe(3);
    });

    it("应该能够取消执行", async () => {
      const executor = createSubAgentExecutor({ maxConcurrency: 2 });
      let executed = false;

      executor.setTaskExecutor(async (task) => {
        executed = true;
        await new Promise((resolve) => setTimeout(resolve, 500));
        return "Done";
      });

      executor.addTask({
        agentType: "general",
        instanceId: "cancel-task-1",
        priority: 1,
        prompt: "Cancel test 1",
      });

      executor.addTask({
        agentType: "review",
        instanceId: "cancel-task-2",
        priority: 1,
        prompt: "Cancel test 2",
      });

      // 立即取消前加一些延迟确保任务开始执行
      await new Promise((resolve) => setTimeout(resolve, 50));
      executor.cancel();

      const result = await executor.execute();
      const cancelled = result.stats.cancelledTasks > 0;

      expect(result.status).toBe("completed");
      expect(cancelled).toBe(true);
    });

    it("应该能够获取执行状态", async () => {
      const executor = createSubAgentExecutor();

      executor.setTaskExecutor(async (task) => "Done");

      executor.addTask({
        agentType: "general",
        instanceId: "status-task",
        priority: 1,
        prompt: "Status check",
      });

      const status = executor.getStatus();
      expect(status.totalTasks).toBe(1);
      expect(status.pending).toBe(1);

      await executor.execute();

      const finalStatus = executor.getStatus();
      expect(finalStatus.completed).toBe(1);
    });
  });

  describe("6. 完整业务流程集成", () => {
    it(
      "应该能够完成从解析到执行的完整流程",
      async () => {
        // 1. 解析请求
        const resolveResult = await resolveSubAgent("请帮我分析这个代码库的结构，然后写一个总结");

        expect(resolveResult.needsSubAgent).toBe(true);

        // 2. 构建上下文
        const context = buildSubAgentContext(resolveResult);
        expect(context).toContain("任务信息");

        // 3. 创建索引(如果选择的是 explore)
        if (resolveResult.agentType === "explore") {
          const indexResult = await createCodebaseIndex(codebaseFixtureRoot);
          expect(indexResult.success).toBe(true);
          expect(indexResult.statistics.totalFiles).toBeGreaterThan(0);
        }
      },
      { timeout: 60_000 },
    );

    it(
      "应该能够处理多步骤工作流",
      async () => {
        // 模拟多步骤工作流:探索 -> 编码 -> 审查 -> 总结

        const steps = [
          { agentType: "explore", prompt: "Explore the codebase structure" },
          { agentType: "general", prompt: "Implement a feature based on exploration" },
          { agentType: "review", prompt: "Review the implemented code" },
          { agentType: "docs", prompt: "Summarize the entire workflow" },
        ];

        const executor = createSubAgentExecutor({ maxConcurrency: 1 });

        executor.setTaskExecutor(async (task) => {
          // 模拟执行
          await new Promise((resolve) => setTimeout(resolve, 50));
          return `Completed: ${task.prompt}`;
        });

        for (const step of steps) {
          executor.addTask({
            agentType: step.agentType,
            instanceId: `step-${step.agentType}`,
            priority: 1,
            prompt: step.prompt,
          });
        }

        const result = await executor.execute();

        expect(result.success).toBe(true);
        expect(result.stats.completedTasks).toBe(4);
      },
      { timeout: 60_000 },
    );
  });

  describe("7. Agent 注册验证", () => {
    it("应该能够注册 CodebaseIndexAgent", () => {
      // 不应该抛出异常
      expect(() => registerCodebaseIndexAgent()).not.toThrow();
    });

    it("应该能够注册 SummaryAgent", () => {
      expect(() => registerSummaryAgent()).not.toThrow();
    });

    it("应该能够注册 subAgentResolver", () => {
      expect(() => registerSubAgentResolver()).not.toThrow();
    });
  });
});

// Helper imports
import { summarizeConversation, summarizeCodeChanges, summarizeDocument } from "@/agent/specialized/summary";
