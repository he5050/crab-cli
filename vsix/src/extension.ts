/**
 * Crab CLI VSCode Extension — 主入口。
 *
 * 职责:
 *   - 启动 WebSocket Server
 *   - 推送编辑器上下文
 *   - 注册命令(打开终端、添加文件/文件夹路径、发送选区)
 *   - Diff 展示
 *   - 监听编辑器变化和配置变化
 *
 */
import * as vscode from "vscode"
import { startWebSocketServer, stopWebSocketServer, sendEditorContext } from "./webSocketServer"

function getConfig<T>(key: string, fallback: T): T {
	return vscode.workspace.getConfiguration("crab-cli").get<T>(key, fallback)
}

/** 格式化选区位置 */
function formatSelectionLocation(editor: vscode.TextEditor): string | undefined {
	const { document, selection } = editor
	if (selection.isEmpty) return undefined

	const absolutePath = document.uri.fsPath
	if (!absolutePath) return undefined

	const startLine = selection.start.line
	const endLine =
		selection.end.line > selection.start.line && selection.end.character === 0
			? selection.end.line - 1
			: selection.end.line

	if (endLine <= startLine) return `${absolutePath}:${startLine + 1}`
	return `${absolutePath}:${startLine + 1}-${endLine + 1}`
}

/** Diff 面板管理 */
const diffPanels = new Map<string, vscode.WebviewPanel>()

function showDiffPanel(filePath: string, originalContent: string, newContent: string, label: string): void {
	const fileName = filePath.split(/[\\/]/).pop() ?? "file"
	const title = `${label || fileName} (Diff)`

	// 关闭已有的 diff 面板
	const existing = diffPanels.get(filePath)
	if (existing) {
		existing.dispose()
		diffPanels.delete(filePath)
	}

	const panel = vscode.window.createWebviewPanel("crabDiff", title, vscode.ViewColumn.Beside, { enableScripts: true })

	panel.webview.html = getDiffHtml(originalContent, newContent, fileName)

	panel.onDidDispose(() => {
		diffPanels.delete(filePath)
	})

	diffPanels.set(filePath, panel)
}

function getDiffHtml(original: string, modified: string, fileName: string): string {
	// 简化的 diff 展示:左右对比
	const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

	return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Diff: ${fileName}</title>
  <style>
    body { font-family: var(--vscode-editor-font-family, monospace); margin: 0; padding: 8px; }
    .diff-container { display: flex; gap: 8px; }
    .diff-panel { flex: 1; overflow: auto; }
    .diff-panel h3 { margin: 0 0 8px 0; padding: 4px 8px; background: var(--vscode-editor-background); }
    pre { margin: 0; padding: 8px; white-space: pre-wrap; font-size: 13px; line-height: 1.5; }
    .original { border: 1px solid var(--vscode-errorForeground, #f44336); }
    .modified { border: 1px solid var(--vscode-terminal-ansiGreen, #4caf50); }
  </style>
</head>
<body>
  <div class="diff-container">
    <div class="diff-panel original">
      <h3>Original</h3>
      <pre>${escapeHtml(original)}</pre>
    </div>
    <div class="diff-panel modified">
      <h3>Modified</h3>
      <pre>${escapeHtml(modified)}</pre>
    </div>
  </div>
</body>
</html>`
}

export function activate(context: vscode.ExtensionContext) {
	console.log("Crab CLI extension activating...")

	// 启动 WebSocket Server
	try {
		startWebSocketServer()
	} catch (err) {
		console.error("Failed to start WebSocket server:", err)
	}

	// 监听编辑器变化 → 推送上下文
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(() => sendEditorContext()),
		vscode.window.onDidChangeTextEditorSelection(() => sendEditorContext()),
		vscode.window.onDidChangeVisibleTextEditors(() => sendEditorContext()),
	)

	// 注册命令
	context.subscriptions.push(
		// 打开终端
		vscode.commands.registerCommand("crab-cli.openTerminal", async () => {
			const startupCommand = getConfig<string>("startupCommand", "crab")
			const terminal = vscode.window.createTerminal({
				name: "Crab CLI",
				cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
				location: vscode.TerminalLocation.Editor,
			})
			terminal.show()
			await vscode.commands.executeCommand("workbench.action.moveEditorToRightGroup")
			if (startupCommand) {
				terminal.sendText(startupCommand)
			}
		}),

		// 添加文件路径
		vscode.commands.registerCommand("crab-cli.addFilePath", async (...args: unknown[]) => {
			const uris = (args[1] as vscode.Uri[]) ?? []
			const clickedUri = args[0] as vscode.Uri | undefined
			const paths = uris.length > 0 ? uris.map((u) => u.fsPath) : clickedUri ? [clickedUri.fsPath] : []
			// 发送到 crab-cli 的 WebSocket 连接
			// 实际通过终端 sendText 实现
			const terminal = vscode.window.terminals.find((t) => t.name === "Crab CLI")
			if (terminal && paths.length > 0) {
				terminal.sendText(paths.join(" "))
			}
		}),

		// 添加文件夹路径
		vscode.commands.registerCommand("crab-cli.addFolderPath", async () => {
			const uris = await vscode.window.showOpenDialog({
				canSelectFolders: true,
				canSelectMany: true,
				openLabel: "Add Folder Path",
			})
			const paths = uris?.map((u) => u.fsPath) ?? []
			const terminal = vscode.window.terminals.find((t) => t.name === "Crab CLI")
			if (terminal && paths.length > 0) {
				terminal.sendText(paths.join(" "))
			}
		}),

		// 发送选区位置
		vscode.commands.registerCommand("crab-cli.sendSelectionLocation", async () => {
			const editor = vscode.window.activeTextEditor
			if (!editor) return
			const location = formatSelectionLocation(editor)
			if (!location) return
			const terminal = vscode.window.terminals.find((t) => t.name === "Crab CLI")
			if (terminal) {
				terminal.sendText(location, false)
			}
		}),

		// 显示 Diff
		vscode.commands.registerCommand("crab-cli.showDiff", (data: any) => {
			if (data.filePath && data.originalContent !== undefined && data.newContent !== undefined) {
				showDiffPanel(data.filePath, data.originalContent, data.newContent, data.label)
			}
		}),
	)

	// 监听配置变化
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration("crab-cli.terminalMode")) {
				vscode.window
					.showInformationMessage("Crab CLI: Terminal mode changed. Reload window for full effect.", "Reload")
					.then((choice) => {
						if (choice === "Reload") {
							vscode.commands.executeCommand("workbench.action.reloadWindow")
						}
					})
			}
		}),
	)

	console.log("Crab CLI extension activated")
}

export function deactivate() {
	console.log("Crab CLI extension deactivating...")
	stopWebSocketServer()
	console.log("Crab CLI extension deactivated")
}
