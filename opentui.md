# OpenTUI 完整入门与工程实践指南

> 面向 React/TypeScript 开发者的 OpenTUI 深度教程
>
> 作者定位:
>
> - 已经会 React
> - 想开发现代 Terminal UI
> - 想做 AI Agent / Claude Code 类应用
> - 想理解 OpenTUI 的底层架构

---

# 目录

- 什么是 OpenTUI
- OpenTUI 与 Ink 的区别
- OpenTUI 架构
- 为什么 OpenTUI 适合 AI Agent
- 环境安装
- 创建第一个项目
- React 集成
- Renderer 深度解析
- 布局系统(Yoga/Flexbox)
- 基础组件
- 输入系统
- 滚动与 Streaming
- Markdown 渲染
- Code 语法高亮
- Diff Viewer
- 动画系统
- FrameBuffer
- Console Overlay
- 状态管理
- AI Agent 架构实践
- 性能优化
- 调试技巧
- 项目结构推荐
- OpenTUI 最佳实践
- OpenTUI 不适合什么
- 总结

---

# 一、什么是 OpenTUI

OpenTUI 是一个:

```txt
Terminal UI Runtime
```

它不是一个普通的 React CLI 库。

它更像:

```txt
Terminal 上的原生 UI 引擎
```

官方核心定位:

- Zig Native Renderer
- TypeScript Bindings
- React / Solid 支持
- Yoga Flexbox Layout
- AI Agent 场景优化
- Streaming UI 优化
- Fullscreen TUI

官方 GitHub:

https://github.com/anomalyco/opentui

官方文档:

https://opentui.com/docs/getting-started

---

# 二、OpenTUI 与 Ink 的本质区别

很多人第一次接触 OpenTUI 会认为:

```txt
它只是另一个 Ink
```

其实完全不是。

---

## Ink 的本质

Ink:

```txt
React → Terminal Renderer
```

它本质是:

```txt
React DOM 的 Terminal 版本
```

React 仍然是主角。

---

## OpenTUI 的本质

OpenTUI:

```txt
Native Terminal Runtime
```

React 只是:

```txt
一个 binding
```

OpenTUI 真正核心:

```txt
Zig Native Core
```

---

## 一句话理解

### Ink

```txt
React 写 CLI
```

### OpenTUI

```txt
把 Terminal 当成真正的平台
```

---

# 三、OpenTUI 架构

OpenTUI 整体架构:

```txt
React/Solid
      ↓
@opentui/react
      ↓
@opentui/core
      ↓
Zig Native Renderer
      ↓
Terminal Buffer
      ↓
ANSI / Kitty Protocol
```

这里最重要的是:

```txt
Renderer 是 Native 的
```

而不是 React Renderer。

---

# 四、为什么 OpenTUI 特别适合 AI Agent

OpenTUI 的设计明显偏向:

```txt
Claude Code / OpenCode / Cursor Terminal
```

这一类应用。

因为它原生支持:

- Markdown
- Code Highlight
- Diff Viewer
- Scrollback
- Streaming UI
- Split Footer
- 高性能渲染
- 多 Panel
- Fullscreen

这些东西:

```txt
正是 AI Coding Agent 最需要的
```

---

# 五、环境安装

---

## 1. 安装 Bun

当前 OpenTUI 官方优先支持:

```txt
Bun
```

安装:

```bash
curl -fsSL https://bun.sh/install | bash
```

检查:

```bash
bun --version
```

---

## 2. 安装 Zig

OpenTUI Native Core 依赖 Zig。

macOS:

```bash
brew install zig
```

Ubuntu:

```bash
sudo apt install zig
```

检查:

```bash
zig version
```

---

# 六、创建项目

官方推荐:

```bash
bun create tui
```

React 模板:

```bash
bun create tui --template react
```

---

# 七、手动创建 OpenTUI 项目

---

## 初始化项目

```bash
mkdir my-opentui
cd my-opentui

bun init -y
```

---

## 安装依赖

```bash
bun add @opentui/core
bun add @opentui/react react
```

---

# 八、tsconfig 配置(重要)

创建:

```json
{
	"compilerOptions": {
		"target": "ESNext",
		"module": "ESNext",
		"moduleResolution": "bundler",

		"jsx": "react-jsx",
		"jsxImportSource": "@opentui/react",

		"strict": true,
		"skipLibCheck": true
	}
}
```

最关键配置:

```json
"jsxImportSource": "@opentui/react"
```

否则:

```tsx
<box />
<text />
```

会报错。

---

# 九、第一个 OpenTUI 程序

---

## index.tsx

```tsx
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"

function App() {
	return (
		<box padding={1}>
			<text fg='#00ff00'>Hello OpenTUI</text>
		</box>
	)
}

const renderer = await createCliRenderer({
	exitOnCtrlC: true,
})

createRoot(renderer).render(<App />)
```

运行:

```bash
bun index.tsx
```

---

# 十、Renderer(OpenTUI 核心)

Renderer 是 OpenTUI 最重要的东西。

一切从:

```ts
createCliRenderer()
```

开始。

---

## 基础 Renderer

```ts
const renderer = await createCliRenderer({
	exitOnCtrlC: true,
})
```

---

## Renderer 参数

```ts
const renderer = await createCliRenderer({
	exitOnCtrlC: true,
	targetFps: 60,
	useAlternateScreen: true,
})
```

---

## 参数说明

| 参数               | 作用                  |
| ------------------ | --------------------- |
| exitOnCtrlC        | Ctrl+C 自动退出       |
| targetFps          | 渲染 FPS              |
| useAlternateScreen | 使用 alternate buffer |
| screenMode         | screen 模式           |
| footerHeight       | split-footer 高度     |

---

# 十一、Screen Modes(超级重要)

OpenTUI 有三种 screen 模式。

---

## 1. alternate-screen(默认)

```ts
screenMode: "alternate-screen"
```

行为:

```txt
进入 fullscreen terminal
退出恢复原 terminal
```

类似:

```txt
vim
htop
lazygit
```

---

## 2. main-screen

```ts
screenMode: "main-screen"
```

直接渲染到当前 terminal。

适合:

- 调试
- 简单 UI
- benchmark

---

## 3. split-footer(最重要)

OpenTUI 的 AI Agent 核心能力之一。

```ts
screenMode: "split-footer"
```

效果:

```txt
terminal 普通输出在上面
固定 footer TUI 在下面
```

类似:

```txt
Claude Code
OpenCode
Cursor Terminal
```

---

## split-footer 示例

```ts
const renderer = await createCliRenderer({
	screenMode: "split-footer",
	footerHeight: 12,
})
```

---

# 十二、Text 组件

---

## 最简单文本

```tsx
<text>Hello</text>
```

---

## 颜色

```tsx
<text fg='#00ff00'>Success</text>
```

---

## 背景色

```tsx
<text fg='#ffffff' bg='#ff0000'>
	ERROR
</text>
```

---

## 富文本

```tsx
<text>
	<strong>Bold</strong>
	<br />
	<em>Italic</em>
</text>
```

支持:

- strong
- b
- i
- em
- u
- span
- br

---

# 十三、Box 组件(布局核心)

类似:

```html
<div></div>
```

---

## Column Layout

```tsx
<box flexDirection='column'>
	<text>One</text>
	<text>Two</text>
</box>
```

---

## Row Layout

```tsx
<box flexDirection='row'>
	<text>A</text>
	<text>B</text>
</box>
```

---

## Padding

```tsx
<box padding={1}>
```

---

## Border

```tsx
<box
  borderStyle="rounded"
  borderColor="#00ff00"
>
```

---

## Width / Height

```tsx
<box width={40} height={10}>
```

---

# 十四、Flexbox(Yoga)

OpenTUI 使用 Yoga。

所以布局非常接近 Web。

---

## 支持属性

```tsx
flexDirection
justifyContent
alignItems
flexGrow
flexShrink
padding
margin
gap
```

---

## 示例

```tsx
<box
  flexDirection="row"
  justifyContent="space-between"
  alignItems="center"
>
```

---

# 十五、Input 输入组件

---

## Input

```tsx
<input value={value} onChange={setValue} />
```

---

## Textarea

```tsx
<textarea value={text} onChange={setText} />
```

---

## Select

```tsx
<select options={["React", "Vue", "Solid"]} />
```

---

# 十六、键盘事件

---

## useKeyboard

```tsx
useKeyboard((event) => {
	console.log(event)
})
```

---

## ESC 退出

```tsx
useKeyboard((event) => {
	if (event.name === "escape") {
		process.exit(0)
	}
})
```

---

# 十七、Resize 与 Terminal 尺寸

---

## 获取 Terminal 大小

```tsx
const { width, height } = useTerminalDimensions()
```

---

## Resize 监听

```tsx
useOnResize((w, h) => {
	console.log(w, h)
})
```

---

# 十八、ScrollBox(AI 场景核心)

这是 OpenTUI 最重要的组件之一。

适合:

- logs
- token streaming
- AI chat
- trace viewer
- terminal dashboard

---

## 示例

```tsx
<scrollbox height={20}>
	{logs.map((log) => (
		<text>{log}</text>
	))}
</scrollbox>
```

---

# 十九、Markdown(AI Agent 必备)

OpenTUI 原生支持 Markdown。

---

## 示例

```tsx
<markdown>{markdownText}</markdown>
```

适合:

- ChatGPT
- Claude
- AI assistant

---

# 二十、Code 组件(超级重要)

OpenTUI 内建:

```txt
Tree-sitter
```

进行语法高亮。

---

## 示例

```tsx
<code language='ts' code={sourceCode} />
```

支持:

- TypeScript
- JavaScript
- Rust
- Go
- Python
- 等等

---

# 二十一、Diff Viewer(杀手级功能)

OpenTUI 原生支持 diff。

这就是:

```txt
Claude Code 风格 UI 的核心
```

---

## Unified Diff

```tsx
<diff oldText={oldCode} newText={newCode} />
```

---

## Split Diff

```tsx
<diff split oldText={oldCode} newText={newCode} />
```

---

# 二十二、动画系统

OpenTUI 支持 timeline。

---

## 示例

```tsx
const timeline = useTimeline({
	duration: 2000,
})
```

---

## 动画属性

```tsx
timeline.add(
	{ width: 0 },
	{
		width: 50,
		duration: 2000,
	},
)
```

---

# 二十三、FrameBuffer(高级能力)

这是 OpenTUI 和 Ink 最大差距之一。

FrameBuffer 支持:

- drawText
- fillRect
- drawRect
- alpha blending
- cell rendering

适合:

- terminal game
- graph
- animation
- custom UI

---

# 二十四、Console Overlay

普通 terminal UI:

```txt
console.log 会破坏 UI
```

OpenTUI 有 console overlay。

---

## 开启 console overlay

```tsx
const renderer = useRenderer()

renderer.console.show()
```

之后:

```ts
console.log()
```

不会破坏界面。

---

# 二十五、状态管理

OpenTUI 本身不限制状态管理。

React 下都可以:

- useState
- useReducer
- zustand
- jotai
- redux

---

# 二十六、AI Agent 推荐架构(重点)

推荐:

```txt
Root
 ├── Header
 ├── Conversation Scrollbox
 ├── Markdown Renderer
 ├── Code Viewer
 ├── Diff Viewer
 ├── Status Bar
 └── Input Footer
```

推荐:

```txt
split-footer mode
```

因为它最适合:

```txt
terminal AI assistant
```

---

# 二十七、性能优化(重要)

---

## 1. 避免全树 rerender

不要:

```tsx
setState(bigObject)
```

---

## 2. Streaming 场景

推荐:

```txt
append-only rendering
```

不要:

```txt
每个 token 全量重建 markdown
```

---

## 3. 高频动画

不要:

```txt
React 60fps setState
```

推荐:

```txt
requestLive()
```

---

# 二十八、调试技巧

OpenTUI 支持 React DevTools。

---

## 开启 DEV

```bash
DEV=true bun index.tsx
```

之后:

```txt
React DevTools 可以连接
```

---

# 二十九、推荐项目结构

推荐:

```txt
src/
 ├── app/
 ├── components/
 ├── hooks/
 ├── renderer/
 ├── screens/
 ├── store/
 └── index.tsx
```

---

# 三十、OpenTUI 最佳实践

---

## 推荐做法

### 1. 使用 split-footer

AI 场景几乎必备。

---

### 2. UI 分层

推荐:

```txt
Layout
 → Panels
   → Widgets
```

不要:

```txt
一个大 App.tsx
```

---

### 3. Streaming 使用 append-only

不要反复重建整个 markdown。

---

### 4. 大数据使用 virtualization

尤其 logs / traces。

---

### 5. 保持 renderer 单例

不要重复 createCliRenderer。

---

# 三十一、什么时候不要使用 OpenTUI

不适合:

---

## 1. 简单 CLI

比如:

```txt
npm create xxx
```

Ink 更合适。

---

## 2. 低复杂度 Prompt

比如:

```txt
spinner + input
```

没必要。

---

## 3. Node-only 环境

OpenTUI 当前:

```txt
Bun-first
```

---

# 三十二、OpenTUI 最适合什么

最适合:

---

## AI Coding Agent

比如:

- Claude Code
- OpenCode
- terminal copilot

---

## IDE-like TUI

比如:

- diff viewer
- editor
- file tree
- markdown preview

---

## Streaming Dashboard

比如:

- logs
- observability
- traces
- CI UI

---

# 三十三、总结

OpenTUI 不是:

```txt
另一个 React CLI 库
```

它真正是:

```txt
Terminal Runtime
```

这是它和 Ink 最大区别。

---

# 最重要的一句话

```txt
Ink = React CLI Framework
OpenTUI = Terminal Application Platform
```

---

# 官方资源

官方文档:

https://opentui.com/docs/getting-started

React 文档:

https://opentui.com/docs/bindings/react

GitHub:

https://github.com/anomalyco/opentui

Renderer 文档:

https://opentui.com/docs/core-concepts/renderer

---

# 后续建议学习方向

建议下一步学习:

1. split-footer 实战
2. AI chat UI
3. Code viewer
4. Diff viewer
5. Streaming markdown
6. terminal virtualization
7. Tree-sitter
8. FrameBuffer
9. 自定义 renderable
10. OpenTUI renderer 生命周期

这些才是真正体现 OpenTUI 强大的地方。

---

# 三十四、从 0 到 1:构建一个最小 AI Chat TUI

这一节给出一个更接近真实项目的入门例子。

目标:

```txt
上方:消息历史
中间:Markdown 渲染
底部:输入框
快捷键:Enter 发送，Esc 退出
```

推荐先做这个版本，而不是一开始就做复杂 Agent。

---

## 1. 项目结构

```txt
src/
 ├── index.tsx
 ├── app.tsx
 ├── components/
 │   ├── ChatLayout.tsx
 │   ├── MessageList.tsx
 │   ├── MessageItem.tsx
 │   └── PromptInput.tsx
 ├── hooks/
 │   └── useChat.ts
 └── types.ts
```

这个结构的核心思想:

```txt
入口负责 renderer
App 负责组合
components 负责 UI
hooks 负责业务状态
```

不要把所有逻辑都写在 `index.tsx` 里。

---

## 2. 类型定义

### src/types.ts

```ts
export type ChatRole = "user" | "assistant" | "system"

export interface ChatMessage {
	id: string
	role: ChatRole
	content: string
	createdAt: number
}
```

这里暂时只定义最小字段。

后续可以扩展:

```ts
export interface ChatMessage {
	id: string
	role: ChatRole
	content: string
	createdAt: number
	status?: "streaming" | "done" | "error"
	metadata?: Record<string, unknown>
}
```

---

## 3. Chat Hook

### src/hooks/useChat.ts

```ts
import { useCallback, useState } from "react"
import type { ChatMessage } from "../types"

function createMessage(role: ChatMessage["role"], content: string): ChatMessage {
	return {
		id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
		role,
		content,
		createdAt: Date.now(),
	}
}

export function useChat() {
	const [messages, setMessages] = useState<ChatMessage[]>([
		createMessage("assistant", "你好，我是一个 OpenTUI AI Assistant 示例。"),
	])

	const sendMessage = useCallback((content: string) => {
		const trimmed = content.trim()

		if (!trimmed) {
			return
		}

		const userMessage = createMessage("user", trimmed)
		const assistantMessage = createMessage("assistant", `你刚才输入的是:\n\n${trimmed}`)

		setMessages((current) => [...current, userMessage, assistantMessage])
	}, [])

	return {
		messages,
		sendMessage,
	}
}
```

这个版本还没有接入真正的大模型。

但是 UI、状态流、消息结构已经搭好了。

---

## 4. MessageItem 组件

### src/components/MessageItem.tsx

```tsx
import type { ChatMessage } from "../types"

interface MessageItemProps {
	message: ChatMessage
}

export function MessageItem({ message }: MessageItemProps) {
	const isUser = message.role === "user"

	return (
		<box flexDirection='column' padding={1} borderStyle='rounded' borderColor={isUser ? "#4f8cff" : "#44cc88"}>
			<text fg={isUser ? "#4f8cff" : "#44cc88"}>{isUser ? "You" : "Assistant"}</text>

			<markdown>{message.content}</markdown>
		</box>
	)
}
```

注意:

```tsx
<markdown>{message.content}</markdown>
```

这就是 OpenTUI 在 AI Chat 场景里比普通 CLI 框架舒服的地方。

你不需要自己解析 markdown。

---

## 5. MessageList 组件

### src/components/MessageList.tsx

```tsx
import type { ChatMessage } from "../types"
import { MessageItem } from "./MessageItem"

interface MessageListProps {
	messages: ChatMessage[]
}

export function MessageList({ messages }: MessageListProps) {
	return (
		<scrollbox flexGrow={1} padding={1}>
			{messages.map((message) => (
				<MessageItem key={message.id} message={message} />
			))}
		</scrollbox>
	)
}
```

`scrollbox` 是 Chat UI 的核心。

没有它，消息一多，界面就会失控。

---

## 6. PromptInput 组件

### src/components/PromptInput.tsx

```tsx
import { useState } from "react"

interface PromptInputProps {
	onSubmit: (value: string) => void
}

export function PromptInput({ onSubmit }: PromptInputProps) {
	const [value, setValue] = useState("")

	return (
		<box borderStyle='rounded' borderColor='#888888' padding={1} flexDirection='column'>
			<text fg='#888888'>Enter 发送，Esc 退出</text>

			<input
				value={value}
				onChange={setValue}
				onSubmit={() => {
					onSubmit(value)
					setValue("")
				}}
			/>
		</box>
	)
}
```

不同版本的 OpenTUI 对 input 的事件命名可能会有差异。

如果当前版本没有 `onSubmit`，可以使用键盘事件手动处理 Enter。

---

## 7. ChatLayout 组件

### src/components/ChatLayout.tsx

```tsx
import type { ChatMessage } from "../types"
import { MessageList } from "./MessageList"
import { PromptInput } from "./PromptInput"

interface ChatLayoutProps {
	messages: ChatMessage[]
	onSubmit: (value: string) => void
}

export function ChatLayout({ messages, onSubmit }: ChatLayoutProps) {
	return (
		<box flexDirection='column' width='100%' height='100%'>
			<box padding={1} borderStyle='single' borderColor='#555555'>
				<text fg='#ffffff'>OpenTUI AI Chat Demo</text>
			</box>

			<MessageList messages={messages} />

			<PromptInput onSubmit={onSubmit} />
		</box>
	)
}
```

---

## 8. App 组件

### src/app.tsx

```tsx
import { useKeyboard } from "@opentui/react"
import { ChatLayout } from "./components/ChatLayout"
import { useChat } from "./hooks/useChat"

export function App() {
	const { messages, sendMessage } = useChat()

	useKeyboard((event) => {
		if (event.name === "escape") {
			process.exit(0)
		}
	})

	return <ChatLayout messages={messages} onSubmit={sendMessage} />
}
```

---

## 9. 入口文件

### src/index.tsx

```tsx
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { App } from "./app"

const renderer = await createCliRenderer({
	exitOnCtrlC: true,
	screenMode: "alternate-screen",
	targetFps: 30,
})

createRoot(renderer).render(<App />)
```

运行:

```bash
bun src/index.tsx
```

---

# 三十五、Streaming Markdown 实战

AI Agent 最常见的 UI 问题是:

```txt
模型输出是一个 token 一个 token 到达的
```

如果每来一个 token 就重新渲染整棵 React 树，性能会很差。

---

## 1. 简单版 Streaming

```ts
async function fakeStreamText(onToken: (token: string) => void) {
	const tokens = ["这是 ", "一个 ", "OpenTUI ", "Streaming ", "Markdown ", "示例。"]

	for (const token of tokens) {
		onToken(token)
		await new Promise((resolve) => setTimeout(resolve, 120))
	}
}
```

---

## 2. 在 React 中使用

```tsx
const [streamingText, setStreamingText] = useState("")

async function startStreaming() {
	setStreamingText("")

	await fakeStreamText((token) => {
		setStreamingText((current) => current + token)
	})
}
```

---

## 3. 渲染 Markdown

```tsx
<markdown>{streamingText}</markdown>
```

---

## 4. 性能注意

简单 demo 可以这样写。

真实项目建议:

```txt
token buffer → requestAnimationFrame / timer batch → setState
```

不要:

```txt
每个 token 都 setState
```

推荐:

```ts
let buffer = ""
let timer: ReturnType<typeof setTimeout> | undefined

function appendToken(token: string) {
	buffer += token

	if (timer) {
		return
	}

	timer = setTimeout(() => {
		setStreamingText((current) => current + buffer)
		buffer = ""
		timer = undefined
	}, 33)
}
```

这样大约每 33ms 更新一次 UI，接近 30fps。

---

# 三十六、接入真实 LLM 的推荐分层

不要在 UI 组件里直接请求模型。

推荐分层:

```txt
UI Component
  ↓
useChat Hook
  ↓
Chat Service
  ↓
LLM Provider
  ↓
OpenAI / Anthropic / Local Model
```

---

## 1. Provider 接口

```ts
export interface StreamChunk {
	type: "text" | "tool_call" | "done" | "error"
	text?: string
	error?: Error
}

export interface LLMProvider {
	stream(prompt: string): AsyncIterable<StreamChunk>
}
```

---

## 2. Chat Service

```ts
export class ChatService {
	constructor(private readonly provider: LLMProvider) {}

	async *send(prompt: string): AsyncIterable<StreamChunk> {
		for await (const chunk of this.provider.stream(prompt)) {
			yield chunk
		}
	}
}
```

---

## 3. UI 只消费事件

```ts
for await (const chunk of chatService.send(prompt)) {
	if (chunk.type === "text" && chunk.text) {
		appendToken(chunk.text)
	}
}
```

这样做的好处:

- UI 不关心供应商
- 可以替换 OpenAI / Anthropic / Ollama
- 测试更简单
- 后续接入 tool calling 更自然

---

# 三十七、Diff Viewer 实战:展示代码修改

AI Coding Agent 通常需要展示:

```txt
旧代码 → 新代码
```

OpenTUI 的 diff 组件非常适合这个场景。

---

## 示例

```tsx
const oldCode = `function add(a, b) {
  return a + b
}`

const newCode = `function add(a: number, b: number): number {
  return a + b
}`

<diff
	oldText={oldCode}
	newText={newCode}
	split
/>
```

---

## 推荐 UI

```txt
┌ File: src/math.ts ─────────────────────┐
│ old                         new        │
│ function add(a, b) {        function... │
└────────────────────────────────────────┘
```

---

## Agent 场景中的数据结构

```ts
export interface FilePatch {
	path: string
	oldText: string
	newText: string
	status: "pending" | "accepted" | "rejected"
}
```

---

## PatchCard 组件

```tsx
interface PatchCardProps {
	patch: FilePatch
}

export function PatchCard({ patch }: PatchCardProps) {
	return (
		<box flexDirection='column' borderStyle='rounded' padding={1}>
			<text fg='#ffaa00'>{patch.path}</text>
			<diff oldText={patch.oldText} newText={patch.newText} split />
			<text fg='#888888'>状态:{patch.status}</text>
		</box>
	)
}
```

---

# 三十八、Code Viewer 实战:展示代码块

OpenTUI 的 code 组件适合:

- 展示模型生成的代码
- 展示文件片段
- 展示工具调用结果
- 展示错误 stack trace

---

## 示例

```tsx
<code
	language='tsx'
	code={`export function Button() {
  return <button>Click</button>
}`}
/>
```

---

## 推荐封装

```tsx
interface CodeBlockProps {
	language: string
	code: string
	title?: string
}

export function CodeBlock({ language, code, title }: CodeBlockProps) {
	return (
		<box flexDirection='column' borderStyle='rounded' padding={1}>
			{title ? <text fg='#888888'>{title}</text> : null}
			<code language={language} code={code} />
		</box>
	)
}
```

---

# 三十九、Renderer 生命周期

OpenTUI 应用一般有这几个阶段:

```txt
创建 renderer
  ↓
创建 root
  ↓
渲染 App
  ↓
监听输入 / resize / state
  ↓
更新 render tree
  ↓
退出 cleanup
```

---

## 1. 创建阶段

```ts
const renderer = await createCliRenderer({
	exitOnCtrlC: true,
})
```

这里会初始化 terminal 能力。

例如:

- screen mode
- 输入协议
- 光标状态
- terminal buffer

---

## 2. 渲染阶段

```ts
createRoot(renderer).render(<App />)
```

这一步把 React tree 挂载到 OpenTUI renderer。

---

## 3. 更新阶段

React state 更新后:

```txt
React tree 更新
  ↓
OpenTUI binding 同步变化
  ↓
renderer 更新 buffer
  ↓
terminal 输出变化
```

---

## 4. 退出阶段

退出时要保证:

- 恢复 terminal
- 恢复 cursor
- 停止 timers
- 关闭 streams
- 终止 child process

建议统一封装:

```ts
function setupExitHandlers(cleanup: () => void) {
	const exit = () => {
		cleanup()
		process.exit(0)
	}

	process.on("SIGINT", exit)
	process.on("SIGTERM", exit)
}
```

---

# 四十、常见坑与排查

---

## 1. JSX 标签报错

现象:

```txt
Property 'box' does not exist on type JSX.IntrinsicElements
```

原因:

```txt
tsconfig 没有配置 jsxImportSource
```

解决:

```json
{
	"compilerOptions": {
		"jsx": "react-jsx",
		"jsxImportSource": "@opentui/react"
	}
}
```

---

## 2. console.log 把 UI 打乱

原因:

```txt
stdout 和 TUI renderer 同时写 terminal
```

解决:

- 使用 console overlay
- 或者 split-footer
- 或者把日志写入文件

---

## 3. Streaming 时卡顿

原因:

```txt
每个 token 都触发 React setState
```

解决:

```txt
buffer token，按 30fps 批量刷新
```

---

## 4. 退出后 terminal 异常

现象:

- 光标不显示
- terminal 不换行
- 输入显示异常

原因:

```txt
程序异常退出，没有 cleanup
```

解决:

- 捕获 SIGINT / SIGTERM
- 使用 exitOnCtrlC
- 开发阶段尽量避免强杀进程

---

## 5. Node 环境运行失败

原因:

```txt
OpenTUI 当前优先支持 Bun
```

解决:

```bash
bun src/index.tsx
```

不要直接:

```bash
node src/index.tsx
```

---

# 四十一、推荐学习路线

如果你要系统掌握 OpenTUI，建议按这个顺序:

```txt
1. Text / Box
2. Flexbox Layout
3. Input / Keyboard
4. ScrollBox
5. Markdown
6. Code
7. Diff
8. split-footer
9. Streaming UI
10. Renderer 生命周期
11. 自定义组件
12. FrameBuffer
13. AI Agent 架构
14. 性能优化
15. 自定义 renderable
```

不要一开始就研究 FrameBuffer 或自定义 renderable。

先把:

```txt
布局 + 输入 + scroll + markdown
```

这四个核心能力掌握。

---

# 四十二、OpenTUI 项目工程规范

---

## 1. Renderer 单独管理

推荐:

```txt
src/renderer/createRenderer.ts
```

```ts
import { createCliRenderer } from "@opentui/core"

export async function createAppRenderer() {
	return createCliRenderer({
		exitOnCtrlC: true,
		screenMode: "alternate-screen",
		targetFps: 30,
	})
}
```

---

## 2. App 不直接创建 renderer

不要:

```tsx
function App() {
	const renderer = createCliRenderer()
}
```

应该:

```txt
index.tsx 创建 renderer
App.tsx 只负责 UI
```

---

## 3. Service 不依赖 UI

不要:

```txt
LLMService import React component
```

应该:

```txt
React UI 调用 Service
Service 返回事件流
```

---

## 4. 组件尽量纯函数

组件只接收 props:

```tsx
<MessageList messages={messages} />
```

不要让组件自己读取太多全局状态。

---

# 四十三、一个更完整的 AI Agent UI 分层

推荐架构:

```txt
src/
 ├── index.tsx
 ├── app.tsx
 ├── renderer/
 │   └── createRenderer.ts
 ├── screens/
 │   ├── ChatScreen.tsx
 │   └── PatchScreen.tsx
 ├── components/
 │   ├── layout/
 │   │   ├── AppShell.tsx
 │   │   ├── Header.tsx
 │   │   └── StatusBar.tsx
 │   ├── chat/
 │   │   ├── MessageList.tsx
 │   │   ├── MessageItem.tsx
 │   │   └── PromptInput.tsx
 │   ├── code/
 │   │   ├── CodeBlock.tsx
 │   │   └── DiffBlock.tsx
 │   └── tools/
 │       └── ToolCallCard.tsx
 ├── services/
 │   ├── chat.service.ts
 │   ├── llm.provider.ts
 │   └── tools.service.ts
 ├── store/
 │   └── chat.store.ts
 └── types/
     ├── chat.ts
     ├── patch.ts
     └── tool.ts
```

核心原则:

```txt
UI 层不直接知道 LLM SDK
Service 层不直接知道 OpenTUI
Store 层管理状态
Renderer 层只负责终端 runtime
```

---

# 四十四、最终实践建议

如果你只是学习 OpenTUI:

```txt
先做一个 Chat Demo
```

如果你想做产品:

```txt
先确定 screenMode
```

如果你做 AI Agent:

```txt
优先研究 split-footer + scrollbox + markdown + diff
```

如果你做 IDE-like TUI:

```txt
优先研究 layout + code + diff + keyboard focus
```

如果你做高性能可视化:

```txt
优先研究 framebuffer + render loop
```

---

# 四十五、最后的判断标准

当你选择 OpenTUI 时，真正的问题不是:

```txt
它能不能写 CLI？
```

而是:

```txt
你的终端应用是否复杂到需要一个 runtime？
```

如果答案是:

```txt
是
```

那 OpenTUI 就非常值得投入。

如果答案是:

```txt
否
```

Ink、prompts、commander、enquirer 可能更合适。

```txt
OpenTUI 的价值不在于简单，而在于上限。
```
