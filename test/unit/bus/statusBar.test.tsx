import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { ThemeProvider } from "@/ui/contexts/theme";
import { ConfigProvider } from "@/ui/contexts/config";
import { ResourceUsageStatus, StatusBar } from "@/ui/components/statusBar";
import { globalBus } from "@bus";
import { AppEvent } from "@bus";
import { buildDerivedProviderConfig } from "../../helpers/realConfig";

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

async function renderStatusBar(options: { width: number; height: number } = { height: 3, width: 120 }) {
  const config = await buildDerivedProviderConfig({
    model: "status-bar-model",
    providerId: "status-bar-ui",
    requestMethod: "chat",
  });
  return testRender(
    () => (
      <ConfigProvider config={config}>
        <ThemeProvider mode="dark">
          <StatusBar />
        </ThemeProvider>
      </ConfigProvider>
    ),
    options,
  );
}

function renderResourceUsageStatus(options: { width: number; height: number } = { height: 1, width: 80 }) {
  return testRender(
    () => (
      <ThemeProvider mode="dark">
        <ResourceUsageStatus />
      </ThemeProvider>
    ),
    options,
  );
}

describe("StatusBar — 状态栏", () => {
  test("初始渲染只显示资源、目录、分支和当前模型", async () => {
    setup = await renderStatusBar();
    await settleFrame();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("内存:");
    expect(frame).toContain("CPU:");
    expect(frame).toContain("目录:");
    expect(frame).toContain("crab-cli");
    expect(frame).toContain("分支:");
    expect(frame).toContain("模型:");
    expect(frame).toContain("status-bar-model");
    expect(frame).not.toContain("Crab");
    expect(frame).not.toContain("EVT:");
    expect(frame).not.toContain("VSCode");
    expect(frame).not.toContain("│");
  });

  test("provider 状态事件后优先显示运行时模型", async () => {
    setup = await renderStatusBar();
    await settleFrame();

    globalBus.publish(AppEvent.ProviderStatus, {
      method: "chat",
      model: "runtime-model",
      provider: "openai",
      status: "calling",
    });
    await settleFrame();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("模型:");
    expect(frame).toContain("runtime-model");
    expect(frame).not.toContain("EVT:");
  });

  test("真实长路径在标准宽度下保留仓库名", async () => {
    setup = await renderStatusBar({ height: 3, width: 120 });
    await settleFrame();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("目录:");
    expect(frame).toContain("crab-cli");
    expect(frame).toContain("分支:");
    expect(frame).toContain("模型:");
    expect(frame).not.toContain("EVT:");
  });

  test("入口页资源状态只显示内存和 CPU", async () => {
    setup = await renderResourceUsageStatus();
    await settleFrame();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("内存:");
    expect(frame).toContain("CPU:");
    expect(frame).not.toContain("Crab");
    expect(frame).not.toContain("EVT:");
  });
});
