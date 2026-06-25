/**
 * ToolResultPreview
 *
 * 职责:
 *   - 各工具类型的结构化结果展示
 *   - 根据工具类型渲染不同的预览格式
 *   - 处理成功和错误结果的显示
 *
 * 模块功能:
 *   - 支持多种工具类型的结果预览:
 *     - subagent: 显示子代理输出摘要
 *     - terminal-execute: 显示命令执行结果(stdout/stderr/exitCode)
 *     - filesystem-read: 显示读取的行数和范围
 *     - filesystem-create/edit: 显示操作结果消息
 *     - websearch-search/fetch: 显示搜索结果或抓取内容摘要
 *     - ace-*: 显示代码搜索结果(文本搜索、引用、大纲、语义搜索、定义)
 *     - todo-*: 显示 TODO 列表统计
 *     - ide-get_diagnostics: 显示诊断信息统计
 *   - 移除 ANSI 转义码
 *   - 截断长输出并显示省略提示
 *   - 区分子代理内部调用和直接调用的显示格式
 *
 * 使用场景:
 *   - 在对话中显示工具执行结果的简洁预览
 *   - 避免直接显示大量原始输出
 *   - 提供结构化的结果概览
 *
 * 边界:
 *   1. 仅处理 JSON 格式的工具结果
 *   2. 无法解析时返回 null
 *   3. 部分工具类型(如 skill-execute)无预览
 *   4. 输出长度限制由 maxLines 参数控制
 *
 * 流程:
 *   1. 解析工具结果为 JSON
 *   2. 根据工具名称选择对应的预览组件
 *   3. 渲染结构化的结果摘要
 */

import { For, Show, createMemo } from "solid-js";
import { useTheme } from "@/ui/contexts/theme";

// ─── Props 类型 ────────────────────────────────────────────

interface ToolResultPreviewProps {
  toolName: string;
  result: string;
  maxLines?: number;
  isSubAgentInternal?: boolean;
}

// ─── 工具函数 ──────────────────────────────────────────────

/** 移除 ANSI 转义码 */
function removeAnsiCodes(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

/** 截取文本行 */
function sliceLines(text: string | undefined, limit: number): { lines: string[]; truncated: boolean } {
  if (!text) {
    return { lines: [], truncated: false };
  }
  const lines = text.split("\n");
  if (lines.length <= limit) {
    return { lines, truncated: false };
  }
  return { lines: lines.slice(0, limit), truncated: true };
}

/** 尝试解析 JSON */
function tryParseJSON(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ─── 各工具类型的渲染函数 ──────────────────────────────────

function SubAgentPreview(props: { data: any; colors: ReturnType<typeof useTheme>["colors"] }) {
  if (!props.data.result) {
    return null;
  }

  const lines = () => (props.data.result as string).split("\n").filter((line: string) => line.trim());

  return (
    <box paddingLeft={2}>
      <text fg={props.colors.muted}>{`└─ Sub-agent completed (${lines().length} lines output)`}</text>
    </box>
  );
}

function TerminalExecutePreview(props: {
  data: any;
  maxLines: number;
  isSubAgentInternal: boolean;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const hasError = () => props.data.exitCode !== 0;
  const hasStdout = () => props.data.stdout && props.data.stdout.trim();
  const hasStderr = () => props.data.stderr && props.data.stderr.trim();

  const stdoutPreview = () => sliceLines(props.data.stdout, props.maxLines);
  const stderrPreview = () => sliceLines(props.data.stderr, props.maxLines);

  // 子代理内部调用:简洁展示
  if (props.isSubAgentInternal) {
    return (
      <box flexDirection="column" paddingLeft={2}>
        <Show when={props.data.command}>
          <box flexDirection="column">
            <text fg={props.colors.muted}>{"├─ command:"}</text>
            <box paddingLeft={2}>
              <text fg={props.colors.muted}>{props.data.command}</text>
            </box>
          </box>
        </Show>
        <text fg={hasError() ? props.colors.error : props.colors.muted}>{`├─ exitCode: ${props.data.exitCode}`}</text>
        <Show when={hasStdout()}>
          <box flexDirection="column">
            <text fg={props.colors.muted}>{"├─ stdout:"}</text>
            <box flexDirection="column" paddingLeft={2}>
              <For each={stdoutPreview().lines}>
                {(line) => <text fg={props.colors.text}>{removeAnsiCodes(line)}</text>}
              </For>
              <Show when={stdoutPreview().truncated}>
                <text fg={props.colors.muted}>{"…"}</text>
              </Show>
            </box>
          </box>
        </Show>
        <Show when={hasStderr()}>
          <box flexDirection="column">
            <text fg={hasError() ? props.colors.error : props.colors.muted}>{"└─ stderr:"}</text>
            <box flexDirection="column" paddingLeft={2}>
              <For each={stderrPreview().lines}>
                {(line) => (
                  <text fg={hasError() ? props.colors.error : props.colors.muted}>{removeAnsiCodes(line)}</text>
                )}
              </For>
              <Show when={stderrPreview().truncated}>
                <text fg={props.colors.muted}>{"…"}</text>
              </Show>
            </box>
          </box>
        </Show>
      </box>
    );
  }

  // 成功时简洁展示
  if (!hasError()) {
    return (
      <box flexDirection="column" paddingLeft={2}>
        <Show when={props.data.command}>
          <box flexDirection="column">
            <text fg={props.colors.success}>{"├─ command:"}</text>
            <box paddingLeft={2}>
              <text fg={props.colors.success}>{props.data.command}</text>
            </box>
          </box>
        </Show>
        <text fg={props.colors.success}>{`├─ exitCode: ${props.data.exitCode} ✓`}</text>
        <Show when={hasStdout()}>
          <box flexDirection="column">
            <text fg={props.colors.muted}>{"├─ stdout:"}</text>
            <box flexDirection="column" paddingLeft={2}>
              <For each={props.data.stdout.split("\n")}>
                {(line) => <text fg={props.colors.text}>{removeAnsiCodes(line)}</text>}
              </For>
            </box>
          </box>
        </Show>
        <Show when={props.data.executedAt}>
          <text fg={props.colors.muted}>{`└─ executedAt: ${props.data.executedAt}`}</text>
        </Show>
      </box>
    );
  }

  // 错误时完整展示
  return (
    <box flexDirection="column" paddingLeft={2}>
      <Show when={props.data.command}>
        <box flexDirection="column">
          <text fg={props.colors.muted}>{"├─ command:"}</text>
          <box paddingLeft={2}>
            <text fg={props.colors.muted}>{props.data.command}</text>
          </box>
        </box>
      </Show>
      <text fg={props.colors.error} {...({ bold: true } as any)}>
        {`├─ exitCode: ${props.data.exitCode} FAILED`}
      </text>
      <Show when={hasStdout()}>
        <box flexDirection="column">
          <text fg={props.colors.muted}>{"├─ stdout:"}</text>
          <box flexDirection="column" paddingLeft={2}>
            <For each={props.data.stdout.split("\n")}>
              {(line) => <text fg={props.colors.warning}>{removeAnsiCodes(line)}</text>}
            </For>
          </box>
        </box>
      </Show>
      <Show when={hasStderr()}>
        <box flexDirection="column">
          <text fg={props.colors.error}>{"├─ stderr:"}</text>
          <box flexDirection="column" paddingLeft={2}>
            <For each={props.data.stderr.split("\n")}>
              {(line) => <text fg={props.colors.error}>{removeAnsiCodes(line)}</text>}
            </For>
          </box>
        </box>
      </Show>
      <Show when={props.data.executedAt}>
        <text fg={props.colors.muted}>{`└─ executedAt: ${props.data.executedAt}`}</text>
      </Show>
    </box>
  );
}

function ReadPreview(props: { data: any; isSubAgentInternal: boolean; colors: ReturnType<typeof useTheme>["colors"] }) {
  if (!props.data.content) {
    return null;
  }

  const lines = () => props.data.content.split("\n");
  const readLineCount = () => lines().length;
  const totalLines = () => props.data.totalLines || readLineCount();
  const rangeInfo = () =>
    props.data.startLine && props.data.endLine ? ` (lines ${props.data.startLine}-${props.data.endLine})` : "";

  if (props.isSubAgentInternal) {
    return (
      <box paddingLeft={2}>
        <text fg={props.colors.muted}>
          {`└─ Read ${readLineCount()} lines${totalLines() > readLineCount() ? ` of ${totalLines()} total` : ""}`}
        </text>
      </box>
    );
  }

  return (
    <box paddingLeft={2}>
      <text fg={props.colors.muted}>
        {`└─ Read ${readLineCount()} lines${rangeInfo()}${totalLines() > readLineCount() ? ` of ${totalLines()} total` : ""}`}
      </text>
    </box>
  );
}

function CreatePreview(props: { data: any; colors: ReturnType<typeof useTheme>["colors"] }) {
  return (
    <box paddingLeft={2}>
      <text fg={props.colors.muted}>{`└─ ${props.data.message || String(props.data)}`}</text>
    </box>
  );
}

function EditPreview(props: { data: any; colors: ReturnType<typeof useTheme>["colors"] }) {
  return (
    <box flexDirection="column" paddingLeft={2}>
      <Show when={props.data.message}>
        <text fg={props.colors.muted}>{`├─ ${props.data.message}`}</text>
      </Show>
      <Show when={props.data.matchLocation}>
        <text fg={props.colors.muted}>
          {`├─ Match: lines ${props.data.matchLocation.startLine}-${props.data.matchLocation.endLine}`}
        </text>
      </Show>
      <Show when={props.data.totalLines}>
        <text fg={props.colors.muted}>{`└─ Total lines: ${props.data.totalLines}`}</text>
      </Show>
    </box>
  );
}

function WebSearchPreview(props: { data: any; colors: ReturnType<typeof useTheme>["colors"] }) {
  const hasResults = () => props.data.results && props.data.results.length > 0;

  return (
    <box paddingLeft={2}>
      <Show
        when={hasResults()}
        fallback={<text fg={props.colors.muted}>{`└─ No results for "${props.data.query}"`}</text>}
      >
        <text fg={props.colors.muted}>
          {`└─ Found ${props.data.totalResults || props.data.results.length} results for "${props.data.query}"`}
        </text>
      </Show>
    </box>
  );
}

function WebFetchPreview(props: { data: any; colors: ReturnType<typeof useTheme>["colors"] }) {
  const contentLength = () => props.data.textLength || props.data.content?.length || 0;

  return (
    <box paddingLeft={2}>
      <text fg={props.colors.muted}>
        {`└─ Fetched ${contentLength()} characters from ${props.data.title || "page"}`}
      </text>
    </box>
  );
}

function ACEPreview(props: {
  toolName: string;
  data: any;
  maxLines: number;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const data = () => props.data;

  // Text_search 结果
  const isTextSearch = () =>
    Array.isArray(data()) && data().length > 0 && data()[0] && "content" in data()[0] && "line" in data()[0];

  // Find_references 结果
  const isReferences = () => Array.isArray(data()) && data().length > 0 && data()[0] && "referenceType" in data()[0];

  // File_outline 结果
  const isOutline = () =>
    Array.isArray(data()) &&
    (data().length === 0 ||
      (data()[0] &&
        "name" in data()[0] &&
        "type" in data()[0] &&
        !("referenceType" in data()[0]) &&
        !("content" in data()[0])));

  // Semantic_search 结果
  const isSemantic = () =>
    data() &&
    typeof data() === "object" &&
    !Array.isArray(data()) &&
    ("symbols" in data() || "references" in data()) &&
    "totalResults" in data();

  // Find_definition 结果
  const isDefinition = () =>
    data() &&
    typeof data() === "object" &&
    !Array.isArray(data()) &&
    "name" in data() &&
    "filePath" in data() &&
    "line" in data() &&
    !("totalResults" in data());

  return (
    <Show
      when={!Array.isArray(data()) || data().length > 0}
      fallback={
        <box paddingLeft={2}>
          <text fg={props.colors.muted}>{"└─ No matches found"}</text>
        </box>
      }
    >
      <Show when={isTextSearch()}>
        <box paddingLeft={2}>
          <text fg={props.colors.muted}>
            {`└─ Found ${data().length}${data().length === 1 ? " match" : " matches"}`}
          </text>
        </box>
      </Show>
      <Show when={isReferences()}>
        <box paddingLeft={2}>
          <text fg={props.colors.muted}>
            {`└─ Found ${data().length}${data().length === 1 ? " reference" : " references"}`}
          </text>
        </box>
      </Show>
      <Show when={isOutline() && Array.isArray(data())}>
        <Show
          when={data().length === 0}
          fallback={
            <box paddingLeft={2}>
              <text fg={props.colors.muted}>
                {`└─ Found ${data().length}${data().length === 1 ? " symbol" : " symbols"} in file`}
              </text>
            </box>
          }
        >
          <box paddingLeft={2}>
            <text fg={props.colors.muted}>{"└─ No symbols in file"}</text>
          </box>
        </Show>
      </Show>
      <Show when={isSemantic()}>
        <box flexDirection="column" paddingLeft={2}>
          <text fg={props.colors.muted}>
            {`├─ ${data().symbols?.length || 0}${(data().symbols?.length || 0) === 1 ? " symbol" : " symbols"}`}
          </text>
          <text fg={props.colors.muted}>
            {`└─ ${
              data().references?.length || 0
            }${(data().references?.length || 0) === 1 ? " reference" : " references"}`}
          </text>
        </box>
      </Show>
      <Show when={isDefinition()}>
        <box paddingLeft={2}>
          <text fg={props.colors.muted}>
            {`└─ Found ${data().type} ${data().name} at ${data().filePath}:${data().line}`}
          </text>
        </box>
      </Show>
    </Show>
  );
}

function TodoPreview(props: { data: any; colors: ReturnType<typeof useTheme>["colors"] }) {
  let todoData = props.data;

  // MCP 格式提取
  if (props.data.content?.[0]?.text) {
    const textContent = props.data.content[0].text;
    if (textContent === "No TODO list found" || textContent === "TODO item not found") {
      return (
        <box paddingLeft={2}>
          <text fg={props.colors.muted}>{`└─ ${textContent}`}</text>
        </box>
      );
    }
    try {
      todoData = JSON.parse(textContent);
    } catch {
      return (
        <box paddingLeft={2}>
          <text fg={props.colors.muted}>{`└─ ${textContent}`}</text>
        </box>
      );
    }
  }

  if (!todoData.todos || !Array.isArray(todoData.todos)) {
    return (
      <box paddingLeft={2}>
        <text fg={props.colors.muted}>{`└─ ${todoData.message || "No TODO list"}`}</text>
      </box>
    );
  }

  const total = todoData.todos.length;
  const completed = todoData.todos.filter((t: any) => t.status === "completed").length;
  const pending = total - completed;

  return (
    <box paddingLeft={2}>
      <text fg={props.colors.muted}>{`└─ TODO: ${pending} pending, ${completed} completed (total: ${total})`}</text>
    </box>
  );
}

function IdeDiagnosticsPreview(props: { data: any; colors: ReturnType<typeof useTheme>["colors"] }) {
  if (!props.data.diagnostics || !Array.isArray(props.data.diagnostics)) {
    return (
      <box paddingLeft={2}>
        <text fg={props.colors.muted}>{"└─ No diagnostics data"}</text>
      </box>
    );
  }

  const count = props.data.diagnostics.length;
  if (count === 0) {
    return (
      <box paddingLeft={2}>
        <text fg={props.colors.muted}>{"└─ No diagnostics found"}</text>
      </box>
    );
  }

  const errors = props.data.diagnostics.filter((d: any) => d.severity === "error").length;
  const warnings = props.data.diagnostics.filter((d: any) => d.severity === "warning").length;

  return (
    <box paddingLeft={2}>
      <text fg={props.colors.muted}>
        {`└─ Found ${count} diagnostic(s)${
          errors > 0 ? ` (${errors} error${errors > 1 ? "s" : ""})` : ""
        }${warnings > 0 ? ` (${warnings} warning${warnings > 1 ? "s" : ""})` : ""}`}
      </text>
    </box>
  );
}

function GenericPreview(props: { data: any; maxLines: number; colors: ReturnType<typeof useTheme>["colors"] }) {
  if (typeof props.data !== "object" || props.data === null) {
    return null;
  }

  const entries = () => Object.entries(props.data).slice(0, props.maxLines);
  if (entries().length === 0) {
    return null;
  }

  return (
    <box flexDirection="column" paddingLeft={2}>
      <For each={entries()}>
        {(entry, idx) => {
          const [key, value] = entry;
          const valueStr =
            typeof value === "string"
              ? value.slice(0, 20) + (value.length > 20 ? "..." : "")
              : JSON.stringify(value).slice(0, 60);
          const prefix = idx() === entries().length - 1 ? "└─ " : "├─ ";

          return <text fg={props.colors.muted}>{`${prefix + key}: ${valueStr}`}</text>;
        }}
      </For>
    </box>
  );
}

// ─── 主组件 ────────────────────────────────────────────────

export function ToolResultPreview(props: ToolResultPreviewProps) {
  const theme = useTheme();
  const maxLines = () => props.maxLines ?? 5;

  const parsedData = createMemo(() => tryParseJSON(props.result));

  return (
    <Show when={parsedData() !== null}>
      {(() => {
        const data = parsedData()!;
        const c = theme.colors;
        const name = props.toolName;

        // 子代理
        if (name.startsWith("subagent-")) {
          return <SubAgentPreview data={data} colors={c} />;
        }
        // 终端执行
        if (name === "terminal-execute") {
          return (
            <TerminalExecutePreview
              data={data}
              maxLines={maxLines()}
              isSubAgentInternal={props.isSubAgentInternal ?? false}
              colors={c}
            />
          );
        }
        // 文件读取
        if (name === "filesystem-read") {
          return <ReadPreview data={data} isSubAgentInternal={props.isSubAgentInternal ?? false} colors={c} />;
        }
        // 文件创建
        if (name === "filesystem-create") {
          return <CreatePreview data={data} colors={c} />;
        }
        // 文件编辑
        if (name === "filesystem-edit" || name === "filesystem-replaceedit") {
          return <EditPreview data={data} colors={c} />;
        }
        // 搜索
        if (name === "websearch-search") {
          return <WebSearchPreview data={data} colors={c} />;
        }
        // 抓取
        if (name === "websearch-fetch") {
          return <WebFetchPreview data={data} colors={c} />;
        }
        // ACE 代码搜索
        if (name.startsWith("ace-")) {
          return <ACEPreview toolName={name} data={data} maxLines={maxLines()} colors={c} />;
        }
        // TODO
        if (name.startsWith("todo-")) {
          return <TodoPreview data={data} colors={c} />;
        }
        // IDE 诊断
        if (name === "ide-get_diagnostics") {
          return <IdeDiagnosticsPreview data={data} colors={c} />;
        }
        // Skill-execute 无预览
        if (name === "skill-execute") {
          return null;
        }
        // 通用预览
        return <GenericPreview data={data} maxLines={maxLines()} colors={c} />;
      })()}
    </Show>
  );
}
