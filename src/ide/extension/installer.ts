/**
 * VSCode 扩展安装器 — 安装 crab-cli VSCode 扩展
 *
 * 职责:
 *   - 通过 CLI 命令安装 crab-cli VSCode 扩展
 *   - 检测扩展安装状态
 *   - 发布扩展安装事件到全局事件总线
 *
 * 模块功能:
 *   - installExtension: 安装指定 IDE 的 VSCode 扩展
 *   - isExtensionInstalledCli: 通过 CLI 检测扩展是否已安装
 *   - EXTENSION_ID: crab-cli VSCode 扩展标识符
 *
 * 使用场景:
 *   - 用户首次使用 IDE 集成功能时引导安装
 *   - 扩展未安装时提示用户安装
 *   - 自动化安装脚本集成
 *
 * 边界:
 * 1. 仅负责安装扩展，不负责连接管理
 * 2. 仅支持 VSCode 和 VSCode Insiders
 * 3. 依赖系统已安装对应的 code/code-insiders 命令
 * 4. 需要访问 Visual Studio Marketplace 下载扩展
 *
 * 流程:
 * 1. 调用 installExtension(ide) 开始安装
 * 2. 检测对应的 IDE 命令是否可用(code 或 code-insiders)
 * 3. 执行 code --install-extension crab-dev.crab-cli 命令
 * 4. 解析命令退出码判断安装结果
 * 5. 发布 AppEvent.IDEExtensionInstalled 事件通知结果
 */

import { createLogger } from "@/core/logging/logger";
import { globalBus, type EventBus } from "@/bus";
import { AppEvent } from "@/bus";
import type { ExtensionInstallResult } from "@/ide/types";
import { createIdeError, toIdeLogPayload } from "@/ide/errors";
import { IDE_CLI_COMMANDS } from "@/ide/shared/pathUtils";

const log = createLogger("ide:extension");

/** VSCode 扩展 ID */
const EXTENSION_ID = "crab-dev.crab-cli";

/**
 * 安装 crab-cli VSCode 扩展。
 *
 * @param ide - IDE 名称
 * @returns 安装结果
 */
export async function installExtension(ide: string, eventBus: EventBus = globalBus): Promise<ExtensionInstallResult> {
  const cmd = IDE_CLI_COMMANDS[ide];
  if (!cmd) {
    const error = createIdeError(
      new Error(`未知的 IDE: ${ide}。支持: VSCode, VSCode Insiders`),
      {
        operation: "installExtension.resolveCommand",
        requestType: ide,
      },
      "unsupported_request",
    );
    return { error: error.message, errorCode: error.code, success: false };
  }

  log.info(`开始安装扩展: ${EXTENSION_ID} (${cmd})`);

  try {
    const proc = Bun.spawn([cmd, "--install-extension", EXTENSION_ID], {
      stderr: "pipe",
      stdout: "pipe",
    });

    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    if (exitCode !== 0) {
      const error = createIdeError(
        new Error(`安装失败 (exit=${exitCode}): ${stderr}`),
        {
          operation: "installExtension.spawnExit",
          requestType: ide,
        },
        "handler",
      );
      log.error("扩展安装失败", toIdeLogPayload(error));
      eventBus.publish(AppEvent.IDEExtensionInstalled, { error: error.message, ide, success: false });
      return { error: error.message, errorCode: error.code, success: false };
    }

    log.info(`扩展安装成功: ${EXTENSION_ID}`);
    eventBus.publish(AppEvent.IDEExtensionInstalled, { ide, success: true });
    return { success: true };
  } catch (err) {
    const error = createIdeError(
      err,
      {
        operation: "installExtension",
        requestType: ide,
      },
      "handler",
    );
    log.error("扩展安装异常", toIdeLogPayload(error));
    eventBus.publish(AppEvent.IDEExtensionInstalled, { error: error.message, ide, success: false });
    return { error: `安装异常: ${error.message}`, errorCode: error.code, success: false };
  }
}

/**
 * 检查扩展是否已安装(通过 CLI 查询)。
 */
export async function isExtensionInstalledCli(ide: string): Promise<boolean> {
  const cmd = IDE_CLI_COMMANDS[ide];
  if (!cmd) {
    return false;
  }

  try {
    const proc = Bun.spawn([cmd, "--list-extensions"], {
      stderr: "pipe",
      stdout: "pipe",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      return false;
    }

    const stdout = await new Response(proc.stdout).text();
    return stdout.includes(EXTENSION_ID);
  } catch (err) {
    const error = createIdeError(
      err,
      {
        operation: "isExtensionInstalledCli",
        requestType: ide,
      },
      "handler",
    );
    log.debug("检测 IDE 扩展安装状态失败", toIdeLogPayload(error));
    return false;
  }
}
