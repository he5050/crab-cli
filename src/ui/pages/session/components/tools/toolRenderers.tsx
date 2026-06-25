/**
 * OpenCode 工具渲染器集合 — 多种工具类型的 UI 渲染组件。
 *
 * 职责:
 *   - 提供多种工具类型的渲染组件
 *   - 支持 Shell/Read/Write/Edit/Glob/Grep 等工具
 *   - 支持 WebFetch/WebSearch 工具
 *   - 支持 Todo/Question/Skill/Task 工具
 *   - 提供通用工具渲染器
 *
 * 模块功能:
 *   - ToolPartRenderer: 工具渲染器入口
 *   - ShellTool: Shell 命令渲染
 *   - ReadTool: 文件读取渲染
 *   - WriteTool: 文件写入渲染
 *   - EditTool: 文件编辑渲染
 *   - GlobTool: Glob 搜索渲染
 *   - GrepTool: Grep 搜索渲染
 *   - WebFetchTool/WebSearchTool: 网页工具渲染
 *   - TodoTool: 待办事项渲染
 *   - QuestionTool: 问题工具渲染
 *   - TaskTool: 任务工具渲染
 *   - GenericTool: 通用工具渲染
 *
 * 使用场景:
 *   - 聊天消息中的工具调用展示
 *   - 各种工具的差异化展示
 *
 * 边界:
 *   1. 仅负责 UI 渲染
 *   2. 根据工具类型选择对应渲染组件
 *   3. 支持展开/折叠和 diff 查看
 *   4. 依赖 toolRenderSpec 获取工具规格
 *
 * 流程:
 *   1. 解析工具类型
 *   2. 选择对应渲染组件
 *   3. 渲染工具详情(输入/输出/diff)
 *   4. 支持展开/折叠交互
 */
import { For, type JSX, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { SPINNER_FRAMES } from "@/ui/components/spinner";
import type { ToolPart } from "@/ui/contexts/chat";
import { useRoute } from "@/ui/contexts/route";
import type { ThemeColors } from "@/ui/contexts/theme";
import { buildToolDiffRoute } from "../toolDiffRoute";
import { InlineToolRow } from "./InlineTool";
import {
  BLOCK_MAX_OUTPUT_LINES,
  GENERIC_MAX_OUTPUT_LINES,
  LeftBorder,
  type RecordValue,
  arrayValue,
  blockBorderColor,
  collapseToolOutput,
  commandInput,
  copyToClip,
  createToolSyntaxStyle,
  failed,
  filetypeFromPath,
  formatInput,
  inlineColor,
  isRunning,
  numberValue,
  objectValue,
  pathInput,
  primaryInput,
  textValue,
} from "./toolRendererHelpers";
import {
  type ToolRenderSpec,
  getToolDiagnostics,
  getToolDiff,
  getToolFiles,
  getToolInput,
  resolveToolRenderer,
} from "./toolRenderSpec";

function ErrorBody(props: { part: ToolPart; colors: ThemeColors }) {
  const error = () => (props.part.output ?? props.part.detail ?? "").replace(/^Error:\s*/, "").trim();
  return (
    <Show when={failed(props.part) && error()}>
      <box paddingLeft={5} marginTop={1} flexShrink={0}>
        <text fg={props.colors.error}>{error().slice(0, 500)}</text>
      </box>
    </Show>
  );
}

function InlineToolCard(props: {
  part: ToolPart;
  colors: ThemeColors;
  spec: ToolRenderSpec;
  label: string;
  subtitle?: string;
  complete?: boolean;
  pending?: string;
  spinFrame?: number;
  onClick?: () => void;
}) {
  const running = () => isRunning(props.part);
  return (
    <box flexDirection="column" flexShrink={0}>
      <InlineToolRow
        icon={props.spec.icon}
        label={props.label}
        subtitle={props.subtitle}
        colors={{ ...props.colors, text: inlineColor(props.part, props.colors) }}
        complete={props.complete ?? !running()}
        failed={failed(props.part)}
        pendingText={props.pending ?? props.spec.pendingText}
        spinFrame={running() ? props.spinFrame : undefined}
        onClick={props.onClick}
      />
      <ErrorBody part={props.part} colors={props.colors} />
    </box>
  );
}

function BlockToolCard(props: {
  part: ToolPart;
  colors: ThemeColors;
  title: string;
  spinner?: boolean;
  onClick?: () => void;
  children: JSX.Element;
}) {
  return (
    <box paddingLeft={2} marginTop={1} flexShrink={0}>
      <box
        border={["left"]}
        borderColor={blockBorderColor(props.part, props.colors)}
        customBorderChars={LeftBorder}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        backgroundColor={props.colors.background}
        flexDirection="column"
        flexShrink={0}
        onMouseUp={props.onClick}
      >
        <text fg={props.colors.muted}>
          <Show when={props.spinner}>
            <span style={{ fg: props.colors.warning }}>{SPINNER_FRAMES[0]} </span>
          </Show>
          {props.title}
        </text>
        {props.children}
        <ErrorBody part={props.part} colors={props.colors} />
      </box>
    </box>
  );
}

function Diagnostics(props: { diagnostics: unknown[]; colors: ThemeColors }) {
  return (
    <Show when={props.diagnostics.length > 0}>
      <box marginTop={1} flexDirection="column" flexShrink={0}>
        <For each={props.diagnostics.slice(0, 3)}>
          {(item) => <text fg={props.colors.warning}>{typeof item === "string" ? item : JSON.stringify(item)}</text>}
        </For>
      </box>
    </Show>
  );
}

function ShellTool(props: ToolRendererProps) {
  const input = () => getToolInput(props.part);
  const command = () => commandInput(input());
  const output = () => (textValue(props.part.metadata?.["output"]) ?? props.part.output ?? "").trim();
  const [expanded, setExpanded] = createSignal(false);
  const collapsed = createMemo(() => collapseToolOutput(output(), BLOCK_MAX_OUTPUT_LINES));
  const limited = () => (expanded() || !collapsed().overflow ? output() : collapsed().output);
  const title = () => {
    const desc = textValue(input()["description"]) ?? "Shell";
    const workdir = textValue(input()["workdir"]);
    return workdir && workdir !== "." && !desc.includes(workdir) ? `# ${desc} in ${workdir}` : `# ${desc}`;
  };

  return (
    <Switch>
      <Match when={output()}>
        <BlockToolCard
          part={props.part}
          colors={props.colors}
          title={title()}
          spinner={isRunning(props.part)}
          onClick={collapsed().overflow ? () => setExpanded((value) => !value) : undefined}
        >
          <box marginTop={1} flexDirection="column" flexShrink={0}>
            <box flexDirection="row" gap={1} flexShrink={0}>
              <text fg={props.colors.text}>$ {command() ?? props.part.tool}</text>
              <Show when={command()}>
                <text fg={props.colors.muted} onMouseUp={() => copyToClip(command() ?? "", "命令已复制")}>
                  ⎘
                </text>
              </Show>
            </box>
            <Show when={limited()}>
              <text fg={failed(props.part) ? props.colors.error : props.colors.text}>{limited()}</text>
            </Show>
            <Show when={collapsed().overflow}>
              <text fg={props.colors.muted}>{expanded() ? "点击收起" : "点击展开"}</text>
            </Show>
          </box>
        </BlockToolCard>
      </Match>
      <Match when={true}>
        <InlineToolCard
          part={props.part}
          colors={props.colors}
          spec={props.spec}
          label={command() ?? "Shell"}
          complete={Boolean(command())}
          spinFrame={props.spinFrame}
        />
      </Match>
    </Switch>
  );
}

function ReadTool(props: ToolRendererProps) {
  const input = () => getToolInput(props.part);
  const loaded = () =>
    arrayValue(props.part.metadata?.["loaded"]).filter((item): item is string => typeof item === "string");
  const filePath = () => pathInput(input()) ?? props.part.detail ?? "file";
  return (
    <>
      <InlineToolCard
        part={props.part}
        colors={props.colors}
        spec={props.spec}
        label={`Read ${filePath()}`}
        subtitle={formatInput(input(), ["filePath", "file_path", "path"]) || undefined}
        complete={Boolean(pathInput(input())) && !isRunning(props.part)}
        spinFrame={props.spinFrame}
      />
      <For each={loaded()}>
        {(filepath) => (
          <box paddingLeft={6} flexShrink={0}>
            <text fg={props.colors.muted}>↳ Loaded {filepath}</text>
          </box>
        )}
      </For>
    </>
  );
}

function GlobTool(props: ToolRendererProps) {
  const input = () => getToolInput(props.part);
  const pattern = () => textValue(input()["pattern"]) ?? props.part.detail ?? "pattern";
  const path = () => textValue(input()["path"]);
  const count = () => numberValue(props.part.metadata?.["count"]);
  return (
    <InlineToolCard
      part={props.part}
      colors={props.colors}
      spec={props.spec}
      label={`Glob "${pattern()}"${path() ? ` in ${path()}` : ""}`}
      subtitle={count() !== undefined ? `(${count()} ${count() === 1 ? "match" : "matches"})` : undefined}
      complete={Boolean(textValue(input()["pattern"])) && !isRunning(props.part)}
      spinFrame={props.spinFrame}
    />
  );
}

function GrepTool(props: ToolRendererProps) {
  const input = () => getToolInput(props.part);
  const pattern = () => textValue(input()["pattern"]) ?? props.part.detail ?? "pattern";
  const path = () => textValue(input()["path"]);
  const count = () => numberValue(props.part.metadata?.["matches"]);
  return (
    <InlineToolCard
      part={props.part}
      colors={props.colors}
      spec={props.spec}
      label={`Grep "${pattern()}"${path() ? ` in ${path()}` : ""}`}
      subtitle={count() !== undefined ? `(${count()} ${count() === 1 ? "match" : "matches"})` : undefined}
      complete={Boolean(textValue(input()["pattern"])) && !isRunning(props.part)}
      spinFrame={props.spinFrame}
    />
  );
}

function WebFetchTool(props: ToolRendererProps) {
  const input = () => getToolInput(props.part);
  const url = () => textValue(input()["url"]) ?? props.part.detail ?? "url";
  return (
    <InlineToolCard
      part={props.part}
      colors={props.colors}
      spec={props.spec}
      label={`WebFetch ${url()}`}
      complete={Boolean(textValue(input()["url"])) && !isRunning(props.part)}
      spinFrame={props.spinFrame}
    />
  );
}

function webSearchProviderLabel(provider: unknown): string {
  if (typeof provider === "string" && provider.length > 0) {
    return provider;
  }
  const obj = objectValue(provider);
  if (obj) {
    return textValue(obj["name"]) ?? textValue(obj["id"]) ?? "WebSearch";
  }
  return "WebSearch";
}

function WebSearchTool(props: ToolRendererProps) {
  const input = () => getToolInput(props.part);
  const query = () => textValue(input()["query"]) ?? props.part.detail ?? "query";
  const results = () => numberValue(props.part.metadata?.["numResults"] ?? props.part.metadata?.["count"]);
  return (
    <InlineToolCard
      part={props.part}
      colors={props.colors}
      spec={props.spec}
      label={`${webSearchProviderLabel(props.part.metadata?.["provider"])} "${query()}"`}
      subtitle={results() !== undefined ? `(${results()} results)` : undefined}
      complete={Boolean(textValue(input()["query"])) && !isRunning(props.part)}
      spinFrame={props.spinFrame}
    />
  );
}

function WriteTool(props: ToolRendererProps) {
  const input = () => getToolInput(props.part);
  const filePath = () => pathInput(input()) ?? props.part.detail ?? "file";
  const diagnostics = () => getToolDiagnostics(props.part);
  const content = () => textValue(input()["content"]) ?? props.part.output ?? "";
  return (
    <Switch>
      <Match when={diagnostics().length > 0 || content()}>
        <BlockToolCard part={props.part} colors={props.colors} title={`# Wrote ${filePath()}`}>
          <Show when={content()}>
            <box
              marginTop={1}
              border={true}
              borderColor={props.colors.border}
              paddingLeft={1}
              paddingRight={1}
              flexShrink={0}
            >
              <code
                conceal={false}
                fg={props.colors.text}
                filetype={filetypeFromPath(filePath())}
                syntaxStyle={createToolSyntaxStyle(props.colors) as any}
                content={content().slice(0, 2000)}
              />
            </box>
          </Show>
          <Diagnostics diagnostics={diagnostics()} colors={props.colors} />
        </BlockToolCard>
      </Match>
      <Match when={true}>
        <InlineToolCard
          part={props.part}
          colors={props.colors}
          spec={props.spec}
          label={`Write ${filePath()}`}
          spinFrame={props.spinFrame}
        />
      </Match>
    </Switch>
  );
}

function EditTool(props: ToolRendererProps) {
  const input = () => getToolInput(props.part);
  const filePath = () => pathInput(input()) ?? getToolFiles(props.part)[0]?.path ?? props.part.detail ?? "file";
  const diff = () => getToolDiff(props.part);
  return (
    <Switch>
      <Match when={diff()}>
        <BlockToolCard part={props.part} colors={props.colors} title={`← Edit ${filePath()}`}>
          <DiffBody part={props.part} colors={props.colors} filePath={filePath()} diff={diff() ?? ""} />
          <Diagnostics diagnostics={getToolDiagnostics(props.part)} colors={props.colors} />
        </BlockToolCard>
      </Match>
      <Match when={true}>
        <InlineToolCard
          part={props.part}
          colors={props.colors}
          spec={props.spec}
          label={`Edit ${filePath()}`}
          subtitle={formatInput({ replaceAll: input()["replaceAll"] }).trim() || undefined}
          spinFrame={props.spinFrame}
        />
      </Match>
    </Switch>
  );
}

function ApplyPatchTool(props: ToolRendererProps) {
  const files = () => getToolFiles(props.part);
  const diff = () => getToolDiff(props.part);
  return (
    <Switch>
      <Match when={files().length > 0}>
        <For each={files()}>
          {(file) => (
            <BlockToolCard part={props.part} colors={props.colors} title={patchTitle(file)}>
              <Show when={file.diff ?? diff()}>
                <DiffBody
                  part={props.part}
                  colors={props.colors}
                  filePath={file.path}
                  diff={file.diff ?? diff() ?? ""}
                />
              </Show>
              <Diagnostics diagnostics={getToolDiagnostics(props.part)} colors={props.colors} />
            </BlockToolCard>
          )}
        </For>
      </Match>
      <Match when={diff()}>
        <BlockToolCard part={props.part} colors={props.colors} title="← Patched">
          <DiffBody
            part={props.part}
            colors={props.colors}
            filePath={primaryInput(getToolInput(props.part), ["filePath", "path"])}
            diff={diff() ?? ""}
          />
        </BlockToolCard>
      </Match>
      <Match when={true}>
        <InlineToolCard
          part={props.part}
          colors={props.colors}
          spec={props.spec}
          label="Patch"
          complete={false}
          spinFrame={props.spinFrame}
        />
      </Match>
    </Switch>
  );
}

function patchTitle(file: { path: string; kind?: string; status?: string }) {
  if (file.kind === "delete" || file.status === "deleted") {
    return `# Deleted ${file.path}`;
  }
  if (file.kind === "add" || file.status === "created") {
    return `# Created ${file.path}`;
  }
  if (file.kind === "move" || file.status === "moved") {
    return `# Moved ${file.path}`;
  }
  return `← Patched ${file.path}`;
}

function TodoTool(props: ToolRendererProps) {
  const input = () => getToolInput(props.part);
  const todos = () => {
    const fromMetadata = arrayValue(props.part.metadata?.["todos"]);
    const fromInput = arrayValue(input()["todos"]);
    return (fromMetadata.length > 0 ? fromMetadata : fromInput).map(objectValue).filter(Boolean) as RecordValue[];
  };
  return (
    <Switch>
      <Match when={todos().length > 0}>
        <BlockToolCard part={props.part} colors={props.colors} title="# Todos">
          <box marginTop={1} flexDirection="column" flexShrink={0}>
            <For each={todos()}>{(todo) => <TodoRow todo={todo} colors={props.colors} />}</For>
          </box>
        </BlockToolCard>
      </Match>
      <Match when={true}>
        <InlineToolCard
          part={props.part}
          colors={props.colors}
          spec={props.spec}
          label="Updating todos..."
          complete={false}
          spinFrame={props.spinFrame}
        />
      </Match>
    </Switch>
  );
}

function TodoRow(props: { todo: RecordValue; colors: ThemeColors }) {
  const status = () => textValue(props.todo["status"]) ?? "pending";
  const content = () => textValue(props.todo["content"]) ?? textValue(props.todo["text"]) ?? "";
  const marker = () =>
    status() === "completed"
      ? asciiCheck
      : status() === "in_progress" || status() === "running"
        ? asciiBulletGlyph
        : " ";
  const color = () =>
    status() === "in_progress" || status() === "running" ? props.colors.warning : props.colors.muted;
  return (
    <box flexDirection="row" flexShrink={0}>
      <text fg={color()} flexShrink={0}>
        [{marker()}]{" "}
      </text>
      <text fg={color()} flexGrow={1}>
        {content()}
      </text>
    </box>
  );
}

function QuestionTool(props: ToolRendererProps) {
  const input = () => getToolInput(props.part);
  const questions = () => arrayValue(input()["questions"]).map(objectValue).filter(Boolean) as RecordValue[];
  const answers = () => arrayValue(props.part.metadata?.["answers"]);
  const count = () => questions().length || numberValue(input()["count"]) || 0;
  return (
    <Switch>
      <Match when={answers().length > 0}>
        <BlockToolCard part={props.part} colors={props.colors} title="# Questions">
          <box marginTop={1} flexDirection="column" flexShrink={0}>
            <For each={questions()}>
              {(question, index) => (
                <box flexDirection="column" flexShrink={0}>
                  <text fg={props.colors.muted}>
                    {textValue(question["question"]) ?? textValue(question["content"]) ?? "Question"}
                  </text>
                  <text fg={props.colors.text}>{formatAnswer(answers()[index()])}</text>
                </box>
              )}
            </For>
          </box>
        </BlockToolCard>
      </Match>
      <Match when={true}>
        <InlineToolCard
          part={props.part}
          colors={props.colors}
          spec={props.spec}
          label={`Asked ${count()} question${count() === 1 ? "" : "s"}`}
          complete={count() > 0 && !isRunning(props.part)}
          spinFrame={props.spinFrame}
        />
      </Match>
    </Switch>
  );
}

function formatAnswer(answer: unknown): string {
  if (Array.isArray(answer)) {
    return answer.length > 0 ? answer.join(", ") : "(no answer)";
  }
  return textValue(answer) ?? "(no answer)";
}

function SkillTool(props: ToolRendererProps) {
  const input = () => getToolInput(props.part);
  const name = () => textValue(input()["name"]) ?? props.part.detail ?? "skill";
  return (
    <InlineToolCard
      part={props.part}
      colors={props.colors}
      spec={props.spec}
      label={`Skill "${name()}"`}
      complete={Boolean(textValue(input()["name"]))}
      spinFrame={props.spinFrame}
    />
  );
}

function TaskTool(props: ToolRendererProps) {
  const input = () => getToolInput(props.part);
  const route = useRoute();
  const sessionId = () =>
    props.part.subSessionId ??
    textValue(props.part.metadata?.["sessionId"]) ??
    textValue(input()["sessionId"]) ??
    textValue(input()["session_id"]);
  const description = () =>
    textValue(input()["description"]) ?? textValue(input()["task_description"]) ?? props.part.detail ?? "Task";
  const agent = () => textValue(input()["subagent_type"]) ?? textValue(input()["agent"]) ?? "General";
  const duration = () => (props.part.durationMs ? ` · ${props.part.durationMs}ms` : "");
  const label = () => `${agent()} Task — ${description()}${duration()}`;
  return (
    <InlineToolCard
      part={props.part}
      colors={props.colors}
      spec={props.spec}
      label={label()}
      subtitle={sessionId() ? `└ ${sessionId()}` : undefined}
      spinFrame={props.spinFrame}
      onClick={sessionId() ? () => route.navigate({ sessionId: sessionId()!, type: "session" }) : undefined}
    />
  );
}

function GenericTool(props: ToolRendererProps) {
  const input = () => getToolInput(props.part);
  const output = () => (props.part.output ?? "").trim();
  const [expanded, setExpanded] = createSignal(false);
  const collapsed = createMemo(() => collapseToolOutput(output(), GENERIC_MAX_OUTPUT_LINES));
  const limited = () => (expanded() || !collapsed().overflow ? output() : collapsed().output);
  return (
    <Switch>
      <Match when={output()}>
        <BlockToolCard
          part={props.part}
          colors={props.colors}
          title={`# ${props.part.tool} ${formatInput(input())}`}
          onClick={collapsed().overflow ? () => setExpanded((value) => !value) : undefined}
        >
          <box marginTop={1} flexDirection="column" flexShrink={0}>
            <text fg={failed(props.part) ? props.colors.error : props.colors.text}>{limited()}</text>
            <Show when={collapsed().overflow}>
              <text fg={props.colors.muted}>{expanded() ? "点击收起" : "点击展开"}</text>
            </Show>
          </box>
        </BlockToolCard>
      </Match>
      <Match when={true}>
        <InlineToolCard
          part={props.part}
          colors={props.colors}
          spec={props.spec}
          label={`${props.part.tool} ${formatInput(input())}`.trim()}
          spinFrame={props.spinFrame}
        />
      </Match>
    </Switch>
  );
}

function DiffBody(props: { part: ToolPart; colors: ThemeColors; filePath?: string; diff: string }) {
  const route = useRoute();
  const openDiffViewer = () => {
    const returnRoute =
      route.data.type === "session" ? { sessionId: route.data.sessionId, type: "session" as const } : undefined;
    const diffRoute = buildToolDiffRoute(props.part, returnRoute);
    if (diffRoute) {
      route.navigate(diffRoute);
    }
  };
  return (
    <box marginTop={1} flexDirection="column" flexShrink={0}>
      <box flexDirection="row" gap={1} flexShrink={0}>
        <text fg={props.colors.muted}>Diff:</text>
        <text fg={props.colors.primary} onMouseUp={openDiffViewer}>
          打开查看器
        </text>
      </box>
      <box marginTop={1} paddingLeft={1} flexShrink={0}>
        <diff
          diff={props.diff}
          view="unified"
          filetype={filetypeFromPath(props.filePath)}
          syntaxStyle={createToolSyntaxStyle(props.colors) as any}
          showLineNumbers={true}
          conceal={false}
        />
      </box>
    </box>
  );
}

interface ToolRendererProps {
  part: ToolPart;
  colors: ThemeColors;
  spec: ToolRenderSpec;
  spinFrame: number;
}

export function ToolPartRenderer(props: { part: ToolPart; colors: ThemeColors }) {
  const [spinFrame, setSpinFrame] = createSignal(0);
  const spec = createMemo(() => resolveToolRenderer(props.part));
  let timer: ReturnType<typeof setInterval> | undefined;

  createEffect(() => {
    if (!isRunning(props.part)) {
      if (timer) {
        clearInterval(timer);
      }
      timer = undefined;
      return;
    }
    if (timer) {
      return;
    }
    timer = setInterval(() => setSpinFrame((frame) => (frame + 1) % SPINNER_FRAMES.length), 80);
  });
  onCleanup(() => timer && clearInterval(timer));

  const rendererProps = () => ({
    colors: props.colors,
    part: props.part,
    spec: spec(),
    spinFrame: spinFrame(),
  });

  return (
    <Switch>
      <Match when={spec().name === "ShellTool"}>
        <ShellTool {...rendererProps()} />
      </Match>
      <Match when={spec().name === "GlobTool"}>
        <GlobTool {...rendererProps()} />
      </Match>
      <Match when={spec().name === "ReadTool"}>
        <ReadTool {...rendererProps()} />
      </Match>
      <Match when={spec().name === "GrepTool"}>
        <GrepTool {...rendererProps()} />
      </Match>
      <Match when={spec().name === "WebFetchTool"}>
        <WebFetchTool {...rendererProps()} />
      </Match>
      <Match when={spec().name === "WebSearchTool"}>
        <WebSearchTool {...rendererProps()} />
      </Match>
      <Match when={spec().name === "WriteTool"}>
        <WriteTool {...rendererProps()} />
      </Match>
      <Match when={spec().name === "EditTool" || spec().name === "MultiEditTool"}>
        <EditTool {...rendererProps()} />
      </Match>
      <Match when={spec().name === "ApplyPatchTool"}>
        <ApplyPatchTool {...rendererProps()} />
      </Match>
      <Match when={spec().name === "TodoTool"}>
        <TodoTool {...rendererProps()} />
      </Match>
      <Match when={spec().name === "QuestionTool"}>
        <QuestionTool {...rendererProps()} />
      </Match>
      <Match when={spec().name === "SkillTool"}>
        <SkillTool {...rendererProps()} />
      </Match>
      <Match when={spec().name === "TaskTool"}>
        <TaskTool {...rendererProps()} />
      </Match>
      <Match when={true}>
        <GenericTool {...rendererProps()} />
      </Match>
    </Switch>
  );
}

import { asciiCheck } from "@/core/icons/icon";
import { asciiBulletGlyph } from "@/core/icons/iconDerived";
