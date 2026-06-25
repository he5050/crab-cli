/**
 * UserMessagePart Markdown 渲染守卫测试 [P2-22]
 *
 * 覆盖"Markdown 不退化"要求:
 *   - Markdown 特征字符(** / # / ` 等)经过预处理后仍保留在内容中，
 *     由 <markdown> 组件消费后呈现为格式化输出(**bold** → 粗体、# heading → 标题)。
 *   - 纯文本(无 Markdown 标记)经预处理后保持不变，避免引入噪声/破坏。
 *   - 预处理管线幂等:连续两次处理等价于一次处理(避免反复重渲染累积副作用)。
 *   - 输入边界:空串、仅空白、HTML 标签、LaTeX 命令都按预期处理。
 *
 * 为什么测预处理管线而不是组件本身？
 *   UserMessagePart 是 Solid JSX 组件，没有可单独导出的纯渲染函数。
 *   实际渲染由 OpenTUI 的 <markdown> 原生组件负责(其行为由 OpenTUI 库保证)。
 *   我们要守护的是"传入 <markdown> 的内容是已净化、稳定的"，这正是预处理管线
 *   的职责，因此把守卫落在管线上。
 */
import { describe, expect, test } from "bun:test";
import { sanitizeMarkdownContent, simpleLatexToUnicode } from "@/ui/components/markdownRenderer";

/** 模拟 UserMessagePart 的预处理管线 */
function preprocessUserContent(content: string): string {
  return simpleLatexToUnicode(sanitizeMarkdownContent(content));
}

describe("UserMessagePart 预处理管线 — Markdown 特征不丢失", () => {
  test("保留 **bold** 标记:预处理后内容仍包含 Markdown 强调符号", () => {
    const input = "请看 **加粗** 这一段";
    const out = preprocessUserContent(input);
    // 预处理不会破坏 Markdown 强调标记；<markdown> 组件会消费它
    expect(out).toContain("**加粗**");
    expect(out).toContain("请看");
  });

  test("保留 # heading 标记:H1/H2 标记不被剥离", () => {
    const input = "# 标题一\n## 标题二\n正文内容";
    const out = preprocessUserContent(input);
    expect(out).toContain("# 标题一");
    expect(out).toContain("## 标题二");
    expect(out).toContain("正文内容");
  });

  test("保留内联代码 `code`:反引号不被剥离", () => {
    const input = "使用 `bun test` 跑测试";
    const out = preprocessUserContent(input);
    expect(out).toContain("`bun test`");
  });

  test("保留链接与列表标记:用户消息里的 Markdown 链接应被 <markdown> 识别", () => {
    const input = "看 [文档](https://example.com) 以及 - item1\n- item2";
    const out = preprocessUserContent(input);
    expect(out).toContain("[文档](https://example.com)");
    expect(out).toContain("- item1");
  });
});

describe("UserMessagePart 预处理管线 — 边界与幂等", () => {
  test("纯文本(无 Markdown 字符)原样保留:不会凭空添加噪声", () => {
    const input = "hello world 你好世界 123";
    const out = preprocessUserContent(input);
    expect(out).toBe(input);
  });

  test("空字符串返回空字符串", () => {
    expect(preprocessUserContent("")).toBe("");
  });

  test("仅空白保持为空白(trim 仅作用在 LaTeX 处理上)", () => {
    // SanitizeMarkdownContent 不动空白；simpleLatexToUnicode 的 .trim() 仅在含 LaTeX 时影响
    const out = preprocessUserContent("   ");
    // 空白应被保留或被 trim 一次，但不应被注入额外字符
    expect(out.length).toBeLessThanOrEqual(3);
  });

  test("HTML/script 标签被 sanitize 修复:非法 ol start 不会原样输出", () => {
    const input = '<ol start="-1"><li>item</li></ol>';
    const out = preprocessUserContent(input);
    // SanitizeMarkdownContent 应把 start="-1" 修正为 start="1"
    expect(out).not.toContain('start="-1"');
    expect(out).toContain('start="1"');
  });

  test(String.raw`LaTeX 符号被转换为 Unicode:\alpha 不再以原始反斜杠命令形式输出`, () => {
    const input = String.raw`数值:\alpha + \beta = \gamma`;
    const out = preprocessUserContent(input);
    expect(out).not.toContain(String.raw`\alpha`);
    expect(out).not.toContain(String.raw`\beta`);
    expect(out).toContain("α");
    expect(out).toContain("β");
    expect(out).toContain("γ");
  });

  test("幂等:连续两次预处理 === 一次预处理(重渲染稳定)", () => {
    const inputs = [
      "**bold** and # heading",
      "plain text only",
      "\\alpha + \\beta with `code`",
      '<ol start="-1"><li>x</li></ol>',
    ];
    for (const input of inputs) {
      const once = preprocessUserContent(input);
      const twice = preprocessUserContent(once);
      expect(twice).toBe(once);
    }
  });
});
