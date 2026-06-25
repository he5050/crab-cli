/**
 * Build script — 使用 @opentui/solid 的 Babel 插件正确编译 JSX。
 *
 * 直接运行 `bun build` 无法处理 @opentui/solid 的自定义 JSX 语法，
 * 需要通过其 bun-plugin 进行 Babel 转换。
 *
 * 另外，`ssh2` 是运行时按需加载的可选依赖，
 * 其内部会引用本地原生绑定 `cpu-features`。
 * 对 CLI bundle 来说不应在构建阶段展开，因此这里显式 externalize。
 */
import { readFileSync } from "node:fs"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"

const OPENTUI_NATIVE_OPTIONAL_PACKAGES = [
	"@opentui/core-darwin-arm64",
	"@opentui/core-darwin-x64",
	"@opentui/core-linux-arm64",
	"@opentui/core-linux-arm64-musl",
	"@opentui/core-linux-x64",
	"@opentui/core-linux-x64-musl",
	"@opentui/core-win32-arm64",
	"@opentui/core-win32-x64",
]

function readPackageVersion(): string {
	const content = readFileSync(new URL("./package.json", import.meta.url), "utf8")
	const pkg = JSON.parse(content) as { version?: string }
	return pkg.version ?? "0.0.0"
}

export function createBuildOptions(overrides: Partial<Bun.BuildConfig> = {}): Bun.BuildConfig {
	const solidPlugin = createSolidTransformPlugin({
		moduleName: "@opentui/solid",
	})

	return {
		entrypoints: ["src/index.ts"],
		outdir: "dist",
		target: "bun" as const,
		plugins: [solidPlugin],
		minify: true,
		sourcemap: "linked" as const,
		external: ["ssh2", ...OPENTUI_NATIVE_OPTIONAL_PACKAGES],
		define: {
			__CRAB_CLI_VERSION__: JSON.stringify(readPackageVersion()),
			...(overrides.define ?? {}),
		},
		...overrides,
	}
}

async function main() {
	const result = await Bun.build(createBuildOptions())

	if (!result.success) {
		console.error("构建失败:")
		for (const msg of result.logs) {
			console.error(msg)
		}
		process.exit(1)
	}

	// 复制数据库迁移文件到 dist/
	const { cpSync, existsSync, mkdirSync } = await import("node:fs")
	const { join } = await import("node:path")

	const migrationsSource = "src/db/migrations"
	const migrationsTarget = "dist/db/migrations"

	if (existsSync(migrationsSource)) {
		const targetDir = join("dist", "db")
		if (!existsSync(targetDir)) {
			mkdirSync(targetDir, { recursive: true })
		}
		cpSync(migrationsSource, migrationsTarget, { recursive: true })
		console.log("已复制数据库迁移文件到 dist/")
	}

	console.log(`构建成功 — ${result.outputs.length} 个输出文件`)
}

if (import.meta.main) {
	await main()
}
