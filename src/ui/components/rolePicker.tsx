/**
 * Role 选择器 — 选择 ROLE.md prompt 角色。
 *
 * 职责:
 *   - 弹出 ROLE.md 列表供用户选择
 *   - 通过 applyRolePickerAction 切换 Role
 *
 * 边界:
 *   1. Role 只改变系统提示词注入方式，不改变 Agent/工具/模型/权限
 */
import { createMemo } from "solid-js";
import { createLogger } from "@/core/logging/logger";
import { DialogSelect, type SelectOption } from "@/ui/components/dialogSelect";
import { type RolePickerAction, applyRolePickerAction, buildRolePickerOptions } from "@/ui/components/rolePickerModel";
import { useEventBus } from "@/ui/contexts/eventBus";

const log = createLogger("ui:role-picker");

interface RolePickerProps {
  onClose: () => void;
  onSelect?: (roleId: string | null) => void;
  projectRoot?: string;
}

export function RolePicker(props: RolePickerProps) {
  const eventBus = useEventBus();
  const options = createMemo<SelectOption<RolePickerAction>[]>(() =>
    buildRolePickerOptions({ projectRoot: props.projectRoot }).map((option) => ({
      category: option.category,
      current: option.current,
      description: option.description,
      disabled: option.disabled,
      keywords: option.keywords,
      marker: option.marker,
      meta: option.meta,
      title: option.title,
      value: option.value,
    })),
  );

  const handleSelect = async (option: SelectOption<RolePickerAction>) => {
    const result = await applyRolePickerAction(option.value, props.projectRoot, eventBus);
    if (result.success) {
      log.info(`已选择 Role: ${result.roleName ?? result.roleId ?? "none"}`);
      props.onSelect?.(result.roleId);
    } else {
      log.warn(`选择 Role 失败: ${result.error ?? "unknown"}`);
    }
    props.onClose();
  };

  return (
    <DialogSelect
      title="选择 Role"
      options={options()}
      placeholder="搜索 ROLE.md / scope / override..."
      emptyText="没有可用 Role，可创建项目或全局 ROLE.md"
      footer="↑↓/Ctrl+P/Ctrl+N 选择 · Enter 切换 Role · Esc 取消"
      size="large"
      onClose={props.onClose}
      onSelect={handleSelect}
    />
  );
}
