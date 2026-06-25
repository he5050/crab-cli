import { mkdir, lstat, rm, symlink } from "node:fs/promises";
import path from "node:path";

const globalBinDir = Bun.spawnSync(["bun", "pm", "bin", "-g"], {
  stdout: "pipe",
  stderr: "pipe",
});

if (globalBinDir.exitCode !== 0) {
  console.error(globalBinDir.stderr.toString());
  process.exit(globalBinDir.exitCode);
}

const binDir = globalBinDir.stdout.toString().trim();
const sourcePath = path.resolve(import.meta.dir, "../bin/crab-local.ts");
const targetPath = path.join(binDir, "crab-local");

await mkdir(binDir, { recursive: true });

try {
  const stat = await lstat(targetPath);
  if (stat.isSymbolicLink() || stat.isFile()) {
    await rm(targetPath, { force: true });
  }
} catch {
  // target missing is fine
}

await symlink(sourcePath, targetPath);

console.log(`已安装 crab-local -> ${targetPath}`);
console.log(`源文件: ${sourcePath}`);
