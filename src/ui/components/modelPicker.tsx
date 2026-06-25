/**
 * ModelPicker
 *
 * 职责:
 *   - 显示可用的 AI 模型列表(Provider + Model)
 *   - 支持搜索过滤模型
 *   - 处理模型选择并通知外部切换
 *
 * 模块功能:
 *   - 渲染模型列表弹窗
 *   - 支持按标签、提供商、模型名搜索过滤
 *   - 键盘导航(上下箭头、回车选择、Esc 关闭)
 *   - 高亮当前选中的模型
 *   - 显示模型描述信息
 *
 * 使用场景:
 *   - 用户需要切换 AI 模型时
 *   - 需要查看所有可用模型列表时
 *   - 通过命令或快捷键打开模型选择器时
 *
 * 边界:
 *   1. 模型数据通过 props 传入，组件不管理模型配置
 *   2. 实际的模型切换逻辑由父组件通过 onSelect 处理
 *   3. 搜索过滤在组件内部完成，不触发外部请求
 *   4. 当前模型通过 currentProvider 和 currentModel 标记
 *
 * 流程:
 *   1. 接收模型列表和当前模型信息
 *   2. 渲染搜索输入框和模型列表
 *   3. 用户输入搜索关键词时实时过滤
 *   4. 键盘导航选择模型
 *   5. 回车确认后调用 onSelect 回调
 *   6. Esc 关闭弹窗
 */
import { createMemo } from "solid-js";
import { DialogSelect, type SelectOption } from "@/ui/components/dialogSelect";

interface ModelEntry {
  provider: string;
  model: string;
  label: string;
  description?: string;
}

interface ModelPickerProps {
  models: ModelEntry[];
  currentProvider: string;
  currentModel: string;
  onSelect: (provider: string, model: string) => void;
  onClose: () => void;
}

export function ModelPicker(props: ModelPickerProps) {
  const options = createMemo<SelectOption<ModelEntry>[]>(() =>
    props.models.map((model) => ({
      category: model.provider,
      current: model.provider === props.currentProvider && model.model === props.currentModel,
      description: model.description,
      keywords: [model.provider, model.model, model.description ?? ""],
      meta: model.model,
      title: model.label,
      value: model,
    })),
  );

  return (
    <DialogSelect
      title="选择模型"
      options={options()}
      placeholder="搜索 provider / model..."
      emptyText="没有匹配的模型"
      footer="↑↓ 选择 · 输入搜索 · Enter 切换模型 · Esc 取消"
      onClose={props.onClose}
      onSelect={(option) => props.onSelect(option.value.provider, option.value.model)}
    />
  );
}
