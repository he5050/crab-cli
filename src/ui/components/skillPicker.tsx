/**
 * SkillPicker
 *
 * 职责:
 *   - 按 category 分组显示 Skill 列表
 *   - 支持输入关键词模糊搜索(按名称和描述过滤)
 *   - 处理键盘导航和选择事件
 *
 * 模块功能:
 *   - 获取并分组展示所有可用 Skill
 *   - 实现模糊匹配算法进行搜索过滤
 *   - 响应键盘事件(↑↓ 选择，Enter 执行，Esc 返回)
 *   - 显示 Skill 来源图标和描述信息
 *
 * 使用场景:
 *   - 用户需要浏览和选择可用 Skill
 *   - 通过快捷键快速定位和激活 Skill
 *   - 查看 Skill 分类和详细信息
 *
 * 边界:
 *   1. 仅显示已注册的 Skill，不显示禁用的 Skill
 *   2. 搜索仅匹配 Skill 名称和描述字段
 *   3. 需要全局事件总线支持显示/隐藏
 *
 * 流程:
 *   1. 订阅 SkillPickerShow 事件显示面板
 *   2. 从 skillManager 获取分组 Skill 列表
 *   3. 根据搜索词过滤并重新分组
 *   4. 处理键盘导航和选择
 *   5. 发布选中 Skill 到全局事件总线
 */
import { createSignal, onCleanup } from "solid-js";
import { skillManager } from "@/extension/skill";
import type { SkillDefinition } from "@/extension/skill/type";
import { useEventBus } from "@/ui/contexts/eventBus";
import { AppEvent } from "@bus";
import { useTheme } from "@/ui/contexts/theme";
import { iconFile, iconFolder, iconLsp, iconSearch, toolGeneric, toolWebSearch } from "@/ui/utils/icon";

interface SkillPickerProps {
  onSelect?: (skill: SkillDefinition) => void;
  onClose?: () => void;
}

/** 简单模糊匹配:检查 query 的每个字符是否按顺序出现在 target 中 */
function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
    }
  }
  return qi === q.length;
}

/** 模糊搜索:同时匹配 name 和 description */
function searchSkills(
  skills: { skill: SkillDefinition; category: string }[],
  query: string,
): { skill: SkillDefinition; category: string }[] {
  if (!query.trim()) {
    return skills;
  }
  return skills.filter(
    ({ skill }) => fuzzyMatch(query, skill.name) || (skill.description ? fuzzyMatch(query, skill.description) : false),
  );
}

export function SkillPicker(props?: SkillPickerProps) {
  const eventBus = useEventBus();
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [visible, setVisible] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal("");
  const theme = useTheme();

  // 获取分组 Skill 列表
  const getGroupedSkills = () => {
    const grouped = skillManager.listGrouped();
    const flat: { skill: SkillDefinition; category: string }[] = [];
    for (const [cat, skills] of grouped) {
      for (const skill of skills) {
        flat.push({ category: cat, skill });
      }
    }
    return { flat, grouped };
  };

  // 订阅 SkillPickerShow 事件
  const unsub = eventBus.subscribe(AppEvent.SkillPickerShow, () => {
    setVisible(true);
    setSelectedIndex(0);
    setSearchQuery("");
  });
  onCleanup(() => unsub());

  const handleSelect = (skill: SkillDefinition) => {
    setVisible(false);
    setSearchQuery("");
    // 发布 skill 执行结果到对话
    eventBus.publish(AppEvent.Log, {
      level: "info",
      message: `📚 Skill: ${skill.name}\n${skill.description ?? ""}`,
    });
    props?.onSelect?.(skill);
  };

  const { flat } = getGroupedSkills();
  const filtered = searchSkills(flat, searchQuery());

  if (!visible() || flat.length === 0) {
    return null;
  }

  // 按搜索结果重新分组
  const filteredGrouped = new Map<string, SkillDefinition[]>();
  for (const { skill, category } of filtered) {
    const list = filteredGrouped.get(category) ?? [];
    list.push(skill);
    filteredGrouped.set(category, list);
  }

  return (
    <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; z-index: 100;">
      <div style="position: absolute; inset: 0; background: rgba(0,0,0,0.5);" />
      <div style="position: relative; margin: auto; max-width: 60; border: 1px solid #444; padding: 1 2;">
        <div style="bold: true; margin-bottom: 1;">📚 Skills</div>

        {/* 搜索框 */}
        <div style="margin-bottom: 1; border-bottom: 1px solid #333; padding-bottom: 1;">
          <span style={`color: ${theme.colors.muted}`}>{iconSearch} </span>
          <span>{searchQuery() || <span style={`color: ${theme.colors.muted};`}>输入搜索...</span>}</span>
          {searchQuery() && (
            <span style={`color: ${theme.colors.muted};`}>
              {" "}
              ({filtered.length}/{flat.length})
            </span>
          )}
        </div>

        {[...filteredGrouped.entries()].map(([category, skills]) => (
          <div>
            <div style={`color: ${theme.colors.muted}; margin-top: 1;`}>
              {iconFolder} {category}
            </div>
            {skills.map((skill) => {
              const idx = filtered.findIndex((f) => f.skill.name === skill.name);
              const isSelected = idx === selectedIndex();
              const sourceIcon =
                skill.source === "builtin"
                  ? iconLsp
                  : skill.source === "project"
                    ? iconFile
                    : skill.source === "global"
                      ? toolWebSearch
                      : toolGeneric;
              return (
                <SkillItem
                  name={skill.name}
                  description={skill.description ?? ""}
                  icon={sourceIcon}
                  selected={isSelected}
                  onSelect={() => handleSelect(skill)}
                />
              );
            })}
          </div>
        ))}

        {filtered.length === 0 && searchQuery() && (
          <div style={`color: ${theme.colors.muted}; padding: 1;`}>无匹配结果</div>
        )}

        <div style={`color: ${theme.colors.muted}; margin-top: 1;`}>↑↓ 选择 · 输入搜索 · Enter 执行 · Esc 返回</div>
      </div>
    </div>
  );
}

function SkillItem(props: {
  name: string;
  description: string;
  icon: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const theme = useTheme();
  const selectedBg = theme.extended.bg.element;
  const selectedFg = theme.selectedForeground();

  return (
    <div
      style={`padding-left: 2; ${props.selected ? `background: ${selectedBg}; color: ${selectedFg};` : ""}`}
      onClick={props.onSelect}
    >
      {props.icon} {props.name}
      <span style={`color: ${theme.colors.muted};`}> — {props.description}</span>
    </div>
  );
}
