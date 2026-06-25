/**
 * Logo 组件
 *
 * 职责:
 *   - 显示 Crab CLI 品牌标志和版本信息
 *   - 提供应用启动时的品牌展示
 *
 * 模块功能:
 *   - 渲染 ASCII 艺术风格的 Crab 图标
 *   - 显示应用名称和版本号
 *   - 显示应用副标题
 *
 * 使用场景:
 *   - 应用启动时显示欢迎界面
 *   - 帮助/关于页面展示品牌信息
 *   - 需要展示应用标识的场景
 *
 * 边界:
 *   1. 使用固定的 ASCII 艺术 Logo
 *   2. 版本号从 @core/version 导入
 *   3. 颜色使用主题色的 primary 和 accent
 *
 * 流程:
 *   1. 获取主题颜色
 *   2. 渲染 Logo ASCII 艺术
 *   3. 渲染应用名称和版本
 *   4. 渲染副标题
 */
import { useTheme } from "@/ui/contexts/theme";
import { VERSION } from "@/config/version";

const LOGO = `
    🦀
   ╱╲╱╲
  ╱    ╲
 ╱ Crab ╲
╱  CLI   ╲
`;

export function Logo() {
  const theme = useTheme();
  return (
    <box flexDirection="column" alignItems="center" gap={1}>
      <text fg={theme.colors.primary}>{LOGO}</text>
      <text fg={theme.colors.accent}>
        <b>{`Crab CLI v${VERSION}`}</b>
      </text>
      <text fg={theme.colors.muted}>{"终端智能编程助手"}</text>
    </box>
  );
}
