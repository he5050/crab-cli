import { $ } from "bun";
import path from "node:path";
import {
  getArchivePath,
  getAvailableTargets,
  getBinaryPath,
  getChecksumsPath,
  getMetadataPath,
  getVersion,
  pathExists,
  resolveTarget,
} from "./shared";

async function sha256(filePath: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(await Bun.file(filePath).arrayBuffer());
  return hasher.digest("hex");
}

function parseChecksums(text: string): Map<string, string> {
  const checksums = new Map<string, string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^([a-fA-F0-9]{64})\s+(.+)$/);
    if (!match) {
      throw new Error(`Invalid checksum manifest line: ${line}`);
    }
    checksums.set(match[2]!.trim(), match[1]!.toLowerCase());
  }
  return checksums;
}

async function main() {
  const version = await getVersion();
  const requestedTargets = process.argv.slice(2);
  const targets =
    requestedTargets.length > 0
      ? requestedTargets.map((targetId) => resolveTarget(targetId))
      : await getAvailableTargets();

  if (targets.length === 0) {
    throw new Error("No release targets available for verification.");
  }

  const checksumsPath = getChecksumsPath(version);
  const checksumsText = (await pathExists(checksumsPath)) ? await Bun.file(checksumsPath).text() : "";
  const checksums = parseChecksums(checksumsText);

  for (const target of targets) {
    const binaryPath = getBinaryPath(target.id);
    const metadataPath = getMetadataPath(target.id);
    const archivePath = getArchivePath(version, target.id);

    if (!(await pathExists(binaryPath))) {
      throw new Error(`Missing built binary for verification: ${binaryPath}`);
    }
    if (!(await pathExists(metadataPath))) {
      throw new Error(`Missing metadata for verification: ${metadataPath}`);
    }
    if (!(await pathExists(archivePath))) {
      throw new Error(`Missing archive for verification: ${archivePath}`);
    }

    const metadata = JSON.parse(await Bun.file(metadataPath).text()) as { version?: string; target?: string };
    if (metadata.version !== version) {
      throw new Error(`Metadata version mismatch for ${target.id}: expected ${version}, got ${metadata.version}`);
    }
    if (metadata.target !== target.id) {
      throw new Error(`Metadata target mismatch for ${target.id}: got ${metadata.target}`);
    }

    const versionOut = await $`${binaryPath} --version`.text();
    if (!versionOut.includes(version)) {
      throw new Error(`Binary version output mismatch for ${target.id}: ${versionOut.trim()}`);
    }

    const archiveList = await $`tar -tzf ${archivePath}`.text();
    if (
      !archiveList.includes("./crab") ||
      !archiveList.includes("./metadata.json") ||
      !archiveList.includes("./db/migrations/meta/_journal.json")
    ) {
      throw new Error(`Archive content mismatch for ${target.id}: expected crab, metadata.json and db migrations`);
    }

    const archiveName = path.basename(archivePath);
    const expectedChecksum = checksums.get(archiveName);
    if (!expectedChecksum) {
      throw new Error(`Checksum manifest is missing ${archiveName}`);
    }
    const actualChecksum = await sha256(archivePath);
    if (actualChecksum !== expectedChecksum) {
      throw new Error(`Checksum mismatch for ${archiveName}: expected ${expectedChecksum}, got ${actualChecksum}`);
    }

    console.log(`验证通过: ${target.id}`);
  }
}

await main();
