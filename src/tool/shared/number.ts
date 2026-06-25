/**
 * 将输入值解析为正整数，解析失败时返回 fallback
 * @param value - 输入值（字符串或数字）
 * @param fallback - 解析失败时的回退值
 * @returns 正整数或 undefined
 */
/** parsePositiveInt 的实现 */
export function parsePositiveInt(value: string | number | null | undefined): number | undefined;
/** 函数重载签名：带 fallback 时返回 number，否则返回 number | undefined */
export function parsePositiveInt(value: string | number | null | undefined, fallback: number): number;
export function parsePositiveInt(value: string | number | null | undefined, fallback?: number): number | undefined {
  const parsed = Number.parseInt(value === null || value === undefined ? "" : String(value), 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}
