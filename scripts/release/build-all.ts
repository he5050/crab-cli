import { parseArgs } from "node:util";
import { getAvailableTargets, RELEASE_TARGETS, resolveTarget } from "./shared";

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log("Usage: bun run scripts/release/build-all.ts [target...]");
    console.log(`Supported targets: ${RELEASE_TARGETS.map((target) => target.id).join(", ")}`);
    return;
  }

  const targetIds = positionals.length > 0 ? positionals : (await getAvailableTargets()).map((target) => target.id);
  if (targetIds.length === 0) {
    throw new Error("No release targets have native OpenTUI payloads installed on this host.");
  }

  if (positionals.length === 0) {
    const unavailable = RELEASE_TARGETS.map((target) => target.id).filter((targetId) => !targetIds.includes(targetId));
    if (unavailable.length > 0) {
      console.warn(`跳过缺少原生 payload 的目标: ${unavailable.join(", ")}`);
      if (targetIds.length < RELEASE_TARGETS.length) {
        console.warn(
          `本机仅 ${targetIds.length}/${RELEASE_TARGETS.length} targets 可用。` +
          `完整多平台 release 请 push v* tag 触发 GitHub Actions(.github/workflows/release.yml)。`,
        );
      }
    }
  } else {
    positionals.forEach((targetId) => resolveTarget(targetId));
  }

  for (const targetId of targetIds) {
    const proc = Bun.spawn(["bun", "run", "scripts/release/build-target.ts", targetId], {
      cwd: process.cwd(),
      stdout: "inherit",
      stderr: "inherit",
    });

    const code = await proc.exited;
    if (code !== 0) {
      process.exit(code);
    }
  }

  console.log(`全部目标构建完成: ${targetIds.join(", ")}`);
}

await main();
