/**
 * 框架 + 导航命令。
 *
 * 职责:
 *   - 提供基础框架命令(帮助、清屏、退出、首页)
 *   - 提供页面导航命令(设置、MCP、新建会话)
 *   - 管理应用的导航状态
 *
 * 模块功能:
 *   - buildFrameworkNavigationCommands: 构建框架和导航命令
 *   - app.help: 帮助信息命令
 *   - app.clear: 清屏命令
 *   - app.quit: 退出应用命令
 *   - app.home: 返回首页命令
 *   - app.settings: 设置页面命令
 *   - app.mcp: MCP 管理页面命令
 *   - session.new: 新建会话命令
 *
 * 使用场景:
 *   - 用户需要查看帮助信息
 *   - 用户需要清屏
 *   - 用户需要退出应用
 *   - 用户需要导航到不同页面
 *
 * 边界:
 *   1. 仅提供导航命令，不处理具体业务逻辑
 *   2. 依赖 CommandDeps 中的 navigate 方法
 *   3. 命令执行后通过 EventBus 通知 UI 更新
 *
 * 流程:
 *   1. 接收 CommandDeps 依赖
 *   2. 构建框架和导航命令数组
 *   3. 每个命令调用对应的导航方法
 *   4. 返回命令数组供注册表注册
 */
import type { Command } from "@/commandPalette/types";
import type { CommandDeps } from "../../shared";

export function buildFrameworkNavigationCommands(deps: CommandDeps): Command[] {
  return [
    // ─── 框架命令 ────────────────────────────────────────
    {
      category: "框架",
      description: "显示所有可用命令",
      name: "app.help",
      run: () => {
        deps.navigate({ type: "help" });
      },
      slashName: "help",
      suggested: true,
      title: "帮助信息",
    },
    {
      category: "框架",
      description: "清除当前屏幕内容",
      name: "app.clear",
      run: () => {
        deps.clearScreen?.();
        deps.showToast?.("已清屏", "success");
      },
      slashName: "clear",
      title: "清屏",
    },
    {
      category: "框架",
      description: "退出 crab-cli",
      name: "app.quit",
      run: () => {
        deps.requestExit();
      },
      slashAliases: ["exit", "q"],
      slashName: "quit",
      title: "退出",
    },
    {
      category: "框架",
      description: "导航到欢迎页",
      name: "app.home",
      run: () => {
        deps.navigate({ type: "home" });
      },
      slashName: "home",
      title: "返回首页",
    },

    // ─── 页面导航 ────────────────────────────────────────
    {
      category: "导航",
      description: "打开设置页面",
      name: "app.settings",
      run: () => {
        deps.navigate({ type: "settings" });
      },
      slashName: "settings",
      title: "设置页",
    },
    {
      category: "导航",
      description: "打开 MCP 服务管理页面",
      name: "app.mcp",
      run: () => {
        deps.navigate({ type: "mcp" });
      },
      slashName: "mcp",
      title: "MCP 管理",
    },
    {
      category: "导航",
      description: "创建新的对话会话",
      name: "app.newSession",
      run: () => {
        if (deps.createSession) {
          deps.createSession();
        } else {
          deps.navigate({ type: "session" });
        }
      },
      slashName: "new",
      suggested: true,
      title: "新建会话",
    },
  ];
}
