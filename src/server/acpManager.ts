/**
 * ACP Manager 模块
 *
 * 职责:
 *   - 管理 ACP 服务器的生命周期
 *   - 维护 PID 文件和配置持久化
 *   - 提供服务器状态查询
 *   - 处理服务器启动和停止
 *
 * 模块功能:
 *   - getAcpServerStatus(): 获取 ACP 服务器状态
 *   - startAcpServer(): 启动 ACP 服务器
 *   - stopAcpServer(): 停止 ACP 服务器
 *   - AcpStatus: 状态类型定义
 *   - AcpConfig: 配置类型定义
 *
 * 使用场景:
 *   - 命令行启动 ACP 服务器
 *   - 查询 ACP 服务器运行状态
 *   - 优雅停止 ACP 服务器
 *   - 防止重复启动检测
 *
 * 边界:
 *   1. PID 文件存储在用户数据目录 acp.pid
 *   2. 配置存储在 acp.config.json
 *   3. 进程存活检测使用 kill(pid, 0) 信号
 *   4. 停止时先发送 SIGTERM，超时后发送 SIGKILL
 *   5. 启动前检查是否已在运行
 *
 * 流程:
 *   1. 读取 PID 文件检查进程是否存在
 *   2. 返回服务器状态(运行中/未运行)
 *   3. 启动时检查是否已在运行
 *   4. 导入并启动 acpServer 模块
 *   5. 写入 PID 和配置文件
 *   6. 停止时发送终止信号并等待退出
 *   7. 清理 PID 和配置文件
 */
import { createLogger } from "@/core/logging/logger";
import { createSystemError, createUserError } from "@/core/errors/appError";
import { getDataDir } from "@/config";
import fs from "node:fs";
import path from "node:path";

const log = createLogger("server:acp");

const ACP_PID_FILE = path.join(getDataDir(), "acp.pid");
const ACP_CONFIG_FILE = path.join(getDataDir(), "acp.config.json");

interface AcpConfig {
  port: number;
  startTime: string;
}

interface AcpStatus {
  running: boolean;
  pid?: number;
  port?: number;
  startTime?: string;
}

/** 获取 ACP 服务器状态 */
export async function getAcpServerStatus(): Promise<AcpStatus> {
  try {
    if (!fs.existsSync(ACP_PID_FILE)) {
      return { running: false };
    }

    const pid = parseInt(fs.readFileSync(ACP_PID_FILE, "utf8").trim(), 10);

    // 检查进程是否存在
    try {
      process.kill(pid, 0);
    } catch {
      // 进程不存在，清理 pid 文件
      log.debug(`ACP 进程 ${pid} 不存在，清理 PID 文件`);
      fs.unlinkSync(ACP_PID_FILE);
      return { running: false };
    }

    // 读取配置
    let config: AcpConfig | undefined;
    if (fs.existsSync(ACP_CONFIG_FILE)) {
      try {
        config = JSON.parse(fs.readFileSync(ACP_CONFIG_FILE, "utf8"));
      } catch (error) {
        log.warn(`读取 ACP 配置文件失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return {
      pid,
      port: config?.port,
      running: true,
      startTime: config?.startTime,
    };
  } catch (error) {
    log.error(`获取 ACP 状态失败: ${(error as Error).message}`);
    return { running: false };
  }
}

/** 启动 ACP 服务器 */
export async function startAcpServer(options: { port?: number; host?: string } = {}): Promise<void> {
  const { port = 3001, host } = options;

  // 检查是否已在运行
  const status = await getAcpServerStatus();
  if (status.running) {
    throw createUserError("RESOURCE_EXISTS", `ACP 服务器已在运行 (PID: ${status.pid})`);
  }

  // 启动服务器
  const { startAcpServer: startAcpHttpServer } = await import("./acpServer");
  await startAcpHttpServer({ host, port });

  // 保存 PID
  fs.writeFileSync(ACP_PID_FILE, process.pid.toString());
  fs.writeFileSync(
    ACP_CONFIG_FILE,
    JSON.stringify({
      port,
      startTime: new Date().toISOString(),
    }),
  );

  log.info(`ACP 服务器已启动 (端口: ${port})`);
}

/** 停止 ACP 服务器 */
export async function stopAcpServer(): Promise<void> {
  const status = await getAcpServerStatus();

  if (!status.running) {
    throw createSystemError("PROCESS_EXIT_ERROR", "ACP 服务器未运行");
  }

  try {
    process.kill(status.pid!, "SIGTERM");

    // 等待进程结束
    let attempts = 0;
    while (attempts < 10) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      try {
        process.kill(status.pid!, 0);
      } catch {
        // 进程已结束
        break;
      }
      attempts++;
    }

    // 强制结束
    if (attempts >= 10) {
      try {
        process.kill(status.pid!, "SIGKILL");
      } catch {
        // 忽略错误
      }
    }

    // 清理文件
    if (fs.existsSync(ACP_PID_FILE)) {
      fs.unlinkSync(ACP_PID_FILE);
    }
    if (fs.existsSync(ACP_CONFIG_FILE)) {
      fs.unlinkSync(ACP_CONFIG_FILE);
    }

    log.info(`ACP 服务器已停止 (PID: ${status.pid})`);
  } catch (error) {
    log.error(`停止 ACP 服务器失败: ${(error as Error).message}`);
    throw error;
  }
}
