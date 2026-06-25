/**
 * FirstRunOverlay — 首次引导 [P2-21]
 *
 * 职责:
 *   - 在用户首次启动 crab-cli 时展示一次性欢迎引导
 *   - 提供 / 命令、IDE bridge、MCP 工具、会话持久化 4 个能力点的快速预览
 *   - 监听 Enter/Esc 关闭并回调 props.onDismiss
 *
 * 模块功能:
 *   - 渲染 DialogOverlay 框架(与现有弹窗视觉一致)
 *   - 直接 useKeyboard 处理 Enter/Esc(FirstRun 是唯一屏面元素，不需要走 escBehavior 表)
 *   - 调用 props.onDismiss 即可，状态持久化由父组件负责
 *
 * 使用场景:
 *   - app.tsx 在 route tree 上方条件渲染(firstRun() === true)
 *   - onDismiss 回调中执行 markDismissed() + setFirstRun(false)
 *
 * 边界:
 *   1. 组件本身不读取文件 / 不持有首启判定:parent 完全控制显示时机
 *   2. Esc/Enter 任一触发都视为关闭(YAGNI:单按钮引导无需分支)
 *   3. DialogOverlay 已包含遮罩，无需额外遮罩层
 *   4. 关闭动作不可中断:onDismiss 不接受第二次触发
 *
 * 流程:
 *   1. useKeyboard 监听全局按键
 *   2. Enter/Esc 命中即调用 onDismiss(parent 负责持久化 + 状态翻转)
 *   3. DialogOverlay 卸载后，Home 等正常路由可见
 */
import { useKeyboard } from "@opentui/solid";
import { DialogBody, DialogFooter, DialogHeader, DialogOverlay } from "@/ui/components/dialogUi";
import { useTheme } from "@/ui/contexts/theme";
export { shouldShowFirstRun } from "@/ui/utils/firstRunState";

export interface FirstRunOverlayProps {
  /** 关闭回调:parent 应执行 markDismissed + setFirstRun(false) */
  onDismiss: () => void;
}

interface FeatureBullet {
  key: string;
  text: string;
}

const FEATURES: readonly FeatureBullet[] = [
  { key: "/", text: "/ 命令 — 斜杠指令快速执行常见动作" },
  { key: "IDE", text: "IDE bridge — 跨编辑器上下文感知" },
  { key: "MCP", text: "MCP 工具 — 模型上下文协议扩展" },
  { key: "SESSION", text: "会话持久化 — 自动保存与恢复" },
];

export function FirstRunOverlay(props: FirstRunOverlayProps) {
  const theme = useTheme();
  let dismissed = false;

  useKeyboard((event) => {
    if (dismissed) {
      return;
    }
    const { name } = event as { name?: string };
    if (name === "return" || name === "enter" || name === "escape") {
      dismissed = true;
      props.onDismiss();
    }
  });

  return (
    <DialogOverlay onClose={props.onDismiss} size="medium">
      <DialogHeader title="欢迎使用 crab-cli" />
      <DialogBody>
        <box flexDirection="column" gap={1} paddingTop={1} paddingBottom={1}>
          <text fg={theme.colors.text}>
            这是你的第一次启动，按 <b>Enter</b> 开始，按 <b>Esc</b> 跳过。
          </text>
          <text fg={theme.colors.muted} marginTop={1}>
            {"主要能力"}
          </text>
          {FEATURES.map((f) => (
            <text fg={theme.colors.text}>
              {"  • "}
              <b>[{f.key}]</b>
              {` ${f.text}`}
            </text>
          ))}
        </box>
      </DialogBody>
      <DialogFooter>
        <text fg={theme.colors.muted}>[Enter] 开始 [Esc] 跳过</text>
      </DialogFooter>
    </DialogOverlay>
  );
}
