/**
 * Review Agent 单元测试
 *
 * 测试覆盖:
 *   - Review Agent 基本功能
 *   - 类型定义
 */

import { describe, expect, it } from "bun:test";
import {
  type ReviewConfig,
  type ReviewIssue,
  type ReviewResult,
  formatReviewResult,
  registerReviewAgent,
  reviewCode,
} from "@/agent/specialized/review";
import type { AppConfigSchema } from "@/schema/config";

describe("Review Agent", () => {
  const mockConfig = {} as AppConfigSchema;

  describe("基本功能", () => {
    it("should export reviewCode function", () => {
      expect(typeof reviewCode).toBe("function");
    });

    it("should export formatReviewResult function", () => {
      expect(typeof formatReviewResult).toBe("function");
    });

    it("should export registerReviewAgent function", () => {
      expect(typeof registerReviewAgent).toBe("function");
    });
  });

  describe("formatReviewResult", () => {
    it("should format review with no issues", () => {
      const result: ReviewResult = {
        issues: [],
        scope: "暂存区变更",
        stats: { critical: 0, info: 0, major: 0, minor: 0, total: 0 },
        success: true,
        summary: "代码质量良好",
      };

      const formatted = formatReviewResult(result);

      expect(formatted).toContain("代码审查报告");
      expect(formatted).toContain("暂存区变更");
      expect(formatted).toContain("未发现明显问题");
    });

    it("should format review with issues", () => {
      const result: ReviewResult = {
        issues: [
          {
            description: "SQL 注入",
            filePath: "auth.ts",
            line: 10,
            severity: "critical",
            type: "security",
          },
        ],
        scope: "变更",
        stats: { critical: 1, info: 0, major: 0, minor: 0, total: 1 },
        success: true,
        summary: "发现问题",
      };

      const formatted = formatReviewResult(result);

      expect(formatted).toContain("代码审查报告");
      expect(formatted).toContain("SQL 注入");
      expect(formatted).toContain("auth.ts:10");
    });

    it("should format failed review", () => {
      const result: ReviewResult = {
        error: "Git 命令执行失败",
        issues: [],
        scope: "暂存区变更",
        stats: { critical: 0, info: 0, major: 0, minor: 0, total: 0 },
        success: false,
        summary: "审查失败",
      };

      const formatted = formatReviewResult(result);

      expect(formatted).toContain("审查失败");
      expect(formatted).toContain("Git 命令执行失败");
    });
  });

  describe("类型定义", () => {
    it("should have correct ReviewIssue structure", () => {
      const issue: ReviewIssue = {
        description: "Test issue",
        filePath: "test.ts",
        severity: "major",
        type: "bug",
      };

      expect(issue.severity).toBe("major");
      expect(issue.type).toBe("bug");
      expect(issue.filePath).toBe("test.ts");
    });

    it("should have correct ReviewResult structure", () => {
      const result: ReviewResult = {
        issues: [],
        scope: "test",
        stats: {
          critical: 0,
          info: 0,
          major: 0,
          minor: 0,
          total: 0,
        },
        success: true,
        summary: "Test summary",
      };

      expect(result.success).toBe(true);
      expect(result.stats.total).toBe(0);
    });
  });
});
