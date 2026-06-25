/**
 * [测试目标] RollbackPanel 视图模型。
 *
 * 测试目标:
 *   - 验证 buildRollbackPanelViewModel 在同时存在 checkpoint 与压缩分支点时的展示数据与 fork / replace 动作
 *
 * 测试用例:
 *   - 同时展示 checkpoint 与压缩分支点，并暴露 fork/replace 动作提示:构造 1 checkpoint + 1 branchPoint，断言 hasAnyRollbackPoint / counts / meta / actions
 *   - 没有任何回滚点时返回空状态:空输入下 hasAnyRollbackPoint=false，counts=0
 */
import { describe, expect, test } from "bun:test";
import { buildRollbackPanelViewModel } from "@/ui/components/rollbackPanel";

describe("RollbackPanel 视图模型", () => {
  test("同时展示 checkpoint 与压缩分支点，并暴露 fork/replace 动作提示", () => {
    const vm = buildRollbackPanelViewModel({
      branchPoints: [
        {
          compactionIndex: 2,
          compressionRatio: 0.25,
          id: "bp_1",
          messageCountAfter: 2,
          messageCountBefore: 8,
          sessionId: "ses_1",
          timestamp: Date.parse("2026-06-09T10:01:00Z"),
          tokensAfter: 300,
          tokensBefore: 1200,
        },
      ],
      checkpoints: [
        {
          id: "chk_1",
          label: "压缩前检查点",
          messageCount: 8,
          timestamp: new Date("2026-06-09T10:00:00Z"),
          tokenCount: 1200,
        },
      ],
    });

    expect(vm.hasAnyRollbackPoint).toBe(true);
    expect(vm.checkpointCount).toBe(1);
    expect(vm.branchPointCount).toBe(1);
    expect(vm.checkpoints[0]?.title).toBe("压缩前检查点");
    expect(vm.checkpoints[0]?.tokenMeta).toContain("1,200");
    expect(vm.branchPoints[0]?.meta).toContain("压缩率 25.0%");
    expect(vm.branchPoints[0]?.tokenMeta).toContain("1,200 -> 300");
    expect(vm.branchPoints[0]?.actions).toEqual([
      { hint: "/rollback branch bp_1 fork", label: "分叉恢复", strategy: "fork" },
      { hint: "/rollback branch bp_1 replace", label: "原会话替换", strategy: "replace" },
    ]);
  });

  test("没有任何回滚点时返回空状态", () => {
    const vm = buildRollbackPanelViewModel({ branchPoints: [], checkpoints: [] });
    expect(vm.hasAnyRollbackPoint).toBe(false);
    expect(vm.checkpointCount).toBe(0);
    expect(vm.branchPointCount).toBe(0);
  });
});
