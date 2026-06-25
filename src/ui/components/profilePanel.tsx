/**
 * ProfilePanel 组件
 *
 * 职责:
 *   - 提供 Profile 管理界面，支持查看、切换、创建、删除 Profile
 *   - 通过全局事件总线响应 ProfilePanelShow 事件
 *
 * 模块功能:
 *   - 列出所有可用的 Profile，显示当前激活状态
 *   - 支持键盘导航(上下箭头选择，Enter 切换)
 *   - 支持创建新 Profile(N 键触发)
 *   - 支持删除 Profile(D 键触发，default 不可删除)
 *   - 三种模式切换:列表模式、创建模式、删除确认模式
 *
 * 使用场景:
 *   - 用户需要切换不同配置环境时
 *   - 需要创建隔离的配置 Profile 时
 *   - 需要清理不再使用的 Profile 时
 *
 * 边界:
 *   1. default Profile 不允许删除
 *   2. Profile 名称只允许字母、数字、下划线、连字符
 *   3. 创建时检查名称是否已存在
 *   4. 操作过程中显示 loading 状态
 *
 * 流程:
 *   1. 订阅 ProfilePanelShow 事件，触发时加载 Profile 列表
 *   2. 列表模式:上下导航，Enter 切换，N 创建，D 删除
 *   3. 创建模式:输入名称，Enter 确认，Esc 取消
 *   4. 删除确认:Y 确认删除，N/Esc 取消
 */
import { createSignal, onCleanup } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useEventBus } from "@/ui/contexts/eventBus";
import { useTheme } from "@/ui/contexts/theme";
import { AppEvent } from "@bus";
import { createProfile, deleteProfile, listProfiles, switchProfile } from "@config";
import { iconFolder, iconIdle, iconRunning } from "@/ui/utils/icon";

interface ProfilePanelProps {
  onClose?: () => void;
}

type PanelProfile = Awaited<ReturnType<typeof listProfiles>>[number];

export function ProfilePanel(props?: ProfilePanelProps) {
  const eventBus = useEventBus();
  const theme = useTheme();
  const [visible, setVisible] = createSignal(false);
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [mode, setMode] = createSignal<"list" | "create" | "confirm-delete">("list");
  const [newProfileName, setNewProfileName] = createSignal("");
  const [profiles, setProfiles] = createSignal<PanelProfile[]>([]);
  const [loading, setLoading] = createSignal(false);

  const loadProfiles = async () => {
    const list = await listProfiles();
    setProfiles(list);
    // 调整选中索引
    const current = selectedIndex();
    if (current >= list.length) {
      setSelectedIndex(Math.max(0, list.length - 1));
    }
  };

  const unsub = eventBus.subscribe(AppEvent.ProfilePanelShow, () => {
    setVisible(true);
    setMode("list");
    setSelectedIndex(0);
    setNewProfileName("");
    loadProfiles();
  });
  onCleanup(() => unsub());

  const handleSwitch = async (name: string) => {
    setLoading(true);
    try {
      const success = await switchProfile(name);
      if (success) {
        eventBus.publish(AppEvent.Toast, {
          message: `已切换到 Profile: ${name}`,
          variant: "success",
        });
        await loadProfiles();
      } else {
        eventBus.publish(AppEvent.Toast, {
          message: `切换 Profile 失败`,
          variant: "error",
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    const name = newProfileName().trim();
    if (!name) {
      eventBus.publish(AppEvent.Toast, {
        message: "Profile 名称不能为空",
        variant: "error",
      });
      return;
    }
    setLoading(true);
    try {
      const success = await createProfile(name);
      if (success) {
        eventBus.publish(AppEvent.Toast, {
          message: `创建 Profile 成功: ${name}`,
          variant: "success",
        });
        setMode("list");
        setNewProfileName("");
        await loadProfiles();
      } else {
        eventBus.publish(AppEvent.Toast, {
          message: `创建 Profile 失败(可能已存在)`,
          variant: "error",
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    const profile = profiles()[selectedIndex()];
    if (!profile || profile.name === "default") {
      return;
    }

    setLoading(true);
    try {
      const success = await deleteProfile(profile.name);
      if (success) {
        eventBus.publish(AppEvent.Toast, {
          message: `删除 Profile 成功: ${profile.name}`,
          variant: "success",
        });
        setMode("list");
        await loadProfiles();
      } else {
        eventBus.publish(AppEvent.Toast, {
          message: `删除 Profile 失败`,
          variant: "error",
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (key: string) => {
    if (mode() === "create") {
      switch (key) {
        case "Escape": {
          setMode("list");
          setNewProfileName("");
          return true;
        }
        case "Enter": {
          void handleCreate();
          return true;
        }
        case "Backspace": {
          setNewProfileName((prev) => prev.slice(0, -1));
          return true;
        }
      }
      if (key.length === 1 && /[a-zA-Z0-9_-]/.test(key)) {
        setNewProfileName((prev) => prev + key);
        return true;
      }
      return false;
    }

    if (mode() === "confirm-delete") {
      switch (key) {
        case "y":
        case "Y": {
          void handleDelete();
          return true;
        }
        case "n":
        case "N":
        case "Escape": {
          setMode("list");
          return true;
        }
      }
      return false;
    }

    const list = profiles();
    const current = selectedIndex();

    switch (key) {
      case "ArrowUp": {
        setSelectedIndex(Math.max(0, current - 1));
        return true;
      }
      case "ArrowDown": {
        setSelectedIndex(Math.min(list.length - 1, current + 1));
        return true;
      }
      case "Enter": {
        const selected = list[current];
        if (selected && !selected.isActive) {
          void handleSwitch(selected.name);
        }
        return true;
      }
      case "n":
      case "N": {
        setMode("create");
        setNewProfileName("");
        return true;
      }
      case "d":
      case "D": {
        const selected = list[current];
        if (selected && selected.name !== "default") {
          setMode("confirm-delete");
        } else if (selected?.name === "default") {
          eventBus.publish(AppEvent.Toast, {
            message: "不能删除 default Profile",
            variant: "error",
          });
        }
        return true;
      }
      case "Escape": {
        setVisible(false);
        props?.onClose?.();
        return true;
      }
    }
    return false;
  };

  useKeyboard((event) => {
    if (!event.name) {
      return;
    }
    const handled = handleKey(event.name);
    if (handled) {
      event.stopPropagation?.();
    }
  });

  if (!visible()) {
    return null;
  }

  const profileList = profiles();

  return (
    <box position="absolute" bottom="100%" left={0} width="100%" zIndex={100}>
      <box flexDirection="column" borderStyle="rounded" borderColor={theme.colors.secondary} padding={1}>
        {mode() === "create" ? (
          <>
            <text>创建新 Profile</text>
            <box height={1} />
            <text>名称: {newProfileName()}_</text>
            <box height={1} />
            <text>按 Enter 确认，Esc 取消</text>
            <text>只允许字母、数字、下划线、连字符</text>
          </>
        ) : mode() === "confirm-delete" ? (
          <>
            <text>确认删除</text>
            <box height={1} />
            <text>确定要删除 Profile "{profileList[selectedIndex()]?.name}" 吗？</text>
            <box height={1} />
            <text>按 Y 确认，N/Esc 取消</text>
          </>
        ) : (
          <>
            <text>
              {iconFolder} Profile 管理 ({profileList.length} 个)
            </text>
            <box height={1} />
            {profileList.length === 0 ? (
              <text>暂无 Profile</text>
            ) : (
              <box flexDirection="column">
                {profileList.map((profile, idx) => (
                  <box>
                    <text>
                      {idx === selectedIndex() ? "> " : "  "}
                      {profile.active ? `${iconRunning} ` : `${iconIdle} `}
                      {profile.name}
                      {profile.description ? ` - ${profile.description}` : ""}
                      {profile.active ? " (当前)" : ""}
                    </text>
                  </box>
                ))}
              </box>
            )}
            <box height={1} />
            <text>↑↓ 选择 | Enter 切换 | N 新建 | D 删除 | Esc 关闭</text>
            {loading() && <text>处理中...</text>}
          </>
        )}
      </box>
    </box>
  );
}
