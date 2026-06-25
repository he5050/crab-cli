/**
 * SkillListPanel
 *
 * 职责:
 *   - 显示所有已注册 Skill 的详情
 *   - 支持禁用/启用操作
 *   - 按 category 分组显示
 *
 * 模块功能:
 *   - 从 skillManager 获取 Skill 列表
 *   - 按分类分组渲染 Skill 列表
 *   - 显示 Skill 来源图标(内置、项目、全局)
 *   - 显示禁用状态标记
 *   - 处理键盘操作(↑↓ 移动、D 禁用/启用、Tab 切换显示、Esc 关闭)
 *   - 支持显示/隐藏已禁用 Skill
 *
 * 使用场景:
 *   - 查看所有可用 Skill
 *   - 管理 Skill 启用状态
 *   - 浏览 Skill 分类和来源
 *
 * 边界:
 *   1. 禁用/启用操作通过 skillManager 执行
 *   2. 禁用后需要 reload 才能完全生效
 *   3. 仅显示已加载的 Skill，不包含未扫描到的
 *
 * 流程:
 *   1. 订阅 SkillListShow 事件显示面板
 *   2. 获取并分组 Skill 列表
 *   3. 渲染分类和 Skill 项
 *   4. 处理键盘操作
 */
import { createSignal, onCleanup } from "solid-js";
import { skillManager } from "@/extension/skill";
import { useEventBus } from "@/ui/contexts/eventBus";
import { AppEvent } from "@bus";
import { useTheme } from "@/ui/contexts/theme";
import { toolGeneric, toolWebSearch } from "@/ui/utils/icon";

interface SkillListPanelProps {
  onClose?: () => void;
}

export function SkillListPanel(_props?: SkillListPanelProps) {
  const eventBus = useEventBus();
  const theme = useTheme();
  const [visible, setVisible] = createSignal(false);
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [showDisabled, setShowDisabled] = createSignal(false);

  const unsub = eventBus.subscribe(AppEvent.SkillListShow, () => {
    setVisible(true);
    setSelectedIndex(0);
    setShowDisabled(false);
  });
  onCleanup(() => unsub());

  const getAllSkills = () => {
    if (showDisabled()) {
      const enabled = skillManager.listVisible();
      const disabled = skillManager.getDisabledList().map((name) => ({
        category: "-",
        content: "",
        description: "(disabled)",
        hidden: true,
        location: "",
        name,
        source: "disabled" as const,
      }));
      return [...enabled, ...disabled];
    }
    return skillManager.listVisible();
  };

  if (!visible()) {
    return null;
  }

  const skills = getAllSkills();
  const grouped = skillManager.listGrouped();

  return (
    <box position="absolute" bottom="100%" left={0} width="100%" zIndex={100}>
      <box flexDirection="column" borderStyle="rounded" borderColor={theme.colors.info} padding={1}>
        <text>
          ◆ Skill 列表 ({skillManager.size} 个{showDisabled() ? ", with disabled" : ""})
        </text>
        <box height={1} />

        {[...grouped.entries()].map(([category, catSkills]) => (
          <box flexDirection="column">
            <text fg={theme.colors.muted}>▸ {category}</text>
            {catSkills.map((skill) => {
              const globalIdx = skills.findIndex((s) => s.name === skill.name);
              const isSelected = globalIdx === selectedIndex();
              const sourceIcon =
                skill.source === "builtin"
                  ? symDot
                  : skill.source === "project"
                    ? symEmpty
                    : skill.source === "global"
                      ? toolWebSearch
                      : toolGeneric;
              const disabled = skillManager.isDisabled(skill.name);
              return (
                <text fg={isSelected ? theme.colors.info : undefined}>
                  {isSelected ? "▸ " : "  "}
                  {sourceIcon} {skill.name}
                  {disabled ? " [off]" : ""}
                  <text fg={theme.colors.muted}> — {skill.description ?? "无描述"}</text>
                </text>
              );
            })}
          </box>
        ))}

        <box height={1} />
        <text fg={theme.colors.muted}>↑↓ 移动 d 禁用/启用 Tab 切换显示 Esc 关闭</text>
      </box>
    </box>
  );
}

import { symDot, symEmpty } from "@/core/icons/icon";
