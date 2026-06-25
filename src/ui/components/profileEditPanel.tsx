/**
 * ProfileEditPanel
 *
 * 职责:
 *   - 显示 Profile 配置信息
 *   - 展示模型参数设置
 *
 * 模块功能:
 *   - 显示 Profile 名称、提供商、模型
 *   - 显示温度、TopP、最大 Token 数等参数
 *   - 显示自定义请求头配置
 *   - 提示用户通过配置文件编辑
 *
 * 使用场景:
 *   - 查看当前 Profile 配置
 *   - 确认模型参数设置
 *   - 了解自定义请求头配置
 *
 * 边界:
 *   1. 仅显示配置信息，不支持直接编辑
 *   2. 编辑需通过 .crab/config.json 手动修改
 *   3. 使用默认值填充未设置的参数
 *
 * 流程:
 *   1. 接收 Profile 配置数据
 *   2. 渲染配置项列表
 *   3. 显示编辑提示
 */
import { For, Show, createSignal } from "solid-js";
import type { ThemeColors } from "@/ui/contexts/theme";

export interface ProfileConfig {
  name: string;
  provider: string;
  model: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  customHeaders?: Record<string, string>;
}

interface ProfileEditPanelProps {
  colors: ThemeColors;
  profile?: ProfileConfig;
  onSave?: (profile: ProfileConfig) => void;
  onCancel?: () => void;
}

export function ProfileEditPanel(props: ProfileEditPanelProps) {
  const [profile] = createSignal<ProfileConfig>(
    props.profile ?? { model: "gpt-4o", name: "default", provider: "openai" },
  );

  return (
    <box flexDirection="column" padding={1}>
      <text fg={props.colors.accent}>配置档编辑器</text>

      <box marginTop={1} flexDirection="column">
        <text fg={props.colors.muted}>名称: </text>
        <text fg={props.colors.text}>{profile().name}</text>
      </box>

      <box flexDirection="column">
        <text fg={props.colors.muted}>供应商: </text>
        <text fg={props.colors.text}>{profile().provider}</text>
      </box>

      <box flexDirection="column">
        <text fg={props.colors.muted}>模型: </text>
        <text fg={props.colors.text}>{profile().model}</text>
      </box>

      <box flexDirection="column">
        <text fg={props.colors.muted}>温度: </text>
        <text fg={props.colors.text}>{profile().temperature ?? 0.7}</text>
      </box>

      <box flexDirection="column">
        <text fg={props.colors.muted}>TopP: </text>
        <text fg={props.colors.text}>{profile().topP ?? 1}</text>
      </box>

      <box flexDirection="column">
        <text fg={props.colors.muted}>最大 Token: </text>
        <text fg={props.colors.text}>{profile().maxTokens ?? 4096}</text>
      </box>

      <Show when={profile().customHeaders && Object.keys(profile().customHeaders ?? {}).length > 0}>
        <box flexDirection="column" marginTop={1}>
          <text fg={props.colors.muted}>自定义请求头:</text>
          <For each={Object.entries(profile().customHeaders ?? {})}>
            {([k, v]) => (
              <box paddingLeft={2}>
                <text fg={props.colors.text}>
                  {k}: {v}
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>

      <box marginTop={1}>
        <text fg={props.colors.muted}>请在 .crab/config.json 中编辑配置档字段以应用更改</text>
      </box>
    </box>
  );
}
