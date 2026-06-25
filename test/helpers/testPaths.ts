import fs from "node:fs";
import path from "node:path";
import { getGlobalTmpDir, getProjectTmpDir } from "@/config/paths";

export function createGlobalTmpTestDir(prefix: string): string {
  const baseDir = path.join(getProjectTmpDir(process.cwd()), "tests");
  fs.mkdirSync(baseDir, { recursive: true });
  return fs.mkdtempSync(path.join(baseDir, prefix));
}

export function createProjectTmpTestDir(projectDir: string, prefix: string): string {
  const baseDir = path.join(getProjectTmpDir(projectDir), "tests");
  fs.mkdirSync(baseDir, { recursive: true });
  return fs.mkdtempSync(path.join(baseDir, prefix));
}

export function cleanupTestDir(dir: string): void {
  try {
    fs.rmSync(dir, { force: true, recursive: true });
  } catch {
    // Ignore
  }
}

export function getGlobalTmpTestPath(...parts: string[]): string {
  return path.join(getGlobalTmpDir(), ...parts);
}
