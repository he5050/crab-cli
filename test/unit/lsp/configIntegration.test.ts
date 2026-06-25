/**
 * LSP 配置集成测试。
 *
 * 测试用例:
 *   - 多语言服务器配置合并
 *   - 路径解析与回退
 *   - 解析后的配置与运行时联动
 */
import { describe, expect, test } from "bun:test";
import { ConfigIntegration } from "@/lsp/config/configIntegration";
import type { ResolvedLspConfig } from "@/lsp/config/lspConfig";
import type { LspServerDefinition } from "@/lsp/registry/serverRegistry";
import type { LspManager } from "@/lsp/manager/manager";

function makeServer(id: string, languages: string[], command = id): LspServerDefinition {
  return {
    args: [],
    command,
    id,
    installHint: `install ${id}`,
    label: id,
    languages,
    transport: "stdio",
  };
}

function makeConfig(servers: Record<string, LspServerDefinition>, disabled: string[] = []): ResolvedLspConfig {
  return {
    disabled: new Set(disabled),
    servers,
  };
}

describe("ConfigIntegration", () => {
  test("配置变更使用规范的 manager API 停止并重启受影响的语言", async () => {
    const calls: string[] = [];
    const manager = {
      startForLanguage: async (languageId: string, rootUri: string) => {
        calls.push(`start:${languageId}:${rootUri}`);
        return null;
      },
      stop: async (languageId: string) => {
        calls.push(`stop:${languageId}`);
      },
    } as unknown as LspManager;

    const integration = new ConfigIntegration(manager, {
      enableLogging: false,
      projectRoot: "/tmp/lsp-project",
    });

    const oldConfig = makeConfig({
      ts: makeServer("ts", ["typescript"], "old-ts-server"),
    });
    const newConfig = makeConfig({
      ts: makeServer("ts", ["typescript"], "new-ts-server"),
    });

    (integration as any).currentConfig = oldConfig;
    await (integration as any).handleConfigChange(newConfig);

    expect(calls).toEqual(["stop:typescript", "start:typescript:file:///tmp/lsp-project"]);
    expect(integration.getCurrentConfig()).toBe(newConfig);
  });

  test("disabled languages are stopped but not restarted", async () => {
    const calls: string[] = [];
    const manager = {
      startForLanguage: async (languageId: string) => {
        calls.push(`start:${languageId}`);
        return null;
      },
      stop: async (languageId: string) => {
        calls.push(`stop:${languageId}`);
      },
    } as unknown as LspManager;

    const integration = new ConfigIntegration(manager, {
      enableLogging: false,
      projectRoot: "file:///tmp/lsp-project",
    });

    const oldConfig = makeConfig({
      py: makeServer("py", ["python"]),
    });
    const newConfig = makeConfig(
      {
        py: makeServer("py", ["python"]),
      },
      ["py"],
    );

    (integration as any).currentConfig = oldConfig;
    await (integration as any).handleConfigChange(newConfig);

    expect(calls).toEqual(["stop:python"]);
    expect(integration.getCurrentConfig()).toBe(newConfig);
  });
});
