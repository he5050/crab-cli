/**
 * WorkingDirectoryPanel
 *
 * 职责:
 *   - 管理 crab-cli 的工作目录列表
 *   - 支持本地目录和 SSH 远程目录的添加/删除/设置默认
 *   - 提供键盘导航和交互界面
 *
 * 模块功能:
 *   - 显示已配置的工作目录列表
 *   - 添加本地目录(输入路径)
 *   - 添加 SSH 远程目录(分步输入主机、用户名、路径)
 *   - 设置默认工作目录
 *   - 删除工作目录
 *
 * 使用场景:
 *   - 用户需要管理多个项目工作目录时
 *   - 需要切换默认工作目录时
 *   - 需要添加远程 SSH 开发环境时
 *
 * 边界:
 *   1. 目录数据持久化由 @config/workingDir 管理
 *   2. 不处理实际的 SSH 连接，仅存储配置
 *   3. 默认目录只能有一个
 *   4. 当前默认目录不能被删除
 *
 * 流程:
 *   1. 初始化时加载目录列表
 *   2. 渲染列表界面，支持键盘导航
 *   3. 根据用户选择进入添加流程或执行操作
 *   4. 添加本地目录:输入路径 → 验证 → 保存
 *   5. 添加 SSH 目录:输入主机 → 用户名 → 路径 → 保存
 *   6. 操作完成后刷新列表
 */

import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "@/ui/contexts/theme";
import {
  type WorkingDirectory,
  addSSHWorkingDirectory,
  addWorkingDirectory,
  getWorkingDirectories,
  removeWorkingDirectories,
  setDefaultWorkingDirectory,
} from "@config";
import { actionSelect, iconBuiltin, iconCustom, iconDefault, iconError } from "@/ui/utils/icon";

// ─── 页面层级 ──────────────────────────────────────────────

type Screen = "list" | "add-local" | "add-ssh-host" | "add-ssh-user" | "add-ssh-path";

// ─── Props ─────────────────────────────────────────────────

export interface WorkingDirectoryPanelProps {
  onClose: () => void;
}

// ─── WorkingDirectoryPanel 组件 ─────────────────────────────

export function WorkingDirectoryPanel(props: WorkingDirectoryPanelProps) {
  const theme = useTheme();

  // 页面状态
  const [screen, setScreen] = createSignal<Screen>("list");
  const [focusIndex, setFocusIndex] = createSignal(0);
  const [errorMessage, setErrorMessage] = createSignal("");

  // 目录列表
  const [dirs, setDirs] = createSignal<WorkingDirectory[]>([]);

  // SSH 添加表单
  const [sshHost, setSshHost] = createSignal("");
  const [sshUser, setSshUser] = createSignal("");
  const [sshPath, setSshPath] = createSignal("");
  const [localPath, setLocalPath] = createSignal("");

  // 加载目录列表
  async function refreshDirs() {
    try {
      const d = await getWorkingDirectories();
      setDirs(d);
    } catch {
      setDirs([]);
    }
  }

  // 初始化加载
  createEffect(() => {
    refreshDirs();
  });

  // 列表选项
  const listOptions = createMemo(() => {
    const dirItems = dirs().map((dir, idx) => ({
      dir,
      label: `${dir.isDefault ? `${iconDefault} ` : "  "}${dir.isRemote ? `${iconCustom} ` : `${iconBuiltin} `}${dir.path}${dir.isDefault ? " (默认)" : ""}`,
      value: `dir-${idx}`,
    }));

    return [
      ...dirItems,
      { dir: null as any, label: "─".repeat(40), value: "__sep__" },
      { dir: null as any, label: "+ 添加本地目录", value: "__add-local__" },
      { dir: null as any, label: "+ 添加 SSH 远程目录", value: "__add-ssh__" },
      { dir: null as any, label: "← 返回", value: "__back__" },
    ];
  });

  // ─── 键盘处理 ────────────────────────────────────────

  useKeyboard((event) => {
    // 添加本地目录
    if (screen() === "add-local") {
      if (event.name === "escape") {
        setScreen("list");
        setFocusIndex(0);
        setLocalPath("");
      } else if (event.name === "return" || event.name === "enter") {
        const path = localPath().trim();
        if (path) {
          try {
            addWorkingDirectory(path);
            refreshDirs();
            setScreen("list");
            setLocalPath("");
            setErrorMessage("");
          } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : "添加失败");
          }
        }
      } else if (event.name === "backspace") {
        setLocalPath((v) => v.slice(0, -1));
      } else if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
        setLocalPath((v) => v + event.name);
      }
      return;
    }

    // SSH 添加步骤
    if (screen() === "add-ssh-host") {
      if (event.name === "escape") {
        setScreen("list");
        setFocusIndex(0);
        setSshHost("");
      } else if (event.name === "return" || event.name === "enter") {
        if (sshHost().trim()) {
          setScreen("add-ssh-user");
        }
      } else if (event.name === "backspace") {
        setSshHost((v) => v.slice(0, -1));
      } else if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
        setSshHost((v) => v + event.name);
      }
      return;
    }

    if (screen() === "add-ssh-user") {
      if (event.name === "escape") {
        setScreen("add-ssh-host");
        setSshUser("");
      } else if (event.name === "return" || event.name === "enter") {
        if (sshUser().trim()) {
          setScreen("add-ssh-path");
        }
      } else if (event.name === "backspace") {
        setSshUser((v) => v.slice(0, -1));
      } else if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
        setSshUser((v) => v + event.name);
      }
      return;
    }

    if (screen() === "add-ssh-path") {
      if (event.name === "escape") {
        setScreen("add-ssh-user");
        setSshPath("");
      } else if (event.name === "return" || event.name === "enter") {
        const host = sshHost().trim();
        const user = sshUser().trim();
        const path = sshPath().trim() || "~";
        if (host && user) {
          try {
            addSSHWorkingDirectory({ authMethod: "agent", host, port: 22, username: user }, path);
            refreshDirs();
            setScreen("list");
            setSshHost("");
            setSshUser("");
            setSshPath("");
            setFocusIndex(0);
            setErrorMessage("");
          } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : "添加失败");
          }
        }
      } else if (event.name === "backspace") {
        setSshPath((v) => v.slice(0, -1));
      } else if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
        setSshPath((v) => v + event.name);
      }
      return;
    }

    // 列表模式
    if (event.name === "escape") {
      props.onClose();
      return;
    }

    if (event.name === "up") {
      setFocusIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (event.name === "down") {
      setFocusIndex((i) => Math.min(listOptions().length - 1, i + 1));
      return;
    }

    // D 设置为默认
    if (event.name === "d" && !event.ctrl && !event.meta) {
      const idx = focusIndex();
      const opt = listOptions()[idx];
      if (opt && opt.dir) {
        setDefaultWorkingDirectory(opt.dir.path);
        refreshDirs();
      }
      return;
    }

    // Enter
    if (event.name === "return" || event.name === "enter") {
      const idx = focusIndex();
      const opt = listOptions()[idx];
      if (!opt) {
        return;
      }

      switch (opt.value) {
        case "__back__": {
          props.onClose();
          break;
        }
        case "__add-local__": {
          setScreen("add-local");
          setLocalPath("");
          break;
        }
        case "__add-ssh__": {
          setScreen("add-ssh-host");
          setSshHost("");
          setSshUser("");
          setSshPath("");
          break;
        }
        case "__sep__": {
          break;
        }
        default: {
          // 点击目录 → 设置为默认
          if (opt.dir) {
            setDefaultWorkingDirectory(opt.dir.path);
            refreshDirs();
          }
        }
      }
    }

    // Delete/Backspace 删除
    if (event.name === "delete" || (event.name === "backspace" && event.ctrl)) {
      const idx = focusIndex();
      const opt = listOptions()[idx];
      if (opt && opt.dir && !opt.dir.isDefault) {
        removeWorkingDirectories([opt.dir.path]);
        refreshDirs();
      }
    }
  });

  // ─── 渲染 ────────────────────────────────────────────

  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1}>
      {/* 标题 */}
      <box marginBottom={1}>
        <span style={{ fg: theme.colors.warning, "font-weight": "bold" }}>{"工作目录"}</span>
        <text fg={theme.colors.muted}>{` — ${dirs().length} 个目录`}</text>
      </box>

      {/* 错误 */}
      <Show when={errorMessage()}>
        <box marginBottom={1}>
          <text fg={theme.colors.error}>{`${iconError} ${errorMessage()}`}</text>
        </box>
      </Show>

      {/* 添加本地目录 */}
      <Show when={screen() === "add-local"}>
        <box flexDirection="column" paddingLeft={1}>
          <text fg={theme.colors.info}>{"输入本地目录路径:"}</text>
          <box paddingLeft={1} marginTop={1}>
            <text fg={theme.colors.accent}>{`${actionSelect} ${localPath()}_`}</text>
          </box>
          <box marginTop={1}>
            <text fg={theme.colors.muted}>{"Enter 添加 · Esc 取消"}</text>
          </box>
        </box>
      </Show>

      {/* SSH 添加 */}
      <Show when={screen() === "add-ssh-host"}>
        <box flexDirection="column" paddingLeft={1}>
          <text fg={theme.colors.info}>{"SSH 远程目录 — 输入主机地址:"}</text>
          <box paddingLeft={1} marginTop={1}>
            <text fg={theme.colors.accent}>{`${actionSelect} ${sshHost()}_`}</text>
          </box>
          <box marginTop={1}>
            <text fg={theme.colors.muted}>{"Enter 继续 · Esc 取消"}</text>
          </box>
        </box>
      </Show>

      <Show when={screen() === "add-ssh-user"}>
        <box flexDirection="column" paddingLeft={1}>
          <text fg={theme.colors.info}>{`主机: ${sshHost()} — 输入用户名:`}</text>
          <box paddingLeft={1} marginTop={1}>
            <text fg={theme.colors.accent}>{`${actionSelect} ${sshUser()}_`}</text>
          </box>
          <box marginTop={1}>
            <text fg={theme.colors.muted}>{"Enter 继续 · Esc 返回"}</text>
          </box>
        </box>
      </Show>

      <Show when={screen() === "add-ssh-path"}>
        <box flexDirection="column" paddingLeft={1}>
          <text fg={theme.colors.info}>{`${sshUser()}@${sshHost()} — 输入远程路径:`}</text>
          <box paddingLeft={1} marginTop={1}>
            <text fg={theme.colors.accent}>{`${actionSelect} ${sshPath()}_`}</text>
          </box>
          <box marginTop={1}>
            <text fg={theme.colors.muted}>{"Enter 确认 · Esc 返回"}</text>
          </box>
        </box>
      </Show>

      {/* 列表 */}
      <Show when={screen() === "list"}>
        <box flexDirection="column" paddingLeft={1}>
          <For each={listOptions()}>
            {(option, index) => {
              const isSelected = () => index() === focusIndex();
              const isSeparator = option.value === "__sep__";
              if (isSeparator) {
                return <text fg={theme.colors.muted}>{option.label}</text>;
              }
              return (
                <text
                  fg={isSelected() ? theme.colors.text : theme.colors.muted}
                  backgroundColor={isSelected() ? theme.colors.primary : undefined}
                  {...({} as any)}
                >
                  {`${isSelected() ? `${actionSelect} ` : "  "}${option.label}`}
                </text>
              );
            }}
          </For>
        </box>

        <box marginTop={1}>
          <text fg={theme.colors.muted}>
            {"↑↓ 导航 · Enter 选择/设为默认 · D 设为默认 · Ctrl+Backspace 删除 · Esc 返回"}
          </text>
        </box>
      </Show>
    </box>
  );
}
