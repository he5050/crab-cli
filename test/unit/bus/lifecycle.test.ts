import { afterEach, describe, expect, test } from "bun:test";
import { EventBus } from "@/bus";
import { installGlobalProcessHandlers, uninstallGlobalProcessHandlers } from "@/bus";

function removeListenerIfPresent(event: NodeJS.Signals | "exit", listener: (...args: any[]) => void): void {
  process.off(event, listener as any);
}

describe("bus lifecycle", () => {
  afterEach(() => {
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");
    process.removeAllListeners("exit");
  });

  test("uninstallGlobalProcessHandlers 不移除外部 SIGTERM 监听器", () => {
    const bus = new EventBus();
    const foreignListener = () => {};

    process.on("SIGTERM", foreignListener);
    installGlobalProcessHandlers(bus);
    uninstallGlobalProcessHandlers(bus);

    expect(process.listeners("SIGTERM")).toContain(foreignListener);

    removeListenerIfPresent("SIGTERM", foreignListener);
    bus.destroy();
  });
});
