import { describe, expect, test } from "bun:test";

// ── 从 command-palette.tsx 复制的私有函数 ──

function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
    }
  }
  return qi === q.length;
}

function hl(text: string, query: string): { text: string; matched: boolean }[] {
  if (!query) {
    return [{ matched: false, text }];
  }
  const q = query.toLowerCase();
  let qi = 0;
  const r: { text: string; matched: boolean }[] = [];
  let cur = "";
  let curM = false;
  for (const ch of text) {
    const m = qi < q.length && ch.toLowerCase() === q[qi];
    if (m !== curM || cur === "") {
      if (cur) {
        r.push({ matched: curM, text: cur });
      }
      cur = ch;
      curM = m;
    } else {
      cur += ch;
    }
    if (m) {
      qi++;
    }
  }
  if (cur) {
    r.push({ matched: curM, text: cur });
  }
  return r;
}

// ── fuzzyMatch 测试 ──

describe("fuzzyMatch", () => {
  describe("完全匹配", () => {
    test("精确匹配应返回 true", () => {
      expect(fuzzyMatch("help", "help")).toBe(true);
    });

    test("大小写不敏感应返回 true", () => {
      expect(fuzzyMatch("HELP", "help")).toBe(true);
      expect(fuzzyMatch("help", "HELP")).toBe(true);
      expect(fuzzyMatch("HeLp", "hElP")).toBe(true);
    });
  });

  describe("前缀匹配", () => {
    test("前缀匹配应返回 true", () => {
      expect(fuzzyMatch("hel", "help")).toBe(true);
      expect(fuzzyMatch("set", "settings")).toBe(true);
    });
  });

  describe("模糊匹配", () => {
    test("跳过中间字符应返回 true", () => {
      expect(fuzzyMatch("hp", "help")).toBe(true);
      expect(fuzzyMatch("hl", "help")).toBe(true);
      expect(fuzzyMatch("hlp", "help")).toBe(true);
    });

    test("跨多个单词模糊匹配应返回 true", () => {
      expect(fuzzyMatch("sc", "settings config")).toBe(true);
      expect(fuzzyMatch("tf", "toggle fullscreen")).toBe(true);
    });

    test("乱序但顺序正确应返回 true", () => {
      expect(fuzzyMatch("abc", "aXXbXXc")).toBe(true);
      expect(fuzzyMatch("a1b2", "a1b2c3")).toBe(true);
    });
  });

  describe("不匹配", () => {
    test("字符不存在应返回 false", () => {
      expect(fuzzyMatch("xyz", "help")).toBe(false);
      expect(fuzzyMatch("z", "help")).toBe(false);
    });

    test("顺序错误应返回 false", () => {
      expect(fuzzyMatch("ph", "help")).toBe(false);
      expect(fuzzyMatch("leh", "help")).toBe(false);
    });

    test("空查询应返回 true(所有字符都匹配了 0 个)", () => {
      expect(fuzzyMatch("", "help")).toBe(true);
    });

    test("空目标非空查询应返回 false", () => {
      expect(fuzzyMatch("help", "")).toBe(false);
    });
  });

  describe("边界情况", () => {
    test("单字符查询", () => {
      expect(fuzzyMatch("h", "help")).toBe(true);
      expect(fuzzyMatch("h", "hello")).toBe(true);
      expect(fuzzyMatch("z", "abc")).toBe(false);
    });

    test("相同长度字符串", () => {
      expect(fuzzyMatch("abcd", "abdc")).toBe(false);
      expect(fuzzyMatch("abcd", "abcd")).toBe(true);
    });

    test("特殊字符", () => {
      expect(fuzzyMatch("/help", "/help me")).toBe(true);
      expect(fuzzyMatch("a-b", "aX-b")).toBe(true);
    });
  });
});

// ── hl 高亮函数测试 ──

describe("hl", () => {
  test("空查询应返回整个文本未匹配", () => {
    const result = hl("hello", "");
    expect(result).toEqual([{ matched: false, text: "hello" }]);
  });

  test("精确匹配应全部标记为 matched", () => {
    const result = hl("help", "help");
    expect(result).toEqual([{ matched: true, text: "help" }]);
  });

  test("前缀匹配应正确分割", () => {
    const result = hl("help", "hel");
    expect(result).toEqual([
      { matched: true, text: "hel" },
      { matched: false, text: "p" },
    ]);
  });

  test("模糊匹配应正确分割匹配和非匹配段", () => {
    const result = hl("help", "hp");
    expect(result).toEqual([
      { matched: true, text: "h" },
      { matched: false, text: "el" },
      { matched: true, text: "p" },
    ]);
  });

  test("大小写不敏感高亮", () => {
    const result = hl("Help", "hp");
    expect(result).toEqual([
      { matched: true, text: "H" },
      { matched: false, text: "el" },
      { matched: true, text: "p" },
    ]);
  });

  test("连续匹配字符应合并为一段", () => {
    const result = hl("abcdef", "ace");
    expect(result).toEqual([
      { matched: true, text: "a" },
      { matched: false, text: "b" },
      { matched: true, text: "c" },
      { matched: false, text: "d" },
      { matched: true, text: "e" },
      { matched: false, text: "f" },
    ]);
  });

  test("不匹配查询应全部未匹配", () => {
    const result = hl("help", "xyz");
    expect(result).toEqual([{ matched: false, text: "help" }]);
  });

  test("单字符匹配", () => {
    const result = hl("hello", "e");
    expect(result).toEqual([
      { matched: false, text: "h" },
      { matched: true, text: "e" },
      { matched: false, text: "llo" },
    ]);
  });

  test("多段匹配", () => {
    const result = hl("settings config", "sc");
    expect(result).toEqual([
      { matched: true, text: "s" },
      { matched: false, text: "ettings " },
      { matched: true, text: "c" },
      { matched: false, text: "onfig" },
    ]);
  });
});

// ── 集成测试:fuzzyMatch + hl 组合 ──

describe("fuzzyMatch + hl 组合", () => {
  test("匹配结果应能被 hl 正确高亮", () => {
    const query = "tf";
    const target = "toggle fullscreen";
    expect(fuzzyMatch(query, target)).toBe(true);
    const highlighted = hl(target, query);
    expect(highlighted.some((p) => p.matched)).toBe(true);
  });

  test("不匹配时 hl 应返回全部未匹配", () => {
    const query = "xyz";
    const target = "toggle fullscreen";
    expect(fuzzyMatch(query, target)).toBe(false);
    const highlighted = hl(target, query);
    expect(highlighted.every((p) => !p.matched)).toBe(true);
  });
});
