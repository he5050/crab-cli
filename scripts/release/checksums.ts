import path from "node:path";
import { getArchivePath, getAvailableTargets, getChecksumsPath, getVersion, pathExists } from "./shared";

async function sha256(filePath: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(await Bun.file(filePath).arrayBuffer());
  return hasher.digest("hex");
}

async function main() {
  const version = await getVersion();
  const lines: string[] = [];
  const explicitArchivePaths = process.argv.slice(2).map((filePath) => path.resolve(process.cwd(), filePath));

  const archivePaths =
    explicitArchivePaths.length > 0
      ? explicitArchivePaths
      : (await getAvailableTargets()).map((target) => getArchivePath(version, target.id));

  for (const archivePath of archivePaths) {
    if (!(await pathExists(archivePath))) {
      throw new Error(`Missing release archive: ${archivePath}`);
    }
    lines.push(`${await sha256(archivePath)}  ${path.basename(archivePath)}`);
  }

  const checksumsPath = getChecksumsPath(version);
  await Bun.write(checksumsPath, `${lines.join("\n")}\n`);
  console.log(`已生成 checksum: ${checksumsPath}`);
}

await main();
