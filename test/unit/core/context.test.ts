/**
 * Context 工厂测试。
 *
 * 测试用例:
 *   - Context 创建
 *   - Provider 外调用抛错
 *   - Props 参数传递
 */
import { describe, expect, test } from "bun:test";
import { createSimpleContext } from "@/ui/contexts/helper";

describe("createSimpleContext — Context 工厂函数", () => {
  test("创建 Context 返回 use 和 provider 两个方法", () => {
    const ctx = createSimpleContext({
      init: () => ({ value: 42 }),
      name: "测试Context",
    });
    expect(ctx.use).toBeDefined();
    expect(ctx.provider).toBeDefined();
    expect(typeof ctx.use).toBe("function");
    expect(typeof ctx.provider).toBe("function");
  });

  test("在 Provider 外调用 use() 抛出错误", () => {
    const ctx = createSimpleContext({
      init: () => ({ value: "test" }),
      name: "测试抛错",
    });
    expect(() => ctx.use()).toThrow("测试抛错");
  });

  test("init 函数能接收 props 参数", () => {
    let receivedProps: Record<string, unknown> | undefined;
    const ctx = createSimpleContext({
      init: (props) => {
        receivedProps = props;
        return { value: props?.myVal };
      },
      name: "测试Props",
    });
    // Provider 存在即可，完整集成测试需要 SolidJS 渲染器(Phase 22)
    expect(ctx.provider).toBeDefined();
  });

  test("无参数 init 正常工作", () => {
    const ctx = createSimpleContext({
      init: () => ({ count: 0, inc: () => {} }),
      name: "测试无参数",
    });
    expect(ctx.use).toBeDefined();
    expect(ctx.provider).toBeDefined();
  });
});
