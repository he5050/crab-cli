import { afterEach, beforeEach } from "bun:test";
import { initDb, resetDb } from "@/db";
import { clearAllApprovals } from "@/permission/store/approvalStore";
import { cleanupTestDir, createGlobalTmpTestDir } from "./testPaths";

export function installDbIsolation(prefix: string): void {
  let tempDir = "";
  let originalXdgDataHome: string | undefined;

  beforeEach(() => {
    resetDb();
    tempDir = createGlobalTmpTestDir(prefix);
    originalXdgDataHome = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = tempDir;
    initDb();
    clearAllApprovals();
  });

  afterEach(() => {
    try {
      clearAllApprovals();
    } catch {
      // Ignore cleanup errors from tests that mock or close the DB explicitly.
    }
    resetDb();

    if (originalXdgDataHome !== undefined) {
      process.env.XDG_DATA_HOME = originalXdgDataHome;
    } else {
      delete process.env.XDG_DATA_HOME;
    }

    cleanupTestDir(tempDir);
    tempDir = "";
  });
}
