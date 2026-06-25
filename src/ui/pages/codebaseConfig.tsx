/**
 * 代码搜索配置页面
 *
 * 职责:
 *   - 配置代码搜索索引参数
 *   - 管理索引规则和文件过滤
 *
 * 模块功能:
 *   - 启用/禁用代码索引
 *   - 文件监听模式开关
 *   - 忽略模式配置(glob 模式)
 *   - 最大文件大小限制
 *   - 重建索引功能
 *
 * 使用场景:
 *   - 配置代码搜索行为
 *   - 排除不需要索引的文件
 *   - 优化索引性能
 *
 * 边界:
 *   1. 仅修改配置，不直接操作索引
 *   2. 忽略模式使用逗号分隔的 glob
 *   3. 修改后需手动重建索引
 *
 * 流程:
 *   1. 加载当前代码搜索配置
 *   2. 显示配置选项列表
 *   3. 处理开关切换和编辑
 *   4. 保存配置到文件
 */

import { For, Show, createMemo, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "@/ui/contexts/theme";
import { loadConfig, saveConfig } from "@config";
import { useEventBus } from "@/ui/contexts/eventBus";
import { AppEvent } from "@bus";
import { rebuildCodebaseIndex } from "@/tool/codebaseSearch/indexer/rebuildIndex";
import { checkboxIcon } from "@/core/icons/iconDerived";

// ─── Props ─────────────────────────────────────────────────

export interface CodebaseConfigProps {
  onClose: () => void;
}

// ─── CodebaseConfigPage 组件 ────────────────────────────────

export function CodebaseConfigPage(props: CodebaseConfigProps) {
  const eventBus = useEventBus();
  const theme = useTheme();

  const [focusIndex, setFocusIndex] = createSignal(0);
  const [errorMessage, setErrorMessage] = createSignal("");

  // 配置状态
  const [indexingEnabled, setIndexingEnabled] = createSignal(true);
  const [watchMode, setWatchMode] = createSignal(true);
  const [ignorePatterns, setIgnorePatterns] = createSignal("node_modules,.git,dist,build");
  const [maxFileSize, setMaxFileSize] = createSignal("1048576");

  // 加载配置
  loadConfig().then((cfg: any) => {
    if (cfg.codebase) {
      setIndexingEnabled(cfg.codebase.indexingEnabled ?? true);
      setWatchMode(cfg.codebase.watchMode ?? true);
      setIgnorePatterns(cfg.codebase.ignorePatterns?.join(",") || "node_modules,.git,dist,build");
      setMaxFileSize(cfg.codebase.maxFileSize?.toString() || "1048576");
    }
  });

  // 编辑状态
  const [editingField, setEditingField] = createSignal<string | null>(null);
  const [editValue, setEditValue] = createSignal("");

  const options = createMemo(() => [
    {
      info: "为代码搜索创建索引",
      label: `${indexingEnabled() ? checkboxIcon(true) : checkboxIcon(false)} 启用代码索引`,
      value: "toggle-indexing",
    },
    {
      info: "实时更新索引(文件变化时自动重建)",
      label: `${watchMode() ? checkboxIcon(true) : checkboxIcon(false)} 文件监听模式`,
      value: "toggle-watch",
    },
    {
      info: "逗号分隔的 glob 模式",
      label: `忽略模式: ${ignorePatterns()}`,
      value: "edit-ignore",
    },
    {
      info: "超过此大小的文件不索引",
      label: `最大文件大小: ${maxFileSize()} bytes`,
      value: "edit-maxsize",
    },
    { info: "完全重建搜索索引", label: "↺ 重建索引", value: "rebuild" },
    { info: "", label: "← 返回", value: "back" },
  ]);

  // ─── 保存配置 ────────────────────────────────────────

  async function saveCodebaseConfig() {
    try {
      const current = await loadConfig();
      const existing = current.codebase;
      await saveConfig({
        codebase: {
          documentTypes: existing.documentTypes,
          embedding: existing.embedding,
          ignorePatterns: ignorePatterns()
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          includeDocuments: existing.includeDocuments,
          indexingEnabled: indexingEnabled(),
          maxFileSize: parseInt(maxFileSize()) || 1_048_576,
          watchMode: watchMode(),
        },
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "保存失败");
    }
  }

  // ─── 键盘处理 ────────────────────────────────────────

  useKeyboard((event) => {
    // 编辑模式
    if (editingField()) {
      if (event.name === "escape") {
        setEditingField(null);
        setEditValue("");
      } else if (event.name === "return" || event.name === "enter") {
        const field = editingField();
        if (field === "ignore") {
          setIgnorePatterns(editValue());
        } else if (field === "maxsize") {
          setMaxFileSize(editValue());
        }
        setEditingField(null);
        setEditValue("");
        saveCodebaseConfig();
      } else if (event.name === "backspace") {
        setEditValue((v) => v.slice(0, -1));
      } else if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
        setEditValue((v) => v + event.name);
      }
      return;
    }

    if (event.name === "escape") {
      props.onClose();
      return;
    }

    if (event.name === "up") {
      setFocusIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (event.name === "down") {
      setFocusIndex((i) => Math.min(options().length - 1, i + 1));
      return;
    }

    if (event.name === "return" || event.name === "enter") {
      const idx = focusIndex();
      const opt = options()[idx];
      if (!opt) {
        return;
      }

      switch (opt.value) {
        case "toggle-indexing": {
          setIndexingEnabled((v) => !v);
          saveCodebaseConfig();
          break;
        }
        case "toggle-watch": {
          setWatchMode((v) => !v);
          saveCodebaseConfig();
          break;
        }
        case "edit-ignore": {
          setEditingField("ignore");
          setEditValue(ignorePatterns());
          break;
        }
        case "edit-maxsize": {
          setEditingField("maxsize");
          setEditValue(maxFileSize());
          break;
        }
        case "rebuild": {
          void rebuildCodebaseIndex({
            publishLog: (level, message) => {
              eventBus.publish(AppEvent.Log, { level, message });
            },
            showToast: (message, variant = "info") => {
              eventBus.publish(AppEvent.Toast, { message, variant });
            },
          }).catch((error) => {
            setErrorMessage(error instanceof Error ? error.message : "重建索引失败");
          });
          break;
        }
        case "back": {
          props.onClose();
          break;
        }
      }
    }
  });

  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <box marginBottom={1}>
        <span style={{ fg: theme.colors.warning, "font-weight": "bold" }}>{"代码搜索配置"}</span>
      </box>

      <Show when={errorMessage()}>
        <box marginBottom={1}>
          <text fg={theme.colors.error}>{`✗ ${errorMessage()}`}</text>
        </box>
      </Show>

      {/* 编辑模式 */}
      <Show when={editingField()}>
        <box flexDirection="column" paddingLeft={1}>
          <text fg={theme.colors.info}>
            {editingField() === "ignore" ? "编辑忽略模式(逗号分隔):" : "编辑最大文件大小 (bytes):"}
          </text>
          <box paddingLeft={1} marginTop={1}>
            <text fg={theme.colors.accent}>{`❯ ${editValue()}_`}</text>
          </box>
          <box marginTop={1}>
            <text fg={theme.colors.muted}>{"Enter 保存 · Esc 取消"}</text>
          </box>
        </box>
      </Show>

      {/* 列表模式 */}
      <Show when={!editingField()}>
        <box flexDirection="column" paddingLeft={1}>
          <For each={options()}>
            {(option, index) => {
              const isSelected = () => index() === focusIndex();
              return (
                <text
                  fg={isSelected() ? theme.colors.text : theme.colors.muted}
                  backgroundColor={isSelected() ? theme.colors.primary : undefined}
                  {...({} as any)}
                >
                  {`${isSelected() ? "❯ " : "  "}${option.label}`}
                </text>
              );
            }}
          </For>
        </box>

        {/* 信息提示 */}
        <Show when={options()[focusIndex()]?.info}>
          <box marginTop={1} paddingLeft={1}>
            <text fg={theme.colors.info}>{`ℹ ${options()[focusIndex()]?.info}`}</text>
          </box>
        </Show>

        <box marginTop={1}>
          <text fg={theme.colors.muted}>{"↑↓ 导航 · Enter 切换/编辑 · Esc 返回"}</text>
        </box>
      </Show>
    </box>
  );
}
