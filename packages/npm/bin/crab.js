#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const platformTargets = {
  "darwin-arm64": "darwin-arm64",
  "darwin-x64": "darwin-x64",
  "linux-x64": "linux-x64",
};

function resolveTarget() {
  const arch = process.arch === "x64" ? "x64" : process.arch;
  return platformTargets[`${process.platform}-${arch}`];
}

function executableCandidates() {
  const target = resolveTarget();
  const candidates = [];
  if (process.env.CRAB_CLI_BINARY) {
    candidates.push(process.env.CRAB_CLI_BINARY);
  }
  if (target) {
    candidates.push(path.resolve(__dirname, "..", "vendor", target, "crab"));
    candidates.push(path.resolve(__dirname, "..", "..", "..", "dist", target, "crab"));
    candidates.push(path.resolve(__dirname, "..", "..", "..", "release", target, "crab"));
  }
  return candidates;
}

function findExecutable() {
  for (const candidate of executableCandidates()) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

const binary = findExecutable();
if (!binary) {
  const target = resolveTarget() ?? `${process.platform}-${process.arch}`;
  console.error(`crab-cli binary is not installed for ${target}.`);
  console.error("Set CRAB_CLI_BINARY to a verified crab binary, or install a package that includes vendor/<target>/crab.");
  process.exit(1);
}

const result = spawnSync(binary, process.argv.slice(2), { stdio: "inherit" });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 0);
