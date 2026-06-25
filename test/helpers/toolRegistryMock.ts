/**
 * Stateful tool-registry mock — includes ALL 10 exports to prevent cross-file SyntaxError.
 * Uses module-level shared state so all factory invocations share the same registry.
 */
const _sharedReg: Record<string, any> = {};

export function resetRegistryMock() {
  for (const k of Object.keys(_sharedReg)) {
    delete _sharedReg[k];
  }
}

export function createRegistryMock(overrides: Record<string, any> = {}) {
  return {
    _resetForTesting: async () => {
      // Re-import the real module and populate the shared registry
      const real = await import("@/tool/registry/toolRegistry");
      const realTools = real.getRegisteredTools();
      for (const k of Object.keys(_sharedReg)) {
        delete _sharedReg[k];
      }
      for (const [name, tool] of Object.entries(realTools)) {
        _sharedReg[name] = tool;
      }
    },
    clearToolsCache: () => {},
    getBuiltinGroupName: () => null,
    getBuiltinToolGroups: () => [],
    getRegisteredTools: () => ({ ..._sharedReg }),
    getToolsForAiSdk: () => {
      const tools: Record<string, any> = {};
      for (const key in _sharedReg) {
        const tool = _sharedReg[key];
        if (!tool) {
          continue;
        }
        tools[tool.name] = {
          description: tool.description,
          inputSchema: tool.parameters,
        };
      }
      return tools;
    },
    isBuiltinTool: (name: string) => name in _sharedReg,
    registerTool: (tool: any) => {
      _sharedReg[tool.name] = tool;
    },
    registerTools: (tools: any[]) => {
      tools.forEach((t) => (_sharedReg[t.name] = t));
    },
    toolRegistry: new Proxy(_sharedReg, {}),
    unregisterTool: (name: string) => {
      delete _sharedReg[name];
    },
    ...overrides,
  };
}
