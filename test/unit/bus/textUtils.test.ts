/**
 * Text-utils 白盒测试 — Unicode 码点、视觉宽度、格式化工具。
 */
import { describe, expect, test } from "bun:test";
import {
  codePointToVisualPos,
  cpLen,
  cpSlice,
  formatBytes,
  formatUptime,
  stripAnsi,
  toCodePoints,
  truncate,
  visualPosToCodePoint,
  visualWidth,
  wordWrap,
} from "@/core/utilities/textUtils";

describe("toCodePoints", () => {
  test("ascii", () => {
    expect(toCodePoints("abc")).toEqual(["a", "b", "c"]);
  });
  test("空字符串", () => {
    expect(toCodePoints("")).toEqual([]);
  });
  test("CJK", () => {
    expect(toCodePoints("你好")).toEqual(["你", "好"]);
  });
  test("emoji", () => {
    expect(toCodePoints("🎉")).toEqual(["🎉"]);
  });
});

describe("cpLen", () => {
  test("ascii", () => {
    expect(cpLen("abc")).toBe(3);
  });
  test("CJK", () => {
    expect(cpLen("你好")).toBe(2);
  });
  test("emoji", () => {
    expect(cpLen("🎉")).toBe(1);
  });
  test("空", () => {
    expect(cpLen("")).toBe(0);
  });
});

describe("cpSlice", () => {
  test("ASCII 切片", () => {
    expect(cpSlice("abcdef", 1, 3)).toBe("bc");
  });
  test("CJK 切片到末尾", () => {
    expect(cpSlice("你好世界", 1)).toBe("好世界");
  });
  test("CJK 带结束索引", () => {
    expect(cpSlice("你好世界", 1, 3)).toBe("好世");
  });
  test("越界索引", () => {
    expect(cpSlice("abc", 0, 100)).toBe("abc");
  });
});

describe("visualWidth", () => {
  test("ascii", () => {
    expect(visualWidth("abc")).toBe(3);
  });
  test("CJK 每字符 2 列", () => {
    expect(visualWidth("你好")).toBe(4);
  });
  test("emoji 2 列", () => {
    expect(visualWidth("🎉")).toBe(2);
  });
  test("空字符串", () => {
    expect(visualWidth("")).toBe(0);
  });
  test("混合 ASCII+CJK", () => {
    expect(visualWidth("a你b")).toBe(4);
  });
});

describe("codePointToVisualPos", () => {
  test("纯 ASCII", () => {
    expect(codePointToVisualPos("abc", 2)).toBe(2);
  });
  test("CJK 偏移", () => {
    expect(codePointToVisualPos("你好ab", 2)).toBe(4);
  });
  test("索引 0", () => {
    expect(codePointToVisualPos("hello", 0)).toBe(0);
  });
});

describe("visualPosToCodePoint", () => {
  test("纯 ASCII", () => {
    expect(visualPosToCodePoint("abc", 2)).toBe(2);
  });
  test("CJK 位置→码点", () => {
    expect(visualPosToCodePoint("你好ab", 4)).toBe(2);
  });
  test("位置 0", () => {
    expect(visualPosToCodePoint("abc", 0)).toBe(0);
  });
  test("超出宽度→末尾", () => {
    expect(visualPosToCodePoint("ab", 100)).toBe(2);
  });
});

describe("截断", () => {
  test("短文本不截断", () => {
    expect(truncate("hi", 10)).toBe("hi");
  });
  test("长文本截断加省略号", () => {
    expect(truncate("hello world", 8)).toBe("hello...");
  });
  test("恰好 maxLength", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });
  test("自定义后缀", () => {
    expect(truncate("hello world", 8, "…")).toBe("hello w…");
  });
});

describe("formatBytes", () => {
  test("0B", () => {
    expect(formatBytes(0)).toBe("0B");
  });
  test("512B", () => {
    expect(formatBytes(512)).toBe("512B");
  });
  test("1KB", () => {
    expect(formatBytes(1024)).toBe("1.0KB");
  });
  test("1MB", () => {
    expect(formatBytes(1_048_576)).toBe("1.0MB");
  });
  test("1GB", () => {
    expect(formatBytes(1_073_741_824)).toBe("1.0GB");
  });
});

describe("formatUptime", () => {
  test("0 秒", () => {
    expect(formatUptime(0)).toBe("00:00:00");
  });
  test("3661 秒 = 01:01:01", () => {
    expect(formatUptime(3661)).toBe("01:01:01");
  });
  test("86400 秒 = 24:00:00", () => {
    expect(formatUptime(86_400)).toBe("24:00:00");
  });
});

describe("stripAnsi", () => {
  test("移除颜色代码", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red");
  });
  test("无 ANSI", () => {
    expect(stripAnsi("plain")).toBe("plain");
  });
  test("复杂 ANSI", () => {
    expect(stripAnsi("\x1b[1;32;40mbold\x1b[0m")).toBe("bold");
  });
});

describe("wordWrap", () => {
  test("短词不换行", () => {
    expect(wordWrap("hi", 10)).toEqual(["hi"]);
  });
  test("按宽度换行", () => {
    expect(wordWrap("hello world foo", 8)).toEqual(["hello", "world", "foo"]);
  });
  test("空字符串", () => {
    expect(wordWrap("", 10)).toEqual([]);
  });
});
