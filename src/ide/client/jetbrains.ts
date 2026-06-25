/**
 * JetBrains IDE 深度集成 — 与 JetBrains IDE 通信
 *
 * 职责:
 *   - 检测 JetBrains IDE 是否运行
 *   - 通过 IDE REST API 获取编辑器状态
 *   - 提供文件跳转、诊断查询功能
 *
 * 模块功能:
 *   - JetBrainsInstance: JetBrains 实例信息接口
 *   - JetBrainsDiagnostic: JetBrains 诊断信息接口
 *   - detectJetBrains: 检测运行中的 JetBrains IDE
 *   - getEditorContext: 获取编辑器上下文
 *   - getDiagnostics: 获取诊断信息
 *   - goToDefinition: 跳转到定义
 *
 * 使用场景:
 *   - JetBrains IDE 集成
 *   - 跨 IDE 上下文共享
 *
 * 边界:
 * 1. 仅支持 IntelliJ/WebStorm/GoLand 等 JetBrains IDE
 * 2. 需要 IDE 开启内置 HTTP 服务器
 * 3. 使用 IDE REST API 进行通信
 * 4. 实验性功能: REST API 端点需要 JetBrains 插件配合，当前为预留实现
 *
 * 流程:
 * 1. 调用 detectJetBrains 检测 IDE
 * 2. 建立 HTTP 连接
 * 3. 获取编辑器上下文
 * 4. 处理导航和诊断请求
 */
import { createLogger } from "@/core/logging/logger";
import { createIdeError, getIdeErrorMessage, toIdeLogPayload } from "@/ide/errors";

const log = createLogger("ide:jetbrains");

// ─── 类型 ─────────────────────────────────────────────────

export interface JetBrainsInstance {
  product: string;
  version: string;
  port: number;
  token?: string;
}

export interface JetBrainsDiagnostic {
  file: string;
  line: number;
  severity: "error" | "warning" | "info";
  message: string;
  source: string;
}

export interface JetBrainsEditorState {
  activeFile: string;
  selection?: { startLine: number; endLine: number };
  diagnostics: JetBrainsDiagnostic[];
}

// ─── IDE 检测 ──────────────────────────────────────────────

/**
 * 检测本地运行的 JetBrains IDE 实例。
 * JetBrains IDE 会在 build.txt 中写入端口信息。
 * @experimental 需要 JetBrains 插件配合
 */
export async function detectJetBrainsInstances(): Promise<JetBrainsInstance[]> {
  const instances: JetBrainsInstance[] = [];

  // 通过 /tmp/.jetbrains.* 文件检测(Linux/Mac)
  try {
    const glob = new Bun.Glob("/tmp/.jetbrains.*");
    for await (const file of glob.scan()) {
      const content = await Bun.file(file).text();
      try {
        const data = JSON.parse(content);
        if (data.port && data.productCode) {
          instances.push({
            port: data.port,
            product: data.productCode,
            token: data.token,
            version: data.build ?? "unknown",
          });
        }
      } catch (err) {
        const error = createIdeError(
          err,
          {
            filePath: file,
            operation: "detectJetBrainsInstances.parseMetadata",
          },
          "handler",
        );
        log.debug("JetBrains metadata 不是有效 JSON，已跳过", toIdeLogPayload(error));
      }
    }
  } catch (err) {
    const error = createIdeError(
      err,
      {
        operation: "detectJetBrainsInstances",
      },
      "handler",
    );
    log.debug("JetBrains 检测失败", toIdeLogPayload(error));
  }

  return instances;
}

// ─── REST API 调用 ─────────────────────────────────────────

async function jbFetch(instance: JetBrainsInstance, path: string): Promise<Response | null> {
  const url = `http://127.0.0.1:${instance.port}${path}`;
  const headers: Record<string, string> = {};
  if (instance.token) {
    headers["Authorization"] = `Bearer ${instance.token}`;
  }

  try {
    const resp = await fetch(url, { headers, signal: AbortSignal.timeout(3000) });
    return resp;
  } catch (error) {
    log.debug("JetBrains REST 请求失败", {
      error: getIdeErrorMessage(error),
      port: instance.port,
      path,
    });
    return null;
  }
}

/**
 * 获取 JetBrains IDE 的编辑器状态。
 * @experimental 需要 JetBrains 插件配合
 */
export async function getJetBrainsEditorState(instance: JetBrainsInstance): Promise<JetBrainsEditorState | null> {
  const resp = await jbFetch(instance, "/api/editor/state");
  if (!resp?.ok) {
    return null;
  }

  try {
    const data = (await resp.json()) as Record<string, unknown>;
    return {
      activeFile: (data.activeFile as string) ?? "",
      diagnostics: Array.isArray(data.diagnostics) ? (data.diagnostics as JetBrainsDiagnostic[]) : [],
    };
  } catch (err) {
    const error = createIdeError(
      err,
      {
        operation: "getJetBrainsEditorState.parseResponse",
        requestType: "/api/editor/state",
      },
      "handler",
    );
    log.debug("解析 JetBrains editor state 失败", toIdeLogPayload(error));
    return null;
  }
}

/**
 * 获取 JetBrains IDE 的诊断信息。
 * @experimental 需要 JetBrains 插件配合
 */
export async function getJetBrainsDiagnostics(instance: JetBrainsInstance): Promise<JetBrainsDiagnostic[]> {
  const resp = await jbFetch(instance, "/api/diagnostics");
  if (!resp?.ok) {
    return [];
  }

  try {
    const data = (await resp.json()) as JetBrainsDiagnostic[];
    return data;
  } catch (err) {
    const error = createIdeError(
      err,
      {
        operation: "getJetBrainsDiagnostics.parseResponse",
        requestType: "/api/diagnostics",
      },
      "handler",
    );
    log.debug("解析 JetBrains diagnostics 失败", toIdeLogPayload(error));
    return [];
  }
}

/**
 * 在 JetBrains IDE 中打开文件。
 * @experimental 需要 JetBrains 插件配合
 */
export async function openInJetBrains(instance: JetBrainsInstance, filePath: string, line?: number): Promise<boolean> {
  const path = `/api/file/open?file=${encodeURIComponent(filePath)}${line ? `&line=${line}` : ""}`;
  const resp = await jbFetch(instance, path);
  return resp?.ok ?? false;
}
