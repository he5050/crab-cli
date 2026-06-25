/**
 * VSIX 能力面契约 — 当前 crab-cli VSCode 扩展的能力映射(描述性)。
 *
 * 职责:
 *   - 静态描述当前 VSIX 已实现/计划中/未规划的能力
 *   - 为文档、测试与可观测性提供单一事实来源
 *
 * 模块功能:
 *   - getVsixSurface: 导出当前能力面快照
 *   - VsixCapabilityStatus: 能力状态枚举(implemented/planned/not_planned)
 *   - VsixCommandSurface / VsixCapabilitySurface / VsixSurface: 数据契约
 *
 * 使用场景:
 *   - 文档/能力评估时引用
 *   - 测试断言「实际暴露的命令/能力」与本契约一致
 *
 * 边界:
 *   1. 仅作描述使用:未实现项明确标 planned/not_planned，不当作真实能力
 *   2. 修改本文件应与 vsix/ 实际代码同步
 *   3. 不感知运行时命令注册(运行时以 vsix 扩展源码为准)
 *
 * 流程:
 *   1. 启动时(或测试中)调用 getVsixSurface
 *   2. 消费方对比命令清单与运行时注册
 *   3. 不一致时记录能力差距
 */

export type VsixCapabilityStatus = "implemented" | "planned" | "not_planned";

export interface VsixCommandSurface {
  command: string;
  title: string;
  implemented: boolean;
}

export interface VsixCapabilitySurface {
  id: string;
  status: VsixCapabilityStatus;
  evidence: string[];
  notes?: string;
}

export interface VsixSurface {
  extensionId: string;
  packageName: string;
  displayName: string;
  sourceRoot: string;
  packageManifest: string;
  runtimeBridge: {
    extensionServer: string;
    cliServer: string;
    portRange: string;
    protocols: string[];
  };
  commands: VsixCommandSurface[];
  capabilities: VsixCapabilitySurface[];
}

const COMMANDS: VsixCommandSurface[] = [
  { command: "crab-cli.openTerminal", implemented: true, title: "Crab CLI: Open Terminal" },
  { command: "crab-cli.addFilePath", implemented: true, title: "Crab CLI: Add File Path" },
  { command: "crab-cli.addFolderPath", implemented: true, title: "Crab CLI: Add Folder Path" },
  { command: "crab-cli.sendSelectionLocation", implemented: true, title: "Crab CLI: Send Selection Location" },
  { command: "crab-cli.showDiff", implemented: true, title: "Crab CLI: Show Diff" },
];

const CAPABILITIES: VsixCapabilitySurface[] = [
  {
    evidence: ["vsix/src/extension.ts: openTerminal", "vsix/package.json: contributes.commands"],
    id: "terminal.launch",
    status: "implemented",
  },
  {
    evidence: ["vsix/src/extension.ts: addFilePath/addFolderPath/sendSelectionLocation"],
    id: "editor.path_injection",
    status: "implemented",
  },
  {
    evidence: ["vsix/src/webSocketServer.ts: sendEditorContext", "src/ide/connection/wsServer.ts: context"],
    id: "editor.context_push",
    status: "implemented",
  },
  {
    evidence: ["vsix/src/webSocketServer.ts: getDiagnostics", "src/tool/ideDiagnostics/index.ts"],
    id: "diagnostics.request",
    status: "implemented",
  },
  {
    evidence: ["vsix/src/extension.ts: showDiff", "src/ide/connection/interactionManager.ts"],
    id: "diff.webview",
    status: "implemented",
  },
  {
    evidence: ["vsix/src/webSocketServer.ts: showGitDiff"],
    id: "git.diff_open",
    status: "implemented",
  },
  {
    evidence: [],
    id: "inline_completion_provider",
    notes: "No InlineCompletionItemProvider registration is present in current vsix/src.",
    status: "planned",
  },
  {
    evidence: [],
    id: "next_edit",
    notes: "No next-edit provider or command is present in current vsix/src.",
    status: "planned",
  },
  {
    evidence: ["src/commandPalette/appCommands/gitCodebaseIde.ts has CLI Git Blame command"],
    id: "git_blame_provider",
    notes: "VSIX does not currently contribute a Git Blame view/provider.",
    status: "planned",
  },
];

export function getVsixSurface(): VsixSurface {
  return {
    capabilities: CAPABILITIES.map((capability) => ({
      ...capability,
      evidence: [...capability.evidence],
    })),
    commands: COMMANDS.map((command) => ({ ...command })),
    displayName: "Crab CLI",
    extensionId: "crab-dev.crab-cli",
    packageManifest: "vsix/package.json",
    packageName: "crab-cli",
    runtimeBridge: {
      cliServer: "src/ide/connection/wsServer.ts",
      extensionServer: "vsix/src/webSocketServer.ts",
      portRange: "9527-9537",
      protocols: ["legacy-simple-json", "json-rpc-2.0"],
    },
    sourceRoot: "vsix/src",
  };
}
