/**
 * 状态颜色映射工具 — 通用枚举→颜色值函数工厂。
 *
 * 职责:
 *   - 根据枚举状态返回对应颜色，未匹配时返回 fallback
 *
 * 模块功能:
 *   - createStatusColorMap: 状态→颜色映射工厂
 */
type ColorMap<T extends string> = Partial<Record<T, string>>;

export function createStatusColorMap<T extends string>(mapping: ColorMap<T>, fallback: string): (status: T) => string {
  return (status: T) => mapping[status] ?? fallback;
}
