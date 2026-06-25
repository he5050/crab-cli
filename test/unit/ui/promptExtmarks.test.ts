/**
 * Prompt Extmarks 虚拟文本系统单元测试 [P0-T3]
 *
 * 覆盖核心行为:
 *   - createFileExtmark / createAgentExtmark / createSkillExtmark / createPasteExtmark / createUrlExtmark
 *   - expandExtmarks: 占位符替换为 expandTo
 *   - insertExtmark: 文本插入 + 位置偏移调整
 *   - removeExtmark: 按 ID 移除
 *   - classifyPastedText: URL / 文件路径 / 粘贴文本分类
 *   - shouldFoldPastedText: 多行/长文本折叠判定
 *   - createExtmarkFromPaste: 根据粘贴内容自动创建对应类型 extmark
 */
import { describe, expect, test } from "bun:test";
import {
  PASTE_FOLD_LINE_THRESHOLD,
  classifyPastedText,
  createAgentExtmark,
  createExtmarkFromPaste,
  createFileExtmark,
  createPasteExtmark,
  createSkillExtmark,
  createUrlExtmark,
  expandExtmarks,
  insertExtmark,
  removeExtmark,
  shouldFoldPastedText,
  type Extmark,
} from "@/ui/pages/session/components/promptExtmarks";

describe("createFileExtmark", () => {
  test("创建文件引用 extmark，virtualText 带 @ 前缀", () => {
    const em = createFileExtmark("src/index.ts");
    expect(em.style).toBe("file");
    expect(em.virtualText).toBe("@src/index.ts");
    expect(em.expandTo).toBe("@src/index.ts");
    expect(em.start).toBe(0);
    expect(em.end).toBe(em.start + em.virtualText.length);
    expect(em.id).toBeTruthy();
  });

  test("filePath 已带 @ 前缀时不重复添加", () => {
    const em = createFileExtmark("@config.json");
    expect(em.virtualText).toBe("@config.json");
  });

  test("指定 position 时 start/end 正确", () => {
    const em = createFileExtmark("foo.ts", 10);
    expect(em.start).toBe(10);
    expect(em.end).toBe(10 + em.virtualText.length);
  });
});

describe("createAgentExtmark", () => {
  test("创建 Agent 引用 extmark，virtualText 带 @agent: 前缀", () => {
    const em = createAgentExtmark("builder");
    expect(em.style).toBe("agent");
    expect(em.virtualText).toBe("@agent:builder");
    expect(em.expandTo).toBe("@agent:builder");
  });
});

describe("createSkillExtmark", () => {
  test("创建 Skill 引用 extmark，virtualText 带 @skill: 前缀", () => {
    const em = createSkillExtmark("code-review");
    expect(em.style).toBe("skill");
    expect(em.virtualText).toBe("@skill:code-review");
    expect(em.expandTo).toBe("@skill:code-review");
  });
});

describe("createPasteExtmark", () => {
  test("单行粘贴显示字符数和预览", () => {
    const text = "Hello World";
    const em = createPasteExtmark(text);
    expect(em.style).toBe("paste");
    expect(em.expandTo).toBe(text);
    expect(em.virtualText).toContain("11");
    expect(em.virtualText).toContain("Hello World");
  });

  test("多行粘贴显示行数和字符数", () => {
    const text = "line1\nline2\nline3\nline4";
    const em = createPasteExtmark(text);
    expect(em.virtualText).toContain("4");
    expect(em.virtualText).toContain("line1");
  });

  test("超过 40 字符的单行预览截断", () => {
    const longText = "A".repeat(100);
    const em = createPasteExtmark(longText);
    expect(em.virtualText).toContain("100");
    expect(em.virtualText).toContain("…");
  });
});

describe("createUrlExtmark", () => {
  test("短 URL 原样显示", () => {
    const url = "https://example.com";
    const em = createUrlExtmark(url);
    expect(em.style).toBe("url");
    expect(em.virtualText).toBe(url);
    expect(em.expandTo).toBe(url);
  });

  test("超过 60 字符的 URL 截断并加省略号", () => {
    const url = `https://example.com/${"x".repeat(60)}`;
    const em = createUrlExtmark(url);
    expect(em.virtualText.length).toBeLessThan(url.length);
    expect(em.virtualText).toEndWith("…");
  });
});

describe("expandExtmarks", () => {
  test("无 extmark 时原样返回", () => {
    expect(expandExtmarks("hello world", [])).toBe("hello world");
  });

  test("单个 extmark 替换占位符为 expandTo", () => {
    const text = "Check @src/index.ts please";
    const extmark: Extmark = {
      end: 19,
      expandTo: "@src/index.ts",
      id: "test-1",
      start: 6,
      style: "file",
      virtualText: "@src/index.ts",
    };
    expect(expandExtmarks(text, [extmark])).toBe("Check @src/index.ts please");
  });

  test("多个 extmark 从后往前替换", () => {
    const text = "@file1 and @file2";
    // @file1: 0-6, @file2: 11-17
    const extmarks: Extmark[] = [
      {
        end: 6,
        expandTo: "@file1",
        id: "test-1",
        start: 0,
        style: "file",
        virtualText: "@file1",
      },
      {
        end: 17,
        expandTo: "@file2",
        id: "test-2",
        start: 11,
        style: "file",
        virtualText: "@file2",
      },
    ];
    expect(expandExtmarks(text, extmarks)).toBe("@file1 and @file2");
  });

  test("extmark 占位符与 expandTo 不同时正确替换", () => {
    const text = "Check [chip] please";
    // [chip] at positions 6-12 (6 chars)
    const extmark: Extmark = {
      end: 12,
      expandTo: "@src/index.ts",
      id: "test-1",
      start: 6,
      style: "file",
      virtualText: "[chip]",
    };
    expect(expandExtmarks(text, [extmark])).toBe("Check @src/index.ts please");
  });

  test("extmark 无 expandTo 时使用 virtualText", () => {
    const text = "[chip] done";
    const extmark: Extmark = {
      end: 6,
      expandTo: undefined,
      id: "test-1",
      start: 0,
      style: "paste",
      virtualText: "[chip]",
    };
    expect(expandExtmarks(text, [extmark])).toBe("[chip] done");
  });

  test("粘贴 extmark 展开为完整多行文本", () => {
    const fullText = "line1\nline2\nline3\nline4";
    const virtualText = "[粘贴: 4 行 · 23 字符] line1";
    const text = `Before ${virtualText} After`;
    const extmark: Extmark = {
      end: 7 + virtualText.length,
      expandTo: fullText,
      id: "paste-1",
      start: 7,
      style: "paste",
      virtualText,
    };
    const result = expandExtmarks(text, [extmark]);
    expect(result).toBe(`Before ${fullText} After`);
  });
});

describe("insertExtmark", () => {
  test("在空文本中插入 extmark", () => {
    const em = createFileExtmark("foo.ts", 0);
    const result = insertExtmark("", em, []);
    expect(result.text).toBe("@foo.ts");
    expect(result.extmarks).toHaveLength(1);
    expect(result.extmarks[0]?.start).toBe(0);
    expect(result.extmarks[0]?.end).toBe(7);
  });

  test("在文本末尾插入 extmark", () => {
    const em = createFileExtmark("bar.ts", 5);
    const result = insertExtmark("Hello", em, []);
    expect(result.text).toBe("Hello@bar.ts");
    expect(result.extmarks).toHaveLength(1);
  });

  test("插入新 extmark 后调整现有 extmark 位置", () => {
    // 文本: "abc @old def"
    // @old: start=4, end=8 (4 chars)
    const existing: Extmark[] = [
      {
        end: 8,
        expandTo: "@old",
        id: "old-1",
        start: 4,
        style: "file",
        virtualText: "@old",
      },
    ];
    // 在位置 3 插入 @new.ts (7 字符)
    const newEm = createFileExtmark("new.ts", 3);
    const result = insertExtmark("abc @old def", newEm, existing);
    // 新 extmark 在位置 3 插入 @new.ts (7 字符)
    // 现有 extmark start=4 >= 3，应偏移 4+7=11
    expect(result.extmarks).toHaveLength(2);
    const adjusted = result.extmarks.find((e) => e.id === "old-1");
    expect(adjusted?.start).toBe(11);
    expect(adjusted?.end).toBe(15);
  });

  test("插入位置超出文本长度时夹紧到末尾", () => {
    const em = createFileExtmark("x.ts", 100);
    const result = insertExtmark("short", em, []);
    expect(result.extmarks[0]?.start).toBe(5);
  });
});

describe("removeExtmark", () => {
  test("按 ID 移除 extmark", () => {
    const extmarks: Extmark[] = [
      { end: 5, expandTo: "@a", id: "a", start: 0, style: "file", virtualText: "@a" },
      { end: 10, expandTo: "@b", id: "b", start: 6, style: "file", virtualText: "@b" },
    ];
    const result = removeExtmark(extmarks, "a");
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("b");
  });

  test("移除不存在的 ID 时列表不变", () => {
    const extmarks: Extmark[] = [{ end: 5, expandTo: "@a", id: "a", start: 0, style: "file", virtualText: "@a" }];
    const result = removeExtmark(extmarks, "nonexistent");
    expect(result).toHaveLength(1);
  });

  test("空列表移除返回空列表", () => {
    expect(removeExtmark([], "x")).toEqual([]);
  });
});

describe("classifyPastedText", () => {
  test("HTTP URL 分类为 url", () => {
    expect(classifyPastedText("https://example.com")).toBe("url");
    expect(classifyPastedText("http://foo.bar/baz")).toBe("url");
  });

  test("单行文件路径分类为 file", () => {
    expect(classifyPastedText("src/index.ts")).toBe("file");
    expect(classifyPastedText("./config.json")).toBe("file");
    expect(classifyPastedText("/absolute/path/to/file")).toBe("file");
  });

  test("多行文本分类为 paste", () => {
    expect(classifyPastedText("line1\nline2\nline3")).toBe("paste");
  });

  test("不含 / 的单行文本分类为 paste", () => {
    expect(classifyPastedText("just text")).toBe("paste");
  });
});

describe("shouldFoldPastedText", () => {
  test("超过阈值行数应折叠", () => {
    const lines = Array.from({ length: PASTE_FOLD_LINE_THRESHOLD + 1 }, (_, i) => `line${i}`).join("\n");
    expect(shouldFoldPastedText(lines)).toBe(true);
  });

  test("等于阈值行数不折叠", () => {
    const lines = Array.from({ length: PASTE_FOLD_LINE_THRESHOLD }, (_, i) => `line${i}`).join("\n");
    expect(shouldFoldPastedText(lines)).toBe(false);
  });

  test("超过 200 字符的单行文本应折叠", () => {
    expect(shouldFoldPastedText("x".repeat(201))).toBe(true);
  });

  test("短文本不折叠", () => {
    expect(shouldFoldPastedText("short text")).toBe(false);
  });
});

describe("createExtmarkFromPaste", () => {
  test("URL 粘贴创建 url extmark", () => {
    const em = createExtmarkFromPaste("https://example.com");
    expect(em.style).toBe("url");
  });

  test("文件路径粘贴创建 file extmark", () => {
    const em = createExtmarkFromPaste("src/main.ts");
    expect(em.style).toBe("file");
  });

  test("多行文本粘贴创建 paste extmark", () => {
    const em = createExtmarkFromPaste("line1\nline2\nline3\nline4");
    expect(em.style).toBe("paste");
  });
});
