/**
 * ThemeListDialog — 主题选择对话框
 *
 * 职责:
 *   - 提供主题选择功能
 *   - 基于 DialogSelect v2 的主题选择器
 *   - 保留实时预览和 Esc 回滚
 *   - 使用统一的 current marker、分组、搜索和 footer hint
 *
 * 模块功能:
 *   - ThemeListDialog: 主题选择对话框组件
 *   - ThemeListDialogProps: 组件属性接口
 *
 * 使用场景:
 *   - 主题切换
 *   - 主题预览
 *
 * 边界:
 * 1. 基于 DialogSelect v2
 * 2. 支持 dark 和 light 模式主题分组
 * 3. Esc 键回滚到原主题
 *
 * 流程:
 * 1. 显示 DialogSelect 列表
 * 2. 用户浏览和搜索主题
 * 3. 预览主题效果
 * 4. 确认或 Esc 回滚
 */
import { createMemo, createSignal, onCleanup } from "solid-js";
import { useTheme } from "@/ui/contexts/theme";
import { type ThemeDefinition, listThemesByMode } from "@config";
import { DialogSelect, type SelectOption } from "@/ui/components/dialogSelect";

interface ThemeListDialogProps {
  onClose: () => void;
}

export function ThemeListDialog(props: ThemeListDialogProps) {
  const theme = useTheme();
  const [confirmed, setConfirmed] = createSignal(false);
  const originalTheme = theme.themeName;

  const themes = createMemo(() => [...listThemesByMode("dark"), ...listThemesByMode("light")]);

  const options = createMemo<SelectOption<ThemeDefinition>[]>(() =>
    themes().map((item) => ({
      category: item.mode === "dark" ? "Dark" : "Light",
      current: item.name === originalTheme,
      description: item.name,
      keywords: [item.name, item.label, item.mode],
      preview: item.palette,
      title: item.label,
      value: item,
    })),
  );

  const restoreOriginal = () => {
    if (!confirmed() && originalTheme !== theme.themeName) {
      theme.setTheme(originalTheme);
    }
  };

  onCleanup(restoreOriginal);

  return (
    <DialogSelect
      title="主题选择(实时预览)"
      options={options()}
      placeholder="搜索主题..."
      emptyText="没有匹配的主题"
      footer={`↑↓ 预览 · 输入搜索 · Enter 确认 · Esc 取消回滚 · 原始: ${originalTheme}`}
      onHighlight={(option) => {
        const selected = option?.value;
        if (selected && selected.name !== theme.themeName) {
          theme.setTheme(selected.name);
        }
      }}
      onCancel={restoreOriginal}
      onClose={props.onClose}
      onSelect={(option) => {
        setConfirmed(true);
        theme.setTheme(option.value.name);
        props.onClose();
      }}
    />
  );
}
