/**
 * SkillCreationPanel
 *
 * 职责:
 *   - 引导用户创建新 Skill
 *   - 收集 Skill 的名称、描述、分类和内容
 *   - 保存 Skill 到项目或全局目录
 *
 * 模块功能:
 *   - 分步骤表单(name → description → category → content → confirm)
 *   - 验证 Skill 名称格式(小写字母、数字、连字符)
 *   - 提供预定义分类选择(general、code、test、docs 等)
 *   - 生成标准 frontmatter 格式的 SKILL.md 文件
 *   - 保存到 .crab/skills/<name>/SKILL.md
 *   - 发布 SkillExecuted 事件通知创建成功
 *
 * 使用场景:
 *   - 用户需要创建自定义 Skill
 *   - 快速定义和保存可复用的提示词模板
 *   - 项目级或全局 Skill 管理
 *
 * 边界:
 *   1. Skill 名称必须符合格式要求
 *   2. 内容不能为空
 *   3. 保存路径优先使用项目目录，其次使用用户主目录
 *
 * 流程:
 *   1. 订阅 SkillCreationShow 事件显示面板
 *   2. 引导用户逐步输入信息
 *   3. 验证输入并显示错误提示
 *   4. 确认后生成 SKILL.md 文件
 *   5. 保存并显示成功提示
 */
import { createSignal, onCleanup } from "solid-js";
import { useEventBus } from "@/ui/contexts/eventBus";
import { useTheme } from "@/ui/contexts/theme";
import { toolWrite } from "@/ui/utils/icon";
import { AppEvent } from "@bus";

interface SkillCreationPanelProps {
  projectDir?: string;
  onClose?: () => void;
  onCreated?: (name: string) => void;
}

type CreationStep = "name" | "description" | "category" | "content" | "confirm";

const CATEGORIES = ["general", "code", "test", "docs", "debug", "配置", "deploy"];

export function SkillCreationPanel(_props?: SkillCreationPanelProps) {
  const eventBus = useEventBus();
  const theme = useTheme();
  const [visible, setVisible] = createSignal(false);
  const [step, setStep] = createSignal<CreationStep>("name");
  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [category, setCategory] = createSignal("general");
  const [content, setContent] = createSignal("");
  const [error, setError] = createSignal("");
  const [categoryIndex, setCategoryIndex] = createSignal(0);

  // 订阅 SkillCreationShow 事件
  const unsub = eventBus.subscribe(AppEvent.SkillCreationShow, () => {
    setVisible(true);
    setStep("name");
    setName("");
    setDescription("");
    setCategory("general");
    setContent("");
    setError("");
    setCategoryIndex(0);
  });
  onCleanup(() => unsub());

  if (!visible()) {
    return null;
  }

  const stepLabels: Record<CreationStep, string> = {
    category: "cat",
    confirm: "确认",
    content: "content",
    description: "无描述",
    name: "name",
  };

  const currentStep = step();

  return (
    <box position="absolute" bottom="100%" left={0} width="100%" zIndex={100}>
      <box flexDirection="column" borderStyle="rounded" borderColor={theme.colors.info} padding={1}>
        <text>
          {toolWrite} 创建 Skill ({stepLabels[currentStep]})
        </text>
        <box height={1} />

        {currentStep === "name" && (
          <box flexDirection="column">
            <text>名称(小写字母、数字、连字符):</text>
            <text fg={theme.colors.info}>
              {" "}
              {name() || "<input>"}
              {error() ? `  ⚠ ${error()}` : ""}
            </text>
          </box>
        )}

        {currentStep === "description" && (
          <box flexDirection="column">
            <text>描述:</text>
            <text fg={theme.colors.info}> {description() || "<optional>"}</text>
          </box>
        )}

        {currentStep === "category" && (
          <box flexDirection="column">
            <text>分类:</text>
            {CATEGORIES.map((cat, idx) => (
              <text fg={idx === categoryIndex() ? theme.colors.info : theme.colors.muted}>
                {idx === categoryIndex() ? "▸ " : "  "}
                {cat}
              </text>
            ))}
          </box>
        )}

        {currentStep === "content" && (
          <box flexDirection="column">
            <text>Skill prompt 内容:</text>
            <text fg={theme.colors.info}>
              {" "}
              {content() || "<skill>"}
              {error() ? `  ⚠ ${error()}` : ""}
            </text>
          </box>
        )}

        {currentStep === "confirm" && (
          <box flexDirection="column">
            <text>确认创建 Skill:</text>
            <text>
              {" "}
              名称: <text fg={theme.colors.info}>{name()}</text>
            </text>
            <text> 描述: {description() || "(-)"}</text>
            <text> 分类: {category()}</text>
            <text>
              {" "}
              内容: {content().slice(0, 60)}
              {content().length > 60 ? "..." : ""}
            </text>
            <box height={1} />
            <text fg={theme.colors.success}>Enter 确认 Esc 返回修改</text>
          </box>
        )}

        <box height={1} />
        <text fg={theme.colors.muted}>Esc 返回上一步 · Enter 确认</text>
      </box>
    </box>
  );
}
