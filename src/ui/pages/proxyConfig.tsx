/**
 * 代理/连接配置页面
 *
 * 职责:
 *   - 配置 API Provider 连接参数
 *   - 管理 HTTP 代理设置
 *   - 查看提供商详情
 *
 * 模块功能:
 *   - 主菜单:代理设置、提供商列表
 *   - 提供商详情:名称、Base URL、模型数、API Key
 *   - 代理编辑:HTTP 代理地址输入
 *   - API URL 编辑:自定义 API 端点
 *
 * 使用场景:
 *   - 需要配置网络代理时
 *   - 使用自定义 API 端点时
 *   - 查看提供商配置信息
 *
 * 边界:
 *   1. 仅修改代理和 API URL 配置
 *   2. 不验证代理地址可达性
 *   3. API Key 在设置页面管理
 *
 * 流程:
 *   1. 加载当前代理和提供商配置
 *   2. 显示主菜单(代理设置 + 提供商列表)
 *   3. 进入编辑模式修改配置
 *   4. 保存到配置文件
 */

import { For, Show, createMemo, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "@/ui/contexts/theme";
import { type ProviderMeta, listProviders } from "@config";
import { loadConfig, saveConfig } from "@config";

// ─── 页面层级 ──────────────────────────────────────────────

type Screen = "main" | "provider-detail" | "edit-proxy" | "edit-api-url";

// ─── Props ─────────────────────────────────────────────────

export interface ProxyConfigProps {
  onClose: () => void;
}

// ─── ProxyConfigPage 组件 ──────────────────────────────────

export function ProxyConfigPage(props: ProxyConfigProps) {
  const theme = useTheme();

  // 页面状态
  const [screen, setScreen] = createSignal<Screen>("main");
  const [focusIndex, setFocusIndex] = createSignal(0);
  const [errorMessage, setErrorMessage] = createSignal("");

  // 提供商列表
  const providers = createMemo(() => listProviders());
  const [selectedProvider, setSelectedProvider] = createSignal<ProviderMeta | null>(null);

  // 编辑字段
  const [editValue, setEditValue] = createSignal("");
  const [editingField, setEditingField] = createSignal<"proxy" | "apiUrl">("proxy");

  // 主菜单选项
  const mainOptions = createMemo(() => {
    const provs = providers().map((p) => ({
      label: `◆ ${p.name} — ${p.baseUrl || "默认 URL"}${p.models.length > 0 ? ` (${p.models.length} 模型)` : ""}`,
      provider: p,
      value: `provider-${p.name}`,
    }));

    return [
      { label: "代理设置", provider: null as any, value: "proxy" },
      ...provs,
      { label: "← 返回", provider: null as any, value: "back" },
    ];
  });

  // 提供商详情选项
  const providerDetailOptions = createMemo(() => {
    const prov = selectedProvider();
    if (!prov) {
      return [];
    }

    return [
      { label: `名称: ${prov.name}`, value: "__name__" },
      { label: `Base URL: ${prov.baseUrl || "默认"}`, value: "edit-api-url" },
      { label: `模型数: ${prov.models.length}`, value: "__count__" },
      { label: `API Key: ${prov.envKey ? `环境变量 ${prov.envKey}` : "未设置"}`, value: "__key__" },
      { label: "← 返回", value: "back" },
    ];
  });

  const currentOptions = createMemo(() => {
    switch (screen()) {
      case "main": {
        return mainOptions();
      }
      case "provider-detail": {
        return providerDetailOptions();
      }
      default: {
        return [];
      }
    }
  });

  // ─── 键盘处理 ────────────────────────────────────────

  useKeyboard((event) => {
    // 编辑模式
    if (screen() === "edit-proxy" || screen() === "edit-api-url") {
      if (event.name === "escape") {
        setScreen("main");
        setFocusIndex(0);
        setEditValue("");
      } else if (event.name === "return" || event.name === "enter") {
        const field = editingField();
        try {
          if (field === "proxy") {
            void loadConfig().then((currentCfg) => {
              saveConfig({
                proxy: { ...currentCfg.proxy, url: editValue() || undefined },
              });
            });
          }
          setErrorMessage("");
        } catch (error) {
          setErrorMessage(error instanceof Error ? error.message : "保存失败");
        }
        setScreen("main");
        setFocusIndex(0);
        setEditValue("");
      } else if (event.name === "backspace") {
        setEditValue((v) => v.slice(0, -1));
      } else if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
        setEditValue((v) => v + event.name);
      }
      return;
    }

    // Escape
    if (event.name === "escape") {
      if (screen() === "provider-detail") {
        setScreen("main");
        setFocusIndex(0);
      } else {
        props.onClose();
      }
      return;
    }

    // 导航
    if (event.name === "up") {
      setFocusIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (event.name === "down") {
      setFocusIndex((i) => Math.min(currentOptions().length - 1, i + 1));
      return;
    }

    // Enter
    if (event.name === "return" || event.name === "enter") {
      const idx = focusIndex();

      if (screen() === "main") {
        const opt = mainOptions()[idx];
        if (!opt) {
          return;
        }
        if (opt.value === "back") {
          props.onClose();
        } else if (opt.value === "proxy") {
          // 加载当前代理设置
          loadConfig().then((cfg) => {
            setEditValue(cfg.proxy?.url || "");
            setEditingField("proxy");
            setScreen("edit-proxy");
          });
        } else if (opt.provider) {
          setSelectedProvider(opt.provider);
          setScreen("provider-detail");
          setFocusIndex(0);
        }
      } else if (screen() === "provider-detail") {
        const opt = providerDetailOptions()[idx];
        if (!opt) {
          return;
        }
        if (opt.value === "back") {
          setScreen("main");
          setFocusIndex(0);
        } else if (opt.value === "edit-api-url") {
          const prov = selectedProvider();
          setEditValue(prov?.baseUrl || "");
          setEditingField("apiUrl");
          setScreen("edit-api-url");
        }
      }
    }
  });

  // ─── 渲染 ────────────────────────────────────────────

  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1}>
      {/* 标题 */}
      <box marginBottom={1}>
        <span style={{ fg: theme.colors.warning, "font-weight": "bold" }}>{"连接配置"}</span>
        <text fg={theme.colors.muted}>{" — API Provider 和代理设置"}</text>
      </box>

      {/* 错误 */}
      <Show when={errorMessage()}>
        <box marginBottom={1}>
          <text fg={theme.colors.error}>{`✗ ${errorMessage()}`}</text>
        </box>
      </Show>

      {/* 编辑模式 */}
      <Show when={screen() === "edit-proxy" || screen() === "edit-api-url"}>
        <box flexDirection="column" paddingLeft={1}>
          <text fg={theme.colors.info}>
            {editingField() === "proxy" ? "设置 HTTP 代理地址 (如 http://127.0.0.1:7890):" : "设置 API Base URL:"}
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
      <Show when={screen() === "main" || screen() === "provider-detail"}>
        <box flexDirection="column" paddingLeft={1}>
          <For each={currentOptions()}>
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

        <box marginTop={1}>
          <text fg={theme.colors.muted}>{"↑↓ 导航 · Enter 选择 · Esc 返回"}</text>
        </box>
      </Show>
    </box>
  );
}
