/**
 * 通用工具 — pickFirstDefined / pickFirstTruthy。
 *
 * 替换代码中反复出现的 `a ?? b ?? c ?? default` 链式回退。
 * 提供类型安全的 pickFirstDefined 与仅接受真值的 pickFirstTruthy 两个变体。
 */

/**
 * 返回第一个非 undefined 值；全部为 undefined 时返回 undefined。
 * 等价于 `a ?? b ?? c ?? undefined`。
 */
export function pickFirstDefined<T>(...values: (T | undefined)[]): T | undefined {
  for (const v of values) {
    if (v !== undefined) {
      return v;
    }
  }
  return undefined;
}

/**
 * 返回第一个真值（falsy: undefined / null / "" / 0 / false / NaN）。
 * 全部为假值时返回 undefined。
 *
 * 注意：与 pickFirstDefined 区别是过滤 null/""/0。
 * 仅在"想要真实值"而非"仅判空"场景使用。
 */
export function pickFirstTruthy<T>(...values: (T | undefined | null | false | 0 | "" | never)[]): T | undefined {
  for (const v of values) {
    if (v) {
      return v as T;
    }
  }
  return undefined;
}
