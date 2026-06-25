import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

export const RELEASE_TARGETS = [
  { id: "darwin-arm64", bunTarget: "bun-darwin-arm64", nativePackage: "@opentui/core-darwin-arm64" },
  { id: "darwin-x64", bunTarget: "bun-darwin-x64", nativePackage: "@opentui/core-darwin-x64" },
  { id: "linux-x64", bunTarget: "bun-linux-x64", nativePackage: "@opentui/core-linux-x64" },
  { id: "win32-x64", bunTarget: "bun-windows-x64", nativePackage: "@opentui/core-win32-x64" },
  { id: "win32-arm64", bunTarget: "bun-windows-arm64", nativePackage: "@opentui/core-win32-arm64" },
] as const;

export type ReleaseTarget = (typeof RELEASE_TARGETS)[number];
export type ReleaseTargetId = ReleaseTarget["id"];

export const ROOT_DIR = path.resolve(import.meta.dir, "../..");
export const ARTIFACTS_DIR = path.join(ROOT_DIR, "artifacts");
export const RELEASE_DIR = path.join(ROOT_DIR, "release");

export function getVersion(): Promise<string> {
  return readFile(path.join(ROOT_DIR, "package.json"), "utf8").then((content) => {
    const pkg = JSON.parse(content) as { version?: string };
    if (!pkg.version) {
      throw new Error("Root package.json is missing version");
    }
    return pkg.version;
  });
}

export function resolveTarget(targetId: string): ReleaseTarget {
  const target = RELEASE_TARGETS.find((item) => item.id === targetId);
  if (!target) {
    throw new Error(
      `Unsupported release target: ${targetId}. Supported targets: ${RELEASE_TARGETS.map((item) => item.id).join(", ")}`,
    );
  }
  return target;
}

export function getArtifactName(targetId: ReleaseTargetId): string {
  return `crab-cli-${targetId}`;
}

export function getArtifactDir(targetId: ReleaseTargetId): string {
  return path.join(ARTIFACTS_DIR, getArtifactName(targetId));
}

export function getBinaryName(): string {
  return "crab";
}

export function getBinaryPath(targetId: ReleaseTargetId): string {
  return path.join(getArtifactDir(targetId), getBinaryName());
}

export function getMetadataPath(targetId: ReleaseTargetId): string {
  return path.join(getArtifactDir(targetId), "metadata.json");
}

export function getArchiveName(version: string, targetId: ReleaseTargetId): string {
  const ext = targetId.startsWith("win32") ? ".zip" : ".tar.gz";
  return `crab-cli-${version}-${targetId}${ext}`;
}

export function getArchivePath(version: string, targetId: ReleaseTargetId): string {
  return path.join(RELEASE_DIR, getArchiveName(version, targetId));
}

export function getChecksumsPath(version: string): string {
  return path.join(RELEASE_DIR, `crab-cli-${version}-checksums.txt`);
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function ensureCleanDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
  await ensureDir(dir);
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

export function getTargetPackageDir(target: ReleaseTarget): string {
  return path.join(ROOT_DIR, "node_modules", ...target.nativePackage.split("/"));
}

export async function hasNativePayload(target: ReleaseTarget): Promise<boolean> {
  return pathExists(path.join(getTargetPackageDir(target), "package.json"));
}

export async function getAvailableTargets(): Promise<ReleaseTarget[]> {
  const checks = await Promise.all(RELEASE_TARGETS.map(async (target) => ({ target, ok: await hasNativePayload(target) })));
  return checks.filter((item) => item.ok).map((item) => item.target);
}
