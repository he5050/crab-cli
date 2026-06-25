/**
 * 设置页面
 *
 * 职责:
 *   - 展示和编辑全局配置
 *   - 支持热重载和实时验证
 *   - 敏感信息隐藏显示
 *
 * 模块功能:
 *   - API 配置:提供商、模型、API Key
 *   - 界面配置:主题、开发模式
 *   - Profile 配置:切换配置环境
 *   - 搜索配置:Tavily API Key、Base URL
 *   - 配置分组折叠/展开
 *   - 实时 Zod 验证
 *   - 敏感信息掩码显示(sk-****xxxx)
 *   - 配置来源标记
 *
 * 使用场景:
 *   - 修改应用配置
 *   - 切换 API 提供商
 *   - 配置主题和界面选项
 *
 * 边界:
 *   1. 仅修改全局配置(~/.crab/config.json)
 *   2. 实时验证配置值
 *   3. 支持配置热重载
 *
 * 流程:
 *   1. 加载当前配置
 *   2. 按分组展示配置项
 *   3. 选择配置项进入编辑
 *   4. 验证并保存配置
 */
import { For, Show, createMemo, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "@/ui/contexts/theme";
import { useConfig } from "@/ui/contexts/config";
import { listProviders } from "@config";
import { getGlobalMcpConfigPath } from "@config";
import { getLogDir } from "@/core/logging/logStore";
import { saveConfig, startConfigWatch } from "@config";
import { getConfigSource, getSourceColor, getSourceLabel } from "@config";
import { listThemes } from "@config";
import {
  actionClose,
  iconLsp,
  iconMcp,
  iconSearch,
  iconSettings,
  iconTheme,
  iconUser,
  actionCollapse,
} from "@/ui/utils/icon";

import type { AppConfigSchema as AppConfigType } from "@/schema/config";

/** 配置项定义 */
interface ConfigItem {
  key: string;
  label: string;
  description: string;
  type: "text" | "select" | "boolean" | "password";
  options?: string[];
  getValue: (cfg: AppConfigType) => string;
  setValue: (cfg: AppConfigType, value: string) => Partial<AppConfigType>;
  validate?: (value: string) => string | undefined;
}

/** 配置分组 */
interface ConfigGroup {
  key: string;
  label: string;
  icon: string;
  items: ConfigItem[];
}

/** 隐藏敏感信息 */
function maskSensitive(value: string): string {
  if (!value || value.length < 8) {
    return value;
  }
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

/** 验证 API Key 格式 */
function validateApiKey(provider: string, key: string): string | undefined {
  if (!key) {
    return undefined;
  }

  const patterns: Record<string, RegExp> = {
    anthropic: /^sk-ant-[a-zA-Z0-9]{32,}$/,
    google: /^AIza[0-9A-Za-z_-]{35}$/,
    openai: /^sk-[a-zA-Z0-9]{48}$/,
  };

  const pattern = patterns[provider];
  if (pattern && !pattern.test(key)) {
    return `${provider} API Key 格式不正确`;
  }
  return undefined;
}

export function Settings() {
  const theme = useTheme();
  const { config: cfg, setConfig } = useConfig();
  const logDirectory = getLogDir();

  // 编辑状态
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [editingItem, setEditingItem] = createSignal<ConfigItem | null>(null);
  const [editValue, setEditValue] = createSignal("");
  const [editError, setEditError] = createSignal<string | undefined>(undefined);
  const [expandedGroups, setExpandedGroups] = createSignal<Set<string>>(new Set(["api", "ui", "profile"]));
  const [showPassword] = createSignal<Set<string>>(new Set());

  // 启动配置监听
  startConfigWatch();

  // 配置来源缓存
  const [configSources, setConfigSources] = createSignal<Map<string, { source: string; color: string }>>(new Map());

  // 初始化配置来源
  const initConfigSources = async () => {
    const sources = new Map<string, { source: string; color: string }>();
    const keys = ["provider", "model", "apiKey", "theme", "devMode", "profile"];
    for (const key of keys) {
      const info = await getConfigSource(key);
      sources.set(key, { color: getSourceColor(info.source), source: getSourceLabel(info.source) });
    }
    setConfigSources(sources);
  };
  initConfigSources();

  // 动态获取所有可用的 Provider 列表(预设 + 用户自定义配置)
  const getAllProviderIds = (): string[] => {
    const presetIds = listProviders().map((p) => p.id);
    const configIds = Object.keys(cfg.providerConfig);
    // 合并并去重
    return [...new Set([...presetIds, ...configIds])];
  };

  // 配置定义
  const configGroups = createMemo<ConfigGroup[]>(() => [
    {
      icon: iconMcp,
      items: [
        {
          description: "选择 AI 服务提供商",
          getValue: (c) => c.defaultProvider.provider,
          key: "provider",
          label: "提供商",
          options: getAllProviderIds(),
          setValue: (c, v) => ({ defaultProvider: { ...c.defaultProvider, provider: v } }),
          type: "select",
        },
        {
          description: "选择默认使用的 AI 模型",
          getValue: (c) => c.defaultProvider.model,
          key: "model",
          label: "模型",
          setValue: (c, v) => ({ defaultProvider: { ...c.defaultProvider, model: v } }),
          type: "text",
        },
        {
          description: "API 密钥(输入时隐藏)",
          getValue: (c) => {
            const pConf = c.providerConfig[c.defaultProvider.provider];
            return pConf?.apiKey || "";
          },
          key: "apiKey",
          label: "API Key",
          setValue: (c, v) => {
            const pc = { ...c.providerConfig };
            pc[c.defaultProvider.provider] = {
              ...pc[c.defaultProvider.provider],
              apiKey: v,
              requestMethod: pc[c.defaultProvider.provider]?.requestMethod || "chat",
            };
            return { providerConfig: pc };
          },
          type: "password",
          validate: (v) => validateApiKey(cfg.defaultProvider.provider, v),
        },
      ],
      key: "api",
      label: "API 配置",
    },
    {
      icon: iconTheme,
      items: [
        {
          description: "选择界面主题风格",
          getValue: (c) => c.theme,
          key: "theme",
          label: "主题",
          options: listThemes().map((t) => t.name),
          setValue: (_, v) => ({ theme: v }),
          type: "select",
        },
        {
          description: "开启后显示更多调试信息",
          getValue: (c) => (c.devMode ? "开启" : "关闭"),
          key: "devMode",
          label: "开发模式",
          setValue: (_, v) => ({ devMode: v === "开启" }),
          type: "boolean",
        },
      ],
      key: "ui",
      label: "界面配置",
    },
    {
      icon: iconUser,
      items: [
        {
          description: "切换不同的配置环境(default/work/personal)",
          getValue: (c) => c.profile,
          key: "profile",
          label: "当前 Profile",
          setValue: (_, v) => ({ profile: v }),
          type: "text",
        },
      ],
      key: "profile",
      label: "配置 Profile",
    },
    {
      icon: iconSearch,
      items: [
        {
          description: "Tavily 搜索服务的 API 密钥(用于 websearch 工具)",
          getValue: (c) => c.tavilyApiKey || "",
          key: "tavilyApiKey",
          label: "Tavily API Key",
          setValue: (_, v) => ({ tavilyApiKey: v }),
          type: "password",
        },
        {
          description: "Tavily 自定义端点(可选，留空使用默认)",
          getValue: (c) => c.tavilyBaseURL || "",
          key: "tavilyBaseURL",
          label: "Tavily Base URL",
          setValue: (_, v) => ({ tavilyBaseURL: v || undefined }),
          type: "text",
        },
      ],
      key: "search",
      label: "搜索配置",
    },
  ]);

  // 扁平化所有可选项
  const allItems = createMemo(() => {
    const items: { group: ConfigGroup; item: ConfigItem; index: number }[] = [];
    let index = 0;
    for (const group of configGroups()) {
      if (expandedGroups().has(group.key)) {
        for (const item of group.items) {
          items.push({ group, index: index++, item });
        }
      }
    }
    return items;
  });

  // 键盘处理 — 通过 useKeyboard 连接到 OpenTUI 事件系统
  useKeyboard((event) => {
    if (editingItem()) {
      if (event.name === "escape") {
        setEditingItem(null);
        setEditError(undefined);
        event.stopPropagation();
        return;
      }
      if (event.name === "return" || event.name === "enter") {
        const item = editingItem()!;
        const error = item.validate?.(editValue()) || validateValue(item, editValue());
        if (error) {
          setEditError(error);
          return;
        }
        const partial = item.setValue(cfg, editValue());
        saveConfig(partial).then((success) => {
          if (success) {
            setConfig({ ...cfg, ...partial });
            setEditingItem(null);
            setEditError(undefined);
          }
        });
        event.stopPropagation();
        return;
      }
      return;
    }

    if (event.name === "up") {
      setSelectedIndex((i) => Math.max(0, i - 1));
      event.stopPropagation();
      return;
    }

    if (event.name === "down") {
      setSelectedIndex((i) => Math.min(allItems().length - 1, i + 1));
      event.stopPropagation();
      return;
    }

    if (event.name === "left" || event.name === "right") {
      const current = allItems()[selectedIndex()];
      if (current) {
        toggleGroup(current.group.key);
      }
      event.stopPropagation();
      return;
    }

    if (event.name === "return" || event.name === "enter") {
      const current = allItems()[selectedIndex()];
      if (current) {
        startEdit(current.item);
      }
      event.stopPropagation();
      return;
    }
  });

  const toggleGroup = (key: string) => {
    const next = new Set(expandedGroups());
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setExpandedGroups(next);
  };

  const startEdit = (item: ConfigItem) => {
    setEditingItem(item);
    setEditValue(item.getValue(cfg));
    setEditError(undefined);
  };

  const validateValue = (item: ConfigItem, value: string): string | undefined => {
    if (item.type === "text" && !value.trim()) {
      return "不能为空";
    }
    return undefined;
  };

  return (
    <box flexDirection="column" flexGrow={1} padding={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.colors.primary}>
          <b>{iconSettings} 设置</b>
        </text>
        <text fg={theme.colors.muted}>
          {editingItem() ? "Enter 保存 | Esc 取消" : "↑↓ 选择 | ←→ 折叠 | Enter 编辑 | Esc 返回"}
        </text>
      </box>

      <box height={1} />

      <Show when={editingItem()}>
        <box
          flexDirection="column"
          borderStyle="single"
          borderColor={editError() ? theme.colors.error : theme.colors.accent}
          padding={1}
        >
          <text fg={theme.colors.accent}>编辑: {editingItem()?.label}</text>
          <text fg={theme.colors.muted}>{editingItem()?.description}</text>
          <box height={1} />
          <input
            value={editValue()}
            onInput={(val: string) => setEditValue(val)}
            onSubmit={(_evt: any) => {}}
            {...(editingItem()?.type === "password" && !showPassword().has(editingItem()!.key) ? { mask: "*" } : {})}
            flexGrow={1}
          />
          <Show when={editingItem()?.type === "password"}>
            <text fg={theme.colors.muted} {...({ dimColor: true } as any)}>
              按 Tab 切换显示/隐藏
            </text>
          </Show>
          <Show when={editError()}>
            <text fg={theme.colors.error}>
              {actionClose} {editError()}
            </text>
          </Show>
        </box>
      </Show>

      <Show when={!editingItem()}>
        <box flexDirection="column" flexGrow={1}>
          <For each={configGroups()}>
            {(group) => (
              <box flexDirection="column">
                <box flexDirection="row" {...({ onClick: () => toggleGroup(group.key) } as any)}>
                  <text fg={theme.colors.accent}>
                    {expandedGroups().has(group.key) ? actionCollapse : "▸"} {group.icon} {group.label}
                  </text>
                </box>

                <Show when={expandedGroups().has(group.key)}>
                  <box flexDirection="column" paddingLeft={2}>
                    <For each={group.items}>
                      {(item) => {
                        const isSelected = () => {
                          const flatIdx = allItems().findIndex((i) => i.item.key === item.key);
                          return flatIdx === selectedIndex();
                        };
                        const value = () => item.getValue(cfg);
                        const displayValue = () => {
                          if (item.type === "password" && !showPassword().has(item.key)) {
                            return maskSensitive(value());
                          }
                          return value() || "未设置";
                        };

                        return (
                          <box flexDirection="row">
                            <text fg={isSelected() ? theme.colors.accent : theme.colors.text}>
                              {isSelected() ? "▸ " : "  "}
                              {item.label}:
                            </text>
                            <text fg={theme.colors.text}>{displayValue()}</text>
                            <Show when={isSelected()}>
                              <text fg={theme.colors.muted}> - {item.description}</text>
                            </Show>
                            <box flexDirection="row" marginLeft={1}>
                              <Show when={configSources().has(item.key)}>
                                {(() => {
                                  const src = configSources().get(item.key)!;
                                  return (
                                    <box flexDirection="row" paddingLeft={1}>
                                      <text fg={src.color}>[{src.source}]</text>
                                    </box>
                                  );
                                })()}
                              </Show>
                            </box>
                          </box>
                        );
                      }}
                    </For>
                  </box>
                </Show>

                <box height={1} />
              </box>
            )}
          </For>

          <box height={1} />
          <text fg={theme.colors.accent}>{iconLsp} 系统信息</text>
          <text fg={theme.colors.text}> Profile: {cfg.profile}</text>
          <text fg={theme.colors.text}> MCP 配置: {getGlobalMcpConfigPath()}</text>
          <text fg={theme.colors.text}> 日志目录: {logDirectory}</text>
          <text fg={theme.colors.text}> 权限规则: {cfg.permissions.length} 条</text>
          <text fg={theme.colors.text}> Agent: {cfg.agents.length} 个</text>
        </box>
      </Show>
    </box>
  );
}
