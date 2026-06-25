/**
 * WebSocket Server — VSCode 扩展端通信服务。
 *
 * 职责:
 *   - 启动 WebSocket Server(端口 9527-9537)
 *   - 接收 crab-cli 的连接
 *   - 推送编辑器上下文(活动文件/选区/光标)
 *   - 响应诊断请求
 *   - 处理 diff 展示命令
 *
 */
import * as vscode from "vscode"
import { WebSocketServer, WebSocket } from "ws"

let wss: WebSocketServer | null = null
let clients: Set<WebSocket> = new Set()
let actualPort = 9527
const BASE_PORT = 9527
const MAX_PORT = 9537

// 缓存最后的编辑器上下文
let lastValidContext: any = {
	type: "context",
	workspaceFolder: undefined,
	activeFile: undefined,
	cursorPosition: undefined,
	selectedText: undefined,
}

/** 路径规范化 */
function normalizePath(filePath: string | undefined): string | undefined {
	if (!filePath) return undefined
	let normalized = filePath.replace(/\\/g, "/")
	if (/^[A-Z]:/.test(normalized)) {
		normalized = normalized.charAt(0).toLowerCase() + normalized.slice(1)
	}
	return normalized
}

/** 获取工作区文件夹列表 */
function getWorkspaceFolderKeys(): string[] {
	const folders = vscode.workspace.workspaceFolders ?? []
	const keys = folders.map((f) => normalizePath(f.uri.fsPath)).filter(Boolean) as string[]
	if (keys.length === 0) return [""]
	return Array.from(new Set(keys))
}

/** 获取编辑器所属的工作区文件夹 */
function getWorkspaceFolderForEditor(editor: vscode.TextEditor): string | undefined {
	const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri)
	return normalizePath(folder?.uri.fsPath) ?? normalizePath(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath)
}

/** 广播消息给所有客户端 */
export function broadcast(message: string): void {
	for (const client of clients) {
		if (client.readyState === WebSocket.OPEN) {
			client.send(message)
		}
	}
}

/** 发送当前编辑器上下文 */
export function sendEditorContext(): void {
	if (clients.size === 0) return

	const editor = vscode.window.activeTextEditor
	if (!editor || editor.document.uri.scheme === "output") {
		lastValidContext = {
			type: "context",
			workspaceFolder: normalizePath(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath),
			activeFile: undefined,
			cursorPosition: undefined,
			selectedText: undefined,
		}
		broadcast(JSON.stringify(lastValidContext))
		return
	}

	const context: any = {
		type: "context",
		workspaceFolder: getWorkspaceFolderForEditor(editor),
		activeFile: normalizePath(editor.document.uri.fsPath),
		cursorPosition: {
			line: editor.selection.active.line,
			character: editor.selection.active.character,
		},
	}

	if (!editor.selection.isEmpty) {
		context.selectedText = editor.document.getText(editor.selection)
	}

	lastValidContext = { ...context }
	broadcast(JSON.stringify(context))
}

/** 处理请求诊断 */
function handleGetDiagnostics(filePath: string, requestId: string): void {
	const uri = vscode.Uri.file(filePath)
	const diagnostics = vscode.languages.getDiagnostics(uri)
	const simple = diagnostics.map((d) => ({
		message: d.message,
		severity: ["error", "warning", "info", "hint"][d.severity],
		line: d.range.start.line,
		character: d.range.start.character,
		source: d.source,
		code: d.code,
	}))

	broadcast(JSON.stringify({ type: "diagnostics", requestId, diagnostics: simple }))
}

/** 处理 diff 展示 */
function handleShowDiff(data: any): void {
	vscode.commands.executeCommand("crab-cli.showDiff", data)
}

/** 处理收到的消息 */
function handleMessage(message: string): void {
	try {
		const data = JSON.parse(message)

		switch (data.type) {
			case "getDiagnostics":
				handleGetDiagnostics(data.filePath, data.requestId)
				break
			case "showDiff":
				handleShowDiff(data)
				break
			case "closeDiff":
				vscode.commands.executeCommand("workbench.action.closeActiveEditor")
				break
			case "showGitDiff":
				if (data.filePath) {
					vscode.commands.executeCommand("vscode.open", vscode.Uri.file(data.filePath))
					vscode.commands.executeCommand("git.openChange", vscode.Uri.file(data.filePath))
				}
				break
		}
	} catch {
		/* ignore */
	}
}

/** 写入端口信息文件 */
function writePortInfo(): void {
	const fs = require("fs")
	const os = require("os")
	const path = require("path")
	const portInfoPath = path.join(os.homedir(), ".crab", "tmp", "ide", "crab-ide-ports.json")

	try {
		fs.mkdirSync(path.dirname(portInfoPath), { recursive: true })
		let portInfo: any = {}
		if (fs.existsSync(portInfoPath)) {
			portInfo = JSON.parse(fs.readFileSync(portInfoPath, "utf8"))
		}
		for (const workspaceFolder of getWorkspaceFolderKeys()) {
			portInfo[workspaceFolder] = actualPort
		}
		fs.writeFileSync(portInfoPath, JSON.stringify(portInfo, null, 2))
	} catch (err) {
		console.error("Failed to write port info:", err)
	}
}

/** 清理端口信息文件 */
function cleanupPortInfo(): void {
	const fs = require("fs")
	const os = require("os")
	const path = require("path")
	const portInfoPath = path.join(os.homedir(), ".crab", "tmp", "ide", "crab-ide-ports.json")

	try {
		if (!fs.existsSync(portInfoPath)) return
		const portInfo = JSON.parse(fs.readFileSync(portInfoPath, "utf8"))
		for (const workspaceFolder of getWorkspaceFolderKeys()) {
			delete portInfo[workspaceFolder]
		}
		if (Object.keys(portInfo).length === 0) {
			fs.unlinkSync(portInfoPath)
		} else {
			fs.writeFileSync(portInfoPath, JSON.stringify(portInfo, null, 2))
		}
	} catch {
		/* ignore */
	}
}

/** 启动 WebSocket 服务器 */
export function startWebSocketServer(): void {
	if (wss) return

	let port = BASE_PORT

	const tryPort = (currentPort: number) => {
		if (currentPort > MAX_PORT) {
			console.error(`Failed to start WebSocket server: ports ${BASE_PORT}-${MAX_PORT} in use`)
			return
		}

		try {
			const server = new WebSocketServer({ port: currentPort })

			server.on("error", (error: any) => {
				if (error.code === "EADDRINUSE") {
					tryPort(currentPort + 1)
				}
			})

			server.on("listening", () => {
				actualPort = currentPort
				console.log(`Crab CLI WebSocket server started on port ${actualPort}`)
				writePortInfo()
			})

			server.on("connection", (ws: WebSocket) => {
				console.log("Crab CLI connected")
				clients.add(ws)
				sendEditorContext()

				ws.on("message", (msg: any) => handleMessage(msg.toString()))
				ws.on("close", () => {
					clients.delete(ws)
				})
				ws.on("error", () => {
					clients.delete(ws)
				})
			})

			wss = server
		} catch {
			tryPort(currentPort + 1)
		}
	}

	tryPort(port)
}

/** 停止 WebSocket 服务器 */
export function stopWebSocketServer(): void {
	for (const client of clients) client.close()
	clients.clear()
	if (wss) {
		wss.close()
		wss = null
	}
	cleanupPortInfo()
}

export function getActualPort(): number {
	return actualPort
}

export function getClientCount(): number {
	return clients.size
}
