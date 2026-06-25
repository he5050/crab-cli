import { describe, it, expect } from "bun:test";
import { escapeHtml, escapeRegex, parsePositiveInt, parseSSHUrl, stripHtmlTags, countMatches } from "@/tool/shared";

describe("@tool/shared — 全量测试", () => {
  // ========================
  // stripHtmlTags
  // ========================
  describe("stripHtmlTags", () => {
    // 基础 HTML 标签移除：普通标签应被清除，仅保留文本内容
    it("应移除基本 HTML 标签并保留文本", () => {
      expect(stripHtmlTags("<p>Hello</p>")).toBe("Hello");
    });

    // 嵌套标签：多层嵌套也应全部被去除
    it("应移除嵌套标签（多层嵌套）", () => {
      expect(stripHtmlTags("<div><p><span>deep</span></p></div>")).toBe("deep");
    });

    // HTML 实体解码：常见实体 &amp; &lt; &gt; &quot; &#39; &nbsp; 应还原为对应字符
    // 注意：末尾 &nbsp; 解码为空格后会被 .trim() 裁掉
    it("应解码常见 HTML 实体", () => {
      expect(stripHtmlTags("&amp; &lt; &gt; &quot; &#39; &nbsp;")).toBe("& < > \" '");
    });

    // 空字符串输入：应返回空字符串
    it("空字符串应返回空字符串", () => {
      expect(stripHtmlTags("")).toBe("");
    });

    // 无 HTML 标签的纯文本：应原样返回（仅 trim）
    it("无 HTML 标签的纯文本应原样返回", () => {
      expect(stripHtmlTags("just plain text")).toBe("just plain text");
    });

    // 自闭合标签：<br /> <img /> 等应被移除
    it("应移除自闭合标签", () => {
      expect(stripHtmlTags("line1<br />line2<hr/>line3")).toBe("line1line2line3");
    });

    // 多个标签连续出现：连续开闭标签应全部移除
    it("应移除多个连续出现的标签", () => {
      expect(stripHtmlTags("<b><i><u>styled</u></i></b>")).toBe("styled");
    });

    // 标签与实体混合：先去标签再解码实体
    it("应先去标签再解码实体", () => {
      expect(stripHtmlTags("<p>A &amp; B</p>")).toBe("A & B");
    });
  });

  // ========================
  // countMatches
  // ========================
  describe("countMatches", () => {
    // 精确匹配计数：统计子串非重叠出现次数
    it("应正确统计精确匹配次数", () => {
      expect(countMatches("abcabcabc", "abc")).toBe(3);
    });

    // 搜索串为空字符串：应返回 0
    it("搜索串为空时应返回 0", () => {
      expect(countMatches("anything", "")).toBe(0);
    });

    // 无匹配：应返回 0
    it("无匹配时应返回 0", () => {
      expect(countMatches("hello world", "xyz")).toBe(0);
    });

    // 重叠模式：按非重叠方式计数，"aaa" 中搜 "aa" 应为 1 而非 2
    it("重叠模式应按非重叠方式计数", () => {
      expect(countMatches("aaa", "aa")).toBe(1);
    });

    // 单字符匹配：多次出现
    it("应正确统计单字符多次出现", () => {
      expect(countMatches("mississippi", "s")).toBe(4);
    });

    // 文本与搜索完全相同：应返回 1
    it("文本与搜索串完全相同时应返回 1", () => {
      expect(countMatches("exact", "exact")).toBe(1);
    });
  });

  // ========================
  // escapeHtml
  // ========================
  describe("escapeHtml", () => {
    // null 输入：应返回空字符串
    it("null 输入应返回空字符串", () => {
      expect(escapeHtml(null)).toBe("");
    });

    // undefined 输入：应返回空字符串
    it("undefined 输入应返回空字符串", () => {
      expect(escapeHtml(undefined)).toBe("");
    });

    // 空字符串：应返回空字符串
    it("空字符串应返回空字符串", () => {
      expect(escapeHtml("")).toBe("");
    });

    // 包含所有特殊字符的字符串：& < > " ' 都应被转义
    it("应转义所有特殊字符（& < > \" '）", () => {
      expect(escapeHtml("Tom & Jerry < > \" '")).toBe("Tom &amp; Jerry &lt; &gt; &quot; &#39;");
    });

    // 不含特殊字符的纯文本：应原样返回
    it("不含特殊字符的纯文本应原样返回", () => {
      expect(escapeHtml("hello world")).toBe("hello world");
    });
  });

  // ========================
  // parsePositiveInt
  // ========================
  describe("parsePositiveInt", () => {
    // 正整数字符串：应返回对应数值
    it("正整数字符串应返回对应数值", () => {
      expect(parsePositiveInt("42")).toBe(42);
    });

    // 零：不满足 > 0 条件，无 fallback 时返回 undefined
    it("零应返回 undefined（无 fallback）", () => {
      expect(parsePositiveInt("0")).toBeUndefined();
    });

    // 负数：不满足 > 0 条件，有 fallback 时返回 fallback
    it("负数应返回 fallback", () => {
      expect(parsePositiveInt("-5", 99)).toBe(99);
    });

    // 浮点数字符串：parseInt 截断后如果 > 0 则返回截断值
    it("浮点数字符串应截断为整数", () => {
      expect(parsePositiveInt("3.7")).toBe(3);
    });

    // Number 类型输入：应正确处理
    it("Number 类型正整数应正确处理", () => {
      expect(parsePositiveInt(10)).toBe(10);
    });

    // Number 类型零：应返回 undefined
    it("Number 类型零应返回 undefined", () => {
      expect(parsePositiveInt(0)).toBeUndefined();
    });

    // 非数字字符串：应返回 fallback
    it("非数字字符串应返回 fallback", () => {
      expect(parsePositiveInt("abc", 7)).toBe(7);
    });

    // null 带 fallback：应返回 fallback
    it("null 带 fallback 应返回 fallback", () => {
      expect(parsePositiveInt(null, 1)).toBe(1);
    });

    // undefined 无 fallback：应返回 undefined
    it("undefined 无 fallback 应返回 undefined", () => {
      expect(parsePositiveInt(undefined)).toBeUndefined();
    });
  });

  // ========================
  // escapeRegex
  // ========================
  describe("escapeRegex", () => {
    it("应转义正则特殊字符", () => {
      expect(escapeRegex("file.txt")).toBe(String.raw`file\.txt`);
    });

    it("应转义多个特殊字符", () => {
      expect(escapeRegex("a+b*c?d")).toBe(String.raw`a\+b\*c\?d`);
    });

    it("无特殊字符应原样返回", () => {
      expect(escapeRegex("hello")).toBe("hello");
    });

    it("空字符串应返回空字符串", () => {
      expect(escapeRegex("")).toBe("");
    });

    it("转义结果应可安全用于 new RegExp 字面量匹配", () => {
      const input = "price: $10.00 (USD)";
      const escaped = escapeRegex(input);
      const re = new RegExp(escaped);
      expect(re.test(input)).toBe(true);
      expect(re.test("price: $20.00")).toBe(false);
    });
  });

  // ========================
  // parseSSHUrl
  // ========================
  describe("parseSSHUrl", () => {
    it("应解析标准 SSH URL", () => {
      const result = parseSSHUrl("ssh://user@host.example.com");
      expect(result).toEqual({ host: "host.example.com", path: "", port: 22, username: "user" });
    });

    it("应解析带端口和路径的 SSH URL", () => {
      const result = parseSSHUrl("ssh://admin@192.168.1.1:2222/var/log/app.log");
      expect(result).toEqual({ host: "192.168.1.1", path: "/var/log/app.log", port: 2222, username: "admin" });
    });

    it("无路径时应返回空路径字符串", () => {
      const result = parseSSHUrl("ssh://deploy@ci.server.com:8022");
      expect(result).not.toBeNull();
      expect(result!.path).toBe("");
      expect(result!.port).toBe(8022);
    });

    it("非法 URL 格式应返回 null", () => {
      expect(parseSSHUrl("")).toBeNull();
      expect(parseSSHUrl("http://user@host")).toBeNull();
      expect(parseSSHUrl("ssh://host")).toBeNull(); // 缺少用户名
    });
  });
});
