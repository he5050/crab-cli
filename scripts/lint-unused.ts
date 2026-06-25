const UNUSED_CODES = new Set(["6133", "6192", "6196"]);
const SCOPED_PREFIXES = ["src/ui/", "src/tool/", "src/conversation/"];

const proc = Bun.spawn(["bun", "x", "tsc", "--project", "tsconfig.unused.json", "--noEmit", "--pretty", "false"], {
  stdout: "pipe",
  stderr: "pipe",
});

const [stdout, stderr, exitCode] = await Promise.all([
  new Response(proc.stdout).text(),
  new Response(proc.stderr).text(),
  proc.exited,
]);

const output = [stdout, stderr].filter(Boolean).join("\n");
const scopedDiagnostics = output
  .split(/\r?\n/)
  .filter((line) => {
    const match = line.match(/^(src\/[^(:]+)\(\d+,\d+\): error TS(\d+): /);
    if (!match) return false;
    const [, filePath, code] = match;
    return !!filePath && UNUSED_CODES.has(code ?? "") && SCOPED_PREFIXES.some((prefix) => filePath.startsWith(prefix));
  });

if (scopedDiagnostics.length === 0) {
  console.log("lint:unused passed: no scoped unused-code diagnostics found.");
  process.exit(0);
}

console.warn(`lint:unused found ${scopedDiagnostics.length} scoped unused-code diagnostics:`);
for (const line of scopedDiagnostics) {
  console.warn(line);
}

if (process.env.CRAB_UNUSED_STRICT === "1") {
  process.exit(1);
}

console.warn("lint:unused warning mode: set CRAB_UNUSED_STRICT=1 to fail on these diagnostics.");
if (exitCode === 0) {
  process.exit(0);
}
process.exit(0);
