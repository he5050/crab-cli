/**
 * Welcome 页面
 *
 * 职责:
 *   - 提供向后兼容的欢迎页面导出
 *   - 委托到 Home 页面实现
 *
 * 模块功能:
 *   - 直接导出 Home 组件
 *
 * 使用场景:
 *   - 旧代码引用 Welcome 时保持兼容
 *   - 启动应用时显示欢迎界面
 *
 * 边界:
 *   1. 已废弃，仅保留向后兼容
 *   2. 所有功能委托给 Home 页面
 *
 * 流程:
 *   1. 导入并重新导出 Home 组件
 */
import { Home } from "@/ui/pages/home";

export function Welcome() {
  return <Home />;
}
