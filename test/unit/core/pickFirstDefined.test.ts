/**
 * pickFirstDefined / pickFirstTruthy 单元测试。
 */
import { describe, expect, test } from "bun:test";
import { pickFirstDefined, pickFirstTruthy } from "@/core/utilities/pickFirstDefined";

describe("pickFirstDefined", () => {
  test("返回第一个非 undefined 值", () => {
    expect(pickFirstDefined("a", "b", "c")).toBe("a");
    expect(pickFirstDefined(undefined, "b", "c")).toBe("b");
    expect(pickFirstDefined(undefined, undefined, "c")).toBe("c");
  });

  test("全部为 undefined 时返回 undefined", () => {
    expect(pickFirstDefined(undefined, undefined, undefined)).toBeUndefined();
    expect(pickFirstDefined()).toBeUndefined();
  });

  test("不跳过 null/0/'' 等 falsy", () => {
    expect(pickFirstDefined(null as null | string, "b")).toBe(null);
    expect(pickFirstDefined(0 as number | string, "b")).toBe(0);
    expect(pickFirstDefined("" as string | string, "b")).toBe("");
  });

  test("复杂对象场景", () => {
    const obj1 = { id: 1 };
    const obj2 = { id: 2 };
    expect(pickFirstDefined(undefined, obj1, obj2)).toBe(obj1);
    expect(pickFirstDefined(obj1, obj2)).toBe(obj1);
  });
});

describe("pickFirstTruthy", () => {
  test("返回第一个真值", () => {
    expect(pickFirstTruthy(null, undefined, "a", "b")).toBe("a");
    expect(pickFirstTruthy(0, "", false, 5)).toBe(5);
  });

  test("全部为假值时返回 undefined", () => {
    expect(pickFirstTruthy(null, undefined, 0, "", false)).toBeUndefined();
  });
});
