import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { ThemeProvider } from "@/ui/contexts/theme";
import { globalBus } from "@bus";
import { AppEvent } from "@bus";
import {
  PermissionDialog,
  buildPermissionDialogViewModel,
  resolvePermissionDialogAction,
} from "@/ui/components/permissionDialog";
import { currentPermissionRequest } from "@/permission/ui/permissionState";

let setup: Awaited<ReturnType<typeof testRender>> | undefined;

async function settleFrame() {
  await Bun.sleep(30);
  await setup?.renderOnce();
}

afterEach(() => {
  if (setup) {
    setup.renderer.destroy();
    setup = undefined;
  }
  globalBus.clearHistory();
});

describe("permission dialog key normalization", () => {
  test("accepts plain y/a/n names", () => {
    expect(resolvePermissionDialogAction({ name: "y" } as any)).toBe("once");
    expect(resolvePermissionDialogAction({ name: "a" } as any)).toBe("always");
    expect(resolvePermissionDialogAction({ name: "n" } as any)).toBe("reject");
  });

  test("accepts uppercase key and sequence variants common in PTY flows", () => {
    expect(resolvePermissionDialogAction({ key: "Y" } as any)).toBe("once");
    expect(resolvePermissionDialogAction({ sequence: "y" } as any)).toBe("once");
    expect(resolvePermissionDialogAction({ sequence: "A\r" } as any)).toBe("always");
    expect(resolvePermissionDialogAction({ sequence: "N" } as any)).toBe("reject");
  });

  test("keeps enter and escape behavior", () => {
    expect(resolvePermissionDialogAction({ name: "enter" } as any, 0)).toBe("confirm");
    expect(resolvePermissionDialogAction({ name: "escape" } as any, 0)).toBe("reject");
  });

  test("builds a stable visual view model for high-risk tool approval", () => {
    const vm = buildPermissionDialogViewModel(
      {
        description: "需要删除临时目录",
        id: "perm_1",
        patterns: ["rm", "-rf", "/tmp/very-long-path-that-should-be-truncated-for-the-dialog"],
        permission: "bash.run",
        riskLevel: "high",
        tool: "bash",
      },
      17,
      1,
    );

    expect(vm.title).toBe("权限确认");
    expect(vm.countdownText).toBe("(17秒后自动拒绝)");
    expect(vm.risk.label).toBe("高风险");
    expect(vm.risk.color).toBe("error");
    expect(vm.toolLine).toBe("工具: bash");
    expect(vm.command.length).toBeLessThanOrEqual(60);
    expect(vm.command.endsWith("...")).toBe(true);
    expect(vm.descriptionLine).toBe("说明: 需要删除临时目录");
    expect(vm.actions.map((action) => action.selected)).toEqual([false, true, false]);
    expect(vm.footerHint).toContain("Enter 确认");
  });

  test("renders a real OpenTUI character frame for high-risk permission", async () => {
    setup = await testRender(
      () => (
        <ThemeProvider mode="dark">
          <PermissionDialog />
        </ThemeProvider>
      ),
      { height: 24, width: 90 },
    );
    await settleFrame();

    globalBus.publish(AppEvent.PermissionAsked, {
      description: "视觉层确认",
      id: "perm_visual_1",
      patterns: ["rm -rf /tmp/crab-visual-e2e"],
      permission: "bash",
      riskLevel: "high",
      sessionId: "ses_visual",
      tool: "terminal-execute",
    });
    await globalBus.flush();
    await settleFrame();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("权限确认");
    expect(frame).toContain("高风险");
    expect(frame).toContain("terminal-execute");
    expect(frame).toContain("rm -rf /tmp/crab-visual-e2e");
    expect(frame).toContain("[Y] 允许一次");
    expect(frame).toContain("[A] 始终允许");
    expect(frame).toContain("[N] 拒绝");
    expect(frame).toContain("Enter 确认");
  });

  test("publishes readable blocking details for the session prompt area", async () => {
    setup = await testRender(
      () => (
        <ThemeProvider mode="dark">
          <PermissionDialog />
        </ThemeProvider>
      ),
      { height: 24, width: 90 },
    );
    await settleFrame();

    globalBus.publish(AppEvent.PermissionAsked, {
      description: "需要重置工作区",
      id: "perm_blocked_1",
      patterns: ["git reset --hard"],
      permission: "bash",
      riskLevel: "high",
      sessionId: "ses_blocked",
      tool: "terminal-execute",
    });
    await globalBus.flush();
    await settleFrame();

    expect(currentPermissionRequest()).toMatchObject({
      command: "bash git reset --hard",
      description: "需要重置工作区",
      id: "perm_blocked_1",
      permission: "bash",
      riskLevel: "high",
      tool: "terminal-execute",
    });
  });
});
