import path from "node:path";
import { cp } from "node:fs/promises";
import { createBuildOptions } from "../../build";
import {
  ensureCleanDir,
  getArtifactDir,
  getBinaryPath,
  getMetadataPath,
  getVersion,
  hasNativePayload,
  resolveTarget,
} from "./shared";

async function main() {
  const targetId = process.argv[2];
  if (!targetId || targetId === "--help" || targetId === "-h") {
    console.log("Usage: bun run scripts/release/build-target.ts <darwin-arm64|darwin-x64|linux-x64|win32-x64|win32-arm64>");
    process.exit(targetId ? 0 : 1);
  }

  const target = resolveTarget(targetId);
  if (!(await hasNativePayload(target))) {
    throw new Error(
      `Missing native OpenTUI payload for ${target.id}. Expected installed package: ${target.nativePackage}`,
    );
  }
  const version = await getVersion();
  const artifactDir = getArtifactDir(target.id);
  const binaryPath = getBinaryPath(target.id);

  await ensureCleanDir(artifactDir);

  const result = await Bun.build(
    createBuildOptions({
      minify: true,
      sourcemap: "none",
      compile: {
        target: target.bunTarget,
        outfile: binaryPath,
        autoloadPackageJson: false,
        autoloadTsconfig: true,
        autoloadDotenv: false,
        autoloadBunfig: false,
      },
    }),
  );

  if (!result.success) {
    console.error(`构建目标失败: ${target.id}`);
    for (const msg of result.logs) {
      console.error(msg);
    }
    process.exit(1);
  }

  await Bun.write(
    getMetadataPath(target.id),
    JSON.stringify(
      {
        version,
        target: target.id,
        bunTarget: target.bunTarget,
        nativePackage: target.nativePackage,
        binary: path.basename(binaryPath),
        builtAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  await cp(path.join("src", "db", "migrations"), path.join(artifactDir, "db", "migrations"), {
    recursive: true,
  });

  console.log(`构建完成: ${target.id} -> ${artifactDir}`);
}

await main();
