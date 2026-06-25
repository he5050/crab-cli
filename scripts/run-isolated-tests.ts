/**
 * 进程隔离的测试运行器
 * 每个测试文件在独立进程中运行，避免 mock.module() 跨文件污染
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { cwd } from "node:process";

const ROOT = cwd();
const TEST_DIR = join(ROOT, "test");
const GLOBAL_CRAB_DIR = join(homedir(), ".crab");
const RUNNER_CONFIG_SNAPSHOT_DIR = mkdtempSync(join(tmpdir(), "crab-runner-config-"));
const CONCURRENCY = Math.max(1, (parseInt(process.env.CONCURRENCY || "0", 10) || navigator.hardwareConcurrency || 4) - 1);
const USE_PROJECT_TEST_COVERAGE = process.env.CRAB_ISOLATED_TEST_COVERAGE === "1";
const BUN_TEST_TIMEOUT_MS = 60_000;

const CONFIG_FILES_TO_COPY = [
  "config.json",
  "mcp.json",
  "mcp-auth.json",
  "remote-workspaces.json",
  "permission-bridge.json",
  "sensitive-commands.json",
  "skills.json",
  "task-runner.json",
];

function findTestFiles(dir: string): string[] {
  const files: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findTestFiles(fullPath));
    } else if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function readNonNegativeIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readPositiveIntEnv(name: string): number | null {
  const raw = process.env[name];
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const allTestFiles = findTestFiles(TEST_DIR);
const batchSize = readPositiveIntEnv("TEST_BATCH_SIZE");
const batchIndex = readNonNegativeIntEnv("TEST_BATCH_INDEX", 0);
const batchStart = process.env.TEST_BATCH_START
  ? readNonNegativeIntEnv("TEST_BATCH_START", 0)
  : batchSize
    ? batchIndex * batchSize
    : 0;
const testFiles = batchSize
  ? allTestFiles.slice(batchStart, batchStart + batchSize)
  : allTestFiles;
const batchLabel = batchSize
  ? `, selected=${testFiles.length}, batchStart=${batchStart}, batchSize=${batchSize}, batchIndex=${batchIndex}`
  : "";
console.error(`Found ${allTestFiles.length} test files${batchLabel}, concurrency=${CONCURRENCY}`);
if (batchSize) {
  console.error("Selected files:");
  for (const file of testFiles) {
    console.error(`  ${relative(ROOT, file)}`);
  }
}

interface Result {
  file: string;
  pass: number;
  fail: number;
  skip: number;
  expect: number;
  output: string;
}

export interface ProcessResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  output: string;
  error?: string;
}

interface SnapshotEntry {
  existed: boolean;
}

let passCount = 0;
let failCount = 0;
let skipCount = 0;
let totalExpect = 0;
const failedFiles: Result[] = [];
const skippedFiles: Result[] = [];
const allResults: Result[] = [];
let restoredGlobalConfig = false;
let installedGlobalConfigProtection = false;
const globalConfigSnapshot = new Map<string, SnapshotEntry>();

function copyIfExists(src: string, dest: string): void {
  if (!existsSync(src)) return;
  cpSync(src, dest, { recursive: true, force: true });
}

function isLiveTestFile(file: string): boolean {
  try {
    const content = readFileSync(file, "utf-8");
    return (
      content.includes("hasLiveProviderConfig") ||
      content.includes("CRAB_SKIP_LIVE_TESTS") ||
      content.includes("loadRealTestConfig") ||
      content.includes("真实 LLM") ||
      content.includes("真实 provider") ||
      content.includes("runLive")
    );
  } catch {
    return false;
  }
}

function snapshotGlobalConfigFiles(): void {
  mkdirSync(RUNNER_CONFIG_SNAPSHOT_DIR, { recursive: true });
  for (const file of CONFIG_FILES_TO_COPY) {
    const globalPath = join(GLOBAL_CRAB_DIR, file);
    const existed = existsSync(globalPath);
    globalConfigSnapshot.set(file, { existed });
    copyIfExists(globalPath, join(RUNNER_CONFIG_SNAPSHOT_DIR, file));
  }
}

function restoreGlobalConfigFiles(): void {
  if (restoredGlobalConfig) return;
  restoredGlobalConfig = true;
  mkdirSync(GLOBAL_CRAB_DIR, { recursive: true });
  for (const file of CONFIG_FILES_TO_COPY) {
    const snapshotPath = join(RUNNER_CONFIG_SNAPSHOT_DIR, file);
    const globalPath = join(GLOBAL_CRAB_DIR, file);
    if (existsSync(snapshotPath)) {
      cpSync(snapshotPath, globalPath, { recursive: true, force: true });
      continue;
    }
    const snapshot = globalConfigSnapshot.get(file);
    if (snapshot && !snapshot.existed && existsSync(globalPath)) {
      rmSync(globalPath, { recursive: true, force: true });
    }
  }
  rmSync(RUNNER_CONFIG_SNAPSHOT_DIR, { recursive: true, force: true });
}

function installGlobalConfigProtection(): void {
  if (installedGlobalConfigProtection) return;
  installedGlobalConfigProtection = true;
  snapshotGlobalConfigFiles();
  process.once("exit", restoreGlobalConfigFiles);
  process.once("SIGINT", () => {
    restoreGlobalConfigFiles();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    restoreGlobalConfigFiles();
    process.exit(143);
  });
  process.once("SIGHUP", () => {
    restoreGlobalConfigFiles();
    process.exit(129);
  });
  process.once("uncaughtException", (error) => {
    restoreGlobalConfigFiles();
    throw error;
  });
}

function prepareProcessEnv(): { env: NodeJS.ProcessEnv; cleanup: () => void } {
  const envRoot = mkdtempSync(join(tmpdir(), "crab-isolated-test-"));
  const xdgConfigHome = join(envRoot, "config");
  const xdgDataHome = join(envRoot, "data");
  const configCrabDir = join(xdgConfigHome, "crab");
  const dataCrabDir = join(xdgDataHome, "crab");

  mkdirSync(configCrabDir, { recursive: true });
  mkdirSync(dataCrabDir, { recursive: true });

  for (const file of CONFIG_FILES_TO_COPY) {
    copyIfExists(join(RUNNER_CONFIG_SNAPSHOT_DIR, file), join(configCrabDir, file));
  }

  return {
    env: {
      ...process.env,
      XDG_CONFIG_HOME: xdgConfigHome,
      XDG_DATA_HOME: xdgDataHome,
    },
    cleanup: () => rmSync(envRoot, { recursive: true, force: true }),
  };
}

function recordResult(result: Result): void {
  allResults.push(result);
  passCount += result.pass;
  failCount += result.fail;
  skipCount += result.skip;
  totalExpect += result.expect;

  if (result.fail > 0) {
    failedFiles.push(result);
    console.log(`FAIL ${result.file} (${result.pass}p ${result.fail}f ${result.skip}s)`);
  }
  if (result.skip > 0) {
    skippedFiles.push(result);
  }
}

function isRateLimitFailure(output: string): boolean {
  if (/Budget has been exceeded|budget_exceeded|Max budget/.test(output)) {
    return false;
  }
  return /Rate limit exceeded|rate limit|429/.test(output);
}

function parseCount(output: string, label: "pass" | "fail" | "skip" | "expect"): number {
  const match = output.match(new RegExp(`(\\d+) ${label}`));
  return match ? parseInt(match[1]!, 10) : 0;
}

export function buildResultFromProcess(file: string, processResult: ProcessResult): Result {
  let output = processResult.output;
  if (processResult.error) {
    output += `\n[isolated-runner] process error: ${processResult.error}`;
  }
  if (processResult.timedOut) {
    output += "\n[isolated-runner] process timed out after 120000ms";
  }
  if (processResult.signal) {
    output += `\n[isolated-runner] process terminated by signal ${processResult.signal}`;
  }
  if (processResult.status !== null && processResult.status !== 0) {
    output += `\n[isolated-runner] process exited with status ${processResult.status}`;
  }

  const parsedFail = parseCount(output, "fail");
  const processFailed = processResult.error || processResult.timedOut || processResult.signal || processResult.status !== 0;
  const fail = processFailed && parsedFail === 0 ? 1 : parsedFail;

  return {
    file,
    pass: parseCount(output, "pass"),
    fail,
    skip: parseCount(output, "skip"),
    expect: parseCount(output, "expect"),
    output,
  };
}

async function spawnBunTest(relPath: string, env: NodeJS.ProcessEnv): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const args = USE_PROJECT_TEST_COVERAGE
      ? ["test", `--timeout=${BUN_TEST_TIMEOUT_MS}`, "--coverage", relPath]
      : ["test", `--timeout=${BUN_TEST_TIMEOUT_MS}`, relPath];
    const proc = spawn("bun", args, {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });

    let output = "";
    let settled = false;
    let timedOut = false;

    let timer: ReturnType<typeof setTimeout>;
    const finish = (result: Omit<ProcessResult, "output" | "timedOut">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, timedOut, output });
    };

    timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) proc.kill("SIGKILL");
      }, 5_000).unref();
    }, 120_000);
    timer.unref();

    proc.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    proc.on("error", (error) => {
      finish({ status: null, signal: null, error: error.message });
    });
    proc.on("close", (status, signal) => {
      finish({ status, signal });
    });
  });
}

async function runFileOnce(file: string): Promise<Result> {
  const relPath = relative(ROOT, file);
  const isolated = prepareProcessEnv();
  try {
    const processResult = await spawnBunTest(relPath, isolated.env);
    return buildResultFromProcess(relPath, processResult);
  } finally {
    isolated.cleanup();
  }
}

async function runFile(file: string): Promise<void> {
  const result = await runFileOnce(file);
  recordResult(result);
}

interface Running {
  promise: Promise<void>;
  file: string;
}

async function main() {
  installGlobalConfigProtection();
  const startTime = Date.now();
  const running = new Set<Running>();
  const liveFiles = testFiles.filter((file) => isLiveTestFile(file));
  const regularFiles = testFiles.filter((file) => !isLiveTestFile(file));

  for (const file of regularFiles) {
    while (running.size >= CONCURRENCY) {
      await Promise.race(Array.from(running).map((r) => r.promise));
      for (const r of running) {
        // Clean up completed
      }
    }
    const existing = Array.from(running);
    for (const r of existing) {
      const status = await Promise.race([r.promise, Promise.resolve("pending")]);
      if (status === "pending") continue;
      running.delete(r);
    }

    const prom = runFile(file);
    const runningEntry = { promise: prom, file };
    running.add(runningEntry);
    prom.finally(() => {
      running.delete(runningEntry);
    });
  }
  await Promise.all(Array.from(running).map((r) => r.promise));

  for (const file of liveFiles) {
    let attempt = 0;
    let result: Result | null = null;
    while (attempt < 3) {
      attempt += 1;
      result = await runFileOnce(file);
      if (result.fail === 0 || !isRateLimitFailure(result.output) || attempt >= 3) {
        break;
      }
      console.error(`Rate limit while running ${relative(ROOT, file)} (attempt ${attempt}/3), waiting 65s before retry...`);
      await new Promise((resolve) => setTimeout(resolve, 65_000));
    }
    if (result) {
      recordResult(result);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== RESULTS (${elapsed}s) ===`);
  console.log(`Pass: ${passCount} | Fail: ${failCount} | Skip: ${skipCount} | Expect: ${totalExpect}`);
  console.log(`Files: ${testFiles.length}/${allTestFiles.length} selected, ${failedFiles.length} failed`);

  if (skippedFiles.length > 0) {
    console.log("\nSkipped files:");
    for (const f of skippedFiles) {
      console.log(`  ${f.file} (${f.skip} skip)`);
      const skipLines = f.output
        .split("\n")
        .filter((line) => line.includes("(skip)"))
        .map((line) => line.trim());
      for (const line of skipLines.slice(0, 3)) {
        console.log(`    ${line}`);
      }
      if (skipLines.length > 3) {
        console.log(`    ... ${skipLines.length - 3} more skip line(s)`);
      }
    }
  }

  if (failedFiles.length > 0) {
    console.log("\nFailed files:");
    for (const f of failedFiles) {
      console.log(`  ${f.file} (${f.pass}p ${f.fail}f)`);
      const failLines = f.output.split("\n").filter((l) => l.includes("(fail)"));
      for (const fl of failLines.slice(0, 3)) {
        console.log(`    ${fl.trim()}`);
      }
    }
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
