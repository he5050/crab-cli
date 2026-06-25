/**
 * 开发者模式检测。
 *
 * 职责:
 *   - 通过环境变量快速判断当前是否处于开发者模式
 *   - 作为 @core/devMode 的纯逻辑底座
 *
 * 边界:
 *   1. 无副作用、不读写文件
 *   2. 仅依赖 process.env，不调用任何外部命令
 *   3. 不感知具体的开发者模式行为(由 @core/devMode 承接)
 *
 * 触发条件(任一为真即视为开发者模式):
 *   - CRAB_DEV_MODE=1
 *   - CRAB_DEV=1
 *   - CRAB_DEV=dev
 *   - CRAB_DEV=development
 *   - NODE_ENV=development
 */
export function isDevMode(): boolean {
  return (
    process.env.CRAB_DEV_MODE === "1" ||
    process.env.CRAB_DEV === "1" ||
    process.env.CRAB_DEV === "dev" ||
    process.env.CRAB_DEV === "development" ||
    process.env.NODE_ENV === "development"
  );
}
