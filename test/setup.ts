import { afterEach, beforeEach, mock } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { getGlobalConfigPath } from "@/config/paths";

// CRAB_REAL_ENV_TESTS=1: Use real config from ~/.crab/ and real LLM
const realEnvTests = process.env.CRAB_REAL_ENV_TESTS === "1";
const testConfigHome = path.join(process.cwd(), ".crab", "tmp", "tests", `xdg-config-${process.pid}`);
const testDataHome = path.join(process.cwd(), ".crab", "tmp", "tests", `xdg-data-${process.pid}`);

if (!realEnvTests) {
  process.env.XDG_CONFIG_HOME = testConfigHome;
  process.env.XDG_DATA_HOME = testDataHome;
} else {
  console.log(`[test:setup] Using real config from ${getGlobalConfigPath()}`);
}

const BASE_CWD = process.cwd();
const BASE_ENV = { ...process.env };

// ─── Config file snapshot/restore ───────────────────────────────
// Tests that call saveConfig() write to XDG_CONFIG_HOME/crab/config.json.
// ResetConfigCache() only clears in-memory cache but doesn't restore the file.
// We snapshot the file content once for the whole test process and always
// Restore back to that baseline after each test. This avoids cross-file races
// When Bun runs multiple test files in one process.

const configPathForSnapshot = getGlobalConfigPath();
const CONFIG_SNAPSHOT = (() => {
  try {
    if (fs.existsSync(configPathForSnapshot)) {
      return {
        content: fs.readFileSync(configPathForSnapshot, "utf8"),
        existed: true as const,
      };
    }
  } catch {
    // Fall through
  }
  return {
    content: null as string | null,
    existed: false as const,
  };
})();

function safeResetForTesting(callback: () => unknown): void {
  try {
    callback();
  } catch (error) {
    if (!(error instanceof ReferenceError)) {
      throw error;
    }
  }
}

function restoreAllEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in BASE_ENV)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(BASE_ENV)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }
}

beforeEach(() => {});

afterEach(async () => {
  // 0. Restore process-level mutable state before importing cleanup modules.
  process.chdir(BASE_CWD);
  restoreAllEnv();

  // 0.5 Restore bun:test mocks before importing cleanup modules.
  // Otherwise the cleanup imports themselves can capture mocked aliases
  // (for example @config/paths from sseDaemon tests) and poison later files.
  mock.restore();
  mock.clearAllMocks();

  // 1. Pause config watcher to prevent file restore from triggering hot-reload
  const [
    { resetConfigCache, pauseConfigWatch, resumeConfigWatch },
    { clearProviderCache },
    { clearVerifiedMethods, __resetFallbackDepsForTesting },
    llmModule,
    toolRegistryModule,
    eventBusModule,
    dbModule,
    dbSchemaModule,
    sensitiveCommandModule,
    subAgentTrackerModule,
    profileManagerModule,
    unifiedSettingsModule,
    modeStateModule,
    promptContextModule,
    mcpConfigModule,
    devModeModule,
    circuitBreakerModule,
    logStoreModule,
    agentManagerModule,
    cacheManagerModule,
    globalCleanupModule,
    compressCoordinatorModule,
    commandRegistryModule,
    mcpRuntimeModule,
    agentSessionModule,
    acpServerModule,
    acpStdioModule,
    chatContextModule,
    subAgentResolverModule,
    bashToolModule,
    sseManagerModule,
    sseServerModule,
    toolApprovalModule,
    slotsModule,
    streamHandlerModule,
    loggerModule,
    autoCompressModule,
    lspManagerModule,
    sessionStateManagerModule,
    toolDiffRouteModule,
    taskManagerModule,
    loopManagerModule,
  ] = await Promise.all([
    import("../src/config/loader/config"),
    import("../src/api/core/provider"),
    import("../src/api/resilience/fallback"),
    // @ts-expect-error test-only cache busting to avoid mocked llm exports leaking into cleanup
    import("../src/api/core/llm.ts?setup-cleanup"),
    import("../src/tool/registry/toolRegistry"),
    import("../src/bus/core/eventBus"),
    import("../src/db/index.ts"),
    import("../src/db/schema/index.ts"),
    import("../src/permission/security/sensitiveCommand.ts"),
    import("../src/agent/subagent/tracker.ts"),
    import("../src/config/settings/profileManager.ts"),
    import("../src/config/settings/unifiedSettings.ts"),
    import("../src/agent/runtime/modeState.ts"),
    import("../src/agent/prompt/context.ts"),
    import("../src/mcp/manager/mcpConfig.ts"),
    import("../src/config/devMode.ts"),
    import("../src/core/concurrency/circuitBreaker.ts"),
    import("../src/core/logging/logStore.ts"),
    import("../src/agent/core/manager.ts"),
    import("../src/core/concurrency/cacheManager.ts"),
    import("../src/bus/lifecycle/globalCleanup.ts"),
    import("../src/compress/core/compressionCoordinator.ts"),
    import("../src/commandPalette/registry"),
    import("../src/mcp/manager/runtime"),
    import("../src/agent/session/session.ts"),
    import("../src/server/acpServer"),
    import("../src/server/acpStdio"),
    import("../src/ui/contexts/chat"),
    import("../src/agent/subagent/resolver"),
    import("../src/tool/bash"),
    import("../src/server/sseManager"),
    import("../src/server/sseServer"),
    import("../src/agent/subagent/toolApproval"),
    import("../src/ui/plugins/slots"),
    import("../src/api/stream/streamHandler"),
    import("../src/core/logging/logger.ts"),
    import("../src/compress/runtime/autoCompress"),
    import("../src/lsp/manager/manager"),
    import("../src/session/state/sessionStateManager"),
    import("../src/ui/pages/session/components/toolDiffRoute"),
    import("../src/mission/task/manager"),
    import("../src/mission/loop/manager"),
  ]);

  pauseConfigWatch?.();

  // 2. Restore config file to its original state (before any test mutated it)
  const configPath = configPathForSnapshot;
  try {
    if (CONFIG_SNAPSHOT.existed) {
      fs.writeFileSync(configPath, CONFIG_SNAPSHOT.content!, "utf8");
    } else if (fs.existsSync(configPath)) {
      fs.rmSync(configPath, { force: true });
    }
  } catch {
    // Ignore file system errors during cleanup
  }

  // 3. Rebind high-impact mock.module targets back to real implementations.
  // Some suites mock core aliases like @db / @conversation/core/conversationHandler.
  // Without rebinding, later files can observe stale mocked module singletons.
  const actualDbModule = await import("../src/db/index.ts");
  const actualEventBusModule = await import("../src/bus/core/eventBus.ts");
  const actualEventsModule = await import("../src/bus/events/index.ts");
  const actualConfigModule = await import("../src/config/loader/config.ts");
  const actualPathsModule = await import("../src/config/paths/paths.ts");
  const actualConversationHandlerModule = await import(`../src/conversation/core/conversationHandler.ts`);
  const actualMcpRuntimeModule = await import("../src/mcp/manager/runtime.ts");
  const actualHookExecutorModule = await import("../src/hooks/hookExecutor.ts");
  const actualUnifiedHookExecutorModule = await import(`../src/hooks/unifiedHookExecutor.ts`);
  const actualHookStrategiesModule = await import(`../src/hooks/hookStrategies.ts`);
  const actualYoloPassthroughModule = await import("../src/agent/runtime/yolo.ts");
  const actualTaskRunnerModule = await import("../src/server/taskRunner.ts");
  const actualLoggerModule = await import("../src/core/logging/logger.ts");
  const actualVersionModule = await import("../src/config/version.ts");
  const actualProcessManagerModule = await import(`../src/bus/lifecycle/processManager.ts`);
  const actualLlmModule = await import("../src/api/core/llm.ts");
  const actualProviderModule = await import("../src/api/core/provider.ts");
  const actualAgentIndexModule = await import("../src/agent/index");
  const actualVectorDbModule = await import(`../src/tool/codebaseSearch/indexer/vectorDb.ts`);
  const actualEmbeddingModule = await import(`../src/api/specialized/embedding.ts`);
  const actualTodoScannerModule = await import("../src/core/scanning/index.ts");
  const actualSessionIndexModule = await import("../src/session/index.ts");
  const actualSessionFooterModule = await import("../src/ui/pages/session/footer");

  mock.module("@/db", () => actualDbModule);
  mock.module(path.resolve(BASE_CWD, "src/db/index"), () => actualDbModule);
  mock.module(path.resolve(BASE_CWD, "src/db/index.ts"), () => actualDbModule);
  mock.module("@/bus/core/eventBus", () => actualEventBusModule);
  mock.module("@/bus/events", () => actualEventsModule);
  mock.module("@/config/config", () => actualConfigModule);
  mock.module("@/config/config", () => actualConfigModule);
  mock.module(path.resolve(BASE_CWD, "src/config/config"), () => actualConfigModule);
  mock.module(path.resolve(BASE_CWD, "src/config/config.ts"), () => actualConfigModule);
  mock.module("@/config/paths", () => actualPathsModule);
  mock.module(path.resolve(BASE_CWD, "src/config/paths"), () => actualPathsModule);
  mock.module(path.resolve(BASE_CWD, "src/config/paths.ts"), () => actualPathsModule);
  mock.module("@/conversation/core/conversationHandler", () => actualConversationHandlerModule);
  mock.module("@/conversation/core/conversationHandler", () => actualConversationHandlerModule);
  mock.module(
    path.resolve(BASE_CWD, "src/conversation/core/conversationHandler"),
    () => actualConversationHandlerModule,
  );
  mock.module(
    path.resolve(BASE_CWD, "src/conversation/core/conversationHandler.ts"),
    () => actualConversationHandlerModule,
  );
  mock.module("@/mcp/runtime", () => actualMcpRuntimeModule);
  mock.module("@/mcp/manager/runtime", () => actualMcpRuntimeModule);
  mock.module("@/mcp/runtime", () => actualMcpRuntimeModule);
  mock.module(path.resolve(BASE_CWD, "src/mcp/runtime"), () => actualMcpRuntimeModule);
  mock.module(path.resolve(BASE_CWD, "src/mcp/runtime.ts"), () => actualMcpRuntimeModule);
  mock.module(path.resolve(BASE_CWD, "src/mcp/manager/runtime"), () => actualMcpRuntimeModule);
  mock.module(path.resolve(BASE_CWD, "src/mcp/manager/runtime.ts"), () => actualMcpRuntimeModule);
  mock.module("@/hooks/hookExecutor", () => actualHookExecutorModule);
  mock.module("@/hooks/unifiedHookExecutor", () => actualUnifiedHookExecutorModule);
  mock.module("@/hooks/hookStrategies", () => actualHookStrategiesModule);
  mock.module("@/agent/yolo", () => actualYoloPassthroughModule);
  mock.module("@/server/taskRunner", () => actualTaskRunnerModule);
  mock.module(path.resolve(BASE_CWD, "src/server/taskRunner"), () => actualTaskRunnerModule);
  mock.module(path.resolve(BASE_CWD, "src/server/taskRunner.ts"), () => actualTaskRunnerModule);
  mock.module("@/core/logger", () => actualLoggerModule);
  mock.module("@/core/logging/logger", () => actualLoggerModule);
  mock.module("@core/logger", () => actualLoggerModule);
  mock.module("@/core/version", () => actualVersionModule);
  mock.module("@/core/config/version", () => actualVersionModule);
  mock.module("@core/version", () => actualVersionModule);
  mock.module("@/core/processManager", () => actualProcessManagerModule);
  mock.module("@/core/lifecycle/processManager", () => actualProcessManagerModule);
  mock.module("@core/processManager", () => actualProcessManagerModule);
  mock.module(path.resolve(BASE_CWD, "src/core/processManager"), () => actualProcessManagerModule);
  mock.module(path.resolve(BASE_CWD, "src/core/processManager.ts"), () => actualProcessManagerModule);
  mock.module(path.resolve(BASE_CWD, "src/bus/lifecycle/processManager"), () => actualProcessManagerModule);
  mock.module(path.resolve(BASE_CWD, "src/bus/lifecycle/processManager.ts"), () => actualProcessManagerModule);
  mock.module("@/api", () => actualLlmModule);
  mock.module(path.resolve(BASE_CWD, "src/api/llm"), () => actualLlmModule);
  mock.module(path.resolve(BASE_CWD, "src/api/llm.ts"), () => actualLlmModule);
  mock.module("@/api", () => actualProviderModule);
  mock.module("@/api/provider", () => actualProviderModule);
  mock.module(path.resolve(BASE_CWD, "src/api/provider"), () => actualProviderModule);
  mock.module(path.resolve(BASE_CWD, "src/api/provider.ts"), () => actualProviderModule);
  // Note: @agent is NOT restored here to allow test files to mock it themselves
  // mock.module("@agent", () => actualAgentIndexModule);
  // mock.module(path.resolve(BASE_CWD, "src/agent/index"), () => actualAgentIndexModule);
  // mock.module(path.resolve(BASE_CWD, "src/agent/index.ts"), () => actualAgentIndexModule);
  mock.module("@/tool/codebaseSearch/indexer/vectorDb", () => actualVectorDbModule);
  mock.module("@/api", () => actualEmbeddingModule);
  mock.module("@/core/todoScanner", () => actualTodoScannerModule);
  mock.module("@core/todoScanner", () => actualTodoScannerModule);
  mock.module("@/core/scanning", () => actualTodoScannerModule);
  mock.module("@core/scanning", () => actualTodoScannerModule);
  mock.module("@/session", () => actualSessionIndexModule);
  mock.module("@/ui/pages/session/footer", () => actualSessionFooterModule);
  mock.module("@/mission/taskManager", () => taskManagerModule);
  mock.module(path.resolve(BASE_CWD, "src/task/taskManager"), () => taskManagerModule);
  mock.module(path.resolve(BASE_CWD, "src/task/taskManager.ts"), () => taskManagerModule);

  // 3.5 Mock LSP modules to avoid real LSP server connections in tests
  const noopLspManager = {
    initialize: () => Promise.resolve(),
    getClientForFile: () => Promise.resolve(null),
    getClientForLanguage: () => Promise.resolve(null),
    closeClientForFile: () => Promise.resolve(),
    closeClientForLanguage: () => Promise.resolve(),
    closeAll: () => Promise.resolve(),
    cleanupIdle: () => Promise.resolve(0),
    reloadConfig: () => Promise.resolve(),
    getActiveClients: () => [],
    setDiagnosticsHandler: () => {},
    startForFile: () => Promise.resolve(null),
    startForLanguage: () => Promise.resolve(null),
    stop: () => Promise.resolve(),
    stopAll: () => Promise.resolve(),
    gotoDefinition: () => Promise.resolve([]),
    findReferences: () => Promise.resolve([]),
    hover: () => Promise.resolve(null),
    documentSymbols: () => Promise.resolve([]),
    completion: () => Promise.resolve([]),
    formatDocument: () => Promise.resolve([]),
    rename: () => Promise.resolve(null),
    workspaceSymbols: () => Promise.resolve([]),
    codeActions: () => Promise.resolve([]),
    getDiagnostics: () => [],
    getAllDiagnostics: () => new Map(),
    getClients: () => [],
    didOpen: () => {},
    didChange: () => {},
    didClose: () => {},
    getPerformanceReport: () => ({}),
  };
  mock.module("@/lsp/manager/manager", () => ({ lspManager: noopLspManager }));
  mock.module("@/lsp/client", () => ({
    LSPClient: class MockLSPClient {
      async connect() {
        return this;
      }
      async initialize() {
        return { capabilities: {} };
      }
      async shutdown() {
        return;
      }
      async exit() {
        return;
      }
    },
  }));
  mock.module("@/lsp/manager", () => ({ lspManager: noopLspManager }));

  // 4. Resume config watcher after file ops complete
  resumeConfigWatch?.();

  // 5. Clean up all modules with mutable state.
  resetConfigCache?.();
  clearProviderCache?.();
  clearVerifiedMethods?.();
  __resetFallbackDepsForTesting?.();
  llmModule?.clearLlmConfigCache?.();
  safeResetForTesting(() => toolRegistryModule?._resetForTesting?.());
  eventBusModule?.globalBus?.clearHistory?.();

  // Permission / approval / sensitive commands state
  if (!realEnvTests) {
    try {
      const db = dbModule?.getDb?.();
      if (db && dbSchemaModule?.approvals) {
        db.delete(dbSchemaModule.approvals).run();
      }
    } catch {
      // Ignore approval cleanup errors caused by tests that intentionally mock DB modules.
    }
    try {
      const db = dbModule?.getDb?.();
      if (db && dbSchemaModule?.persistentPermissions) {
        db.delete(dbSchemaModule.persistentPermissions).run();
      }
    } catch {
      // Ignore persistent permission cleanup errors caused by DB mocks.
    }
  }
  sensitiveCommandModule?.resetSensitiveCommands?.();

  // Close any connection opened by cleanup helpers so the next test starts clean.
  dbModule?.resetDb?.();

  // Agent tracking state
  subAgentTrackerModule?.subAgentTracker?.clear?.();

  // Config profile manager state
  profileManagerModule?.resetProfileManager?.();

  // Session-level settings state
  unifiedSettingsModule?.resetSessionSettings?.();

  // Agent mode state
  modeStateModule?.resetModeState?.();

  // Prompt instruction cache
  promptContextModule?.clearInstructionCache?.();

  // MCP config cache
  mcpConfigModule?.resetMcpConfigCache?.();

  // Dev mode state
  devModeModule?.clearDevConfig?.();

  // Circuit breaker state
  circuitBreakerModule?.resetAllCircuitBreakers?.();

  // Log store state
  logStoreModule?.resetLogStoreForTests?.();

  // Agent manager status
  agentManagerModule?.resetAllAgentStatus?.();

  // Cache manager
  cacheManagerModule?.cleanupAllCaches?.();

  // Global cleanup handlers
  globalCleanupModule?.clearCleanup?.();

  // Compression coordinator — force-clear any lingering locks/waiters
  if (compressCoordinatorModule?.compressionCoordinator) {
    try {
      const cc = compressCoordinatorModule.compressionCoordinator as unknown as {
        _compressing?: Set<string>;
        _waiters?: unknown[];
      };
      cc._compressing?.clear?.();
      cc._waiters = [];
    } catch {
      // Ignore if internal structure differs
    }
  }

  // Command registry singleton
  commandRegistryModule?._resetCommandRegistryForTesting?.();

  // MCP runtime state
  mcpRuntimeModule?._resetMcpRuntimeForTesting?.();

  // Agent-session and tool-approval injected deps
  agentSessionModule?.__resetAgentSessionDepsForTesting?.();
  acpServerModule?.__resetAcpServerDepsForTesting?.();
  acpStdioModule?.__resetAcpStdioDepsForTesting?.();
  chatContextModule?.__resetChatContextDepsForTesting?.();
  subAgentResolverModule?.__resetSubAgentResolverDepsForTesting?.();
  bashToolModule?.__resetBashToolDepsForTesting?.();
  sseManagerModule?.__resetSseManagerDepsForTesting?.();
  sseServerModule?.__resetSseServerDepsForTesting?.();
  toolApprovalModule?.__resetToolApprovalDepsForTesting?.();

  // UI plugin slots
  slotsModule?.clearSlots?.();

  // Stream handler test override
  streamHandlerModule?._resetStreamTextForTesting?.();

  // Logger buffer and level state
  loggerModule?._resetLoggerForTesting?.();
  autoCompressModule?.__resetAutoCompressDepsForTesting?.();
  await lspManagerModule?.lspManager?.stopAll?.();
  sessionStateManagerModule?.destroyAllSessionStateManagers?.();
  toolDiffRouteModule?.clearSessionDiffCache?.();
  loopManagerModule?.__resetLoopManagerDepsForTesting?.();
});
