import path from "node:path";
import { $ } from "bun";
import {
  getAvailableTargets,
  ensureDir,
  getArchivePath,
  getBinaryPath,
  getVersion,
  pathExists,
  RELEASE_DIR,
} from "./shared";

async function main() {
  const version = await getVersion();
  await ensureDir(RELEASE_DIR);
  const targets = await getAvailableTargets();

  for (const target of targets) {
    const binaryPath = getBinaryPath(target.id);
    if (!(await pathExists(binaryPath))) {
      throw new Error(`Missing built binary for ${target.id}: ${binaryPath}`);
    }

    const archivePath = getArchivePath(version, target.id);
    if (target.id.startsWith("win32")) {
      const { execSync } = await import("node:child_process");
      const dir = path.dirname(binaryPath);
      execSync(`zip -r "${archivePath}" .`, { cwd: dir, stdio: "pipe" });
    } else {
      await $`tar -czf ${archivePath} -C ${path.dirname(binaryPath)} .`.quiet();
    }
    console.log(`已打包: ${archivePath}`);
  }
}

await main();
