const FORMAT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".scss",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

function runGit(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(["git", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    ok: proc.exitCode === 0,
    stdout: new TextDecoder().decode(proc.stdout),
    stderr: new TextDecoder().decode(proc.stderr),
  };
}

function extensionOf(filePath: string): string {
  const index = filePath.lastIndexOf(".");
  return index >= 0 ? filePath.slice(index) : "";
}

function collectChangedFiles(): string[] {
  const files = new Set<string>();
  const addOutput = (output: string) => {
    for (const line of output.split(/\r?\n/)) {
      const filePath = line.trim();
      if (!filePath || !FORMAT_EXTENSIONS.has(extensionOf(filePath))) continue;
      files.add(filePath);
    }
  };

  const base = process.env.CRAB_FORMAT_BASE?.trim();
  if (base) {
    const baseDiff = runGit(["diff", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`]);
    if (baseDiff.ok) {
      addOutput(baseDiff.stdout);
    } else {
      console.warn(`format:check could not diff CRAB_FORMAT_BASE=${base}: ${baseDiff.stderr.trim()}`);
    }
  }

  addOutput(runGit(["diff", "--name-only", "--diff-filter=ACMR"]).stdout);
  addOutput(runGit(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]).stdout);
  return [...files].sort();
}

const violations: string[] = [];
for (const filePath of collectChangedFiles()) {
  const file = Bun.file(filePath);
  if (!(await file.exists())) continue;
  const content = await file.text();
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (/[ \t]+$/.test(line)) {
      violations.push(`${filePath}:${lineNumber}: trailing whitespace`);
    }
    if (/^\t+/.test(line)) {
      violations.push(`${filePath}:${lineNumber}: tab indentation`);
    }
  });
}

if (violations.length === 0) {
  console.log("format:check passed.");
  process.exit(0);
}

console.error(`format:check found ${violations.length} formatting issue(s):`);
for (const violation of violations) {
  console.error(violation);
}
process.exit(1);
