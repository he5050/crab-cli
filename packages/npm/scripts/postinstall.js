#!/usr/bin/env node
/**
 * npm postinstall — 下载并 SHA-256 验证 crab-cli release binary。
 *
 * 流程:
 *   1. 读取 package.json 拿到 version(npm install 时由 npm 注入)
 *   2. 探测 platform-arch 目标(darwin-arm64 / darwin-x64 / linux-x64)
 *   3. 从 GitHub releases 下载对应 tarball + checksums.txt
 *   4. SHA-256 校验 tarball 中 crab 二进制的哈希
 *   5. 解压到 vendor/<target>/crab
 *
 * 失败模式(不阻断 install，向后兼容):
 *   - 无网络 / GitHub API 不可达 → 打印 warning，依赖 CRAB_CLI_BINARY
 *   - version 还未发布(开发分支) → 跳过下载
 *   - 不支持的 platform → 跳过下载
 *   - SHA-256 不匹配 → 拒绝(阻断！安全优先)
 *
 * 安全:
 *   - 只信任 https://github.com/...(TLS)
 *   - 必须通过 SHA-256 校验，校验失败删除文件并 exit 1
 *   - 二进制落地后 chmod 0o755
 *
 * Refs: docs/audit/V3-H-PUBLISH-AND-RELEASE-READINESS.md (P0)
 *      docs/PHASE-6-FIX-PLAN.md (A-1)
 */

const fs = require("node:fs")
const path = require("node:path")
const https = require("node:https")
const { createHash } = require("node:crypto")
const { spawnSync } = require("node:child_process")

const REPO_OWNER = "he5050"
const REPO_NAME = "crab-cli"

const PLATFORM_TARGETS = {
	"darwin-arm64": "darwin-arm64",
	"darwin-x64": "darwin-x64",
	"linux-x64": "linux-x64",
}

function resolveTarget() {
	const arch = process.arch === "x64" ? "x64" : process.arch
	return PLATFORM_TARGETS[`${process.platform}-${arch}`]
}

function getPackageVersion() {
	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"))
		return pkg.version
	} catch {
		return null
	}
}

function fetchText(url, redirects = 0) {
	return new Promise((resolve, reject) => {
		if (redirects > 5) return reject(new Error("Too many redirects"))
		const req = https.get(url, { headers: { "User-Agent": "crab-cli-postinstall" } }, (res) => {
			if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
				return resolve(fetchText(res.headers.location, redirects + 1))
			}
			if (res.statusCode !== 200) {
				return reject(new Error(`HTTP ${res.statusCode} for ${url}`))
			}
			const chunks = []
			res.on("data", (c) => chunks.push(c))
			res.on("end", () => resolve(Buffer.concat(chunks)))
			res.on("error", reject)
		})
		req.on("error", reject)
		req.setTimeout(30_000, () => req.destroy(new Error("Request timeout")))
	})
}

function parseChecksums(text) {
	const map = new Map()
	for (const line of text.split("\n")) {
		const trimmed = line.trim()
		if (!trimmed) continue
		const match = trimmed.match(/^([a-fA-F0-9]{64})\s+(.+)$/)
		if (match) map.set(match[2].trim(), match[1].toLowerCase())
	}
	return map
}

function sha256(buffer) {
	return createHash("sha256").update(buffer).digest("hex")
}

class IntegrityError extends Error {
	constructor(message) {
		super(message)
		this.name = "IntegrityError"
	}
}

async function downloadAndVerify(version, target) {
	const baseUrl = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/v${version}`
	const tarballName = `crab-cli-${version}-${target}.tar.gz`
	const tarballUrl = `${baseUrl}/${tarballName}`
	const checksumsUrl = `${baseUrl}/crab-cli-${version}-checksums.txt`

	console.log(`[crab-cli] Downloading ${tarballName} for ${process.platform}-${process.arch}…`)
	const checksumsText = (await fetchText(checksumsUrl)).toString("utf8")
	const checksums = parseChecksums(checksumsText)
	const expected = checksums.get(tarballName)
	if (!expected) {
		throw new IntegrityError(`No checksum found for ${tarballName} in checksums manifest`)
	}

	const tarball = await fetchText(tarballUrl)
	const actual = sha256(tarball)
	if (actual !== expected) {
		throw new IntegrityError(`SHA-256 mismatch for ${tarballName}: expected ${expected}, got ${actual}`)
	}

	const vendorDir = path.join(__dirname, "..", "vendor", target)
	fs.mkdirSync(vendorDir, { recursive: true })

	const tmpTarball = path.join(vendorDir, `.${tarballName}.tmp`)
	fs.writeFileSync(tmpTarball, tarball, { mode: 0o600 })

	const result = spawnSync("tar", ["-xzf", tmpTarball, "-C", vendorDir], { stdio: "inherit" })
	fs.unlinkSync(tmpTarball)
	if (result.status !== 0) {
		throw new Error(`tar extraction failed with status ${result.status}`)
	}

	const binaryPath = path.join(vendorDir, "crab")
	if (fs.existsSync(binaryPath)) {
		fs.chmodSync(binaryPath, 0o755)
	}

	console.log(`[crab-cli] Installed verified binary to ${binaryPath}`)
	console.log(`[crab-cli] SHA-256: ${actual}`)
}

async function main() {
	const target = resolveTarget()
	if (!target) {
		console.log(`[crab-cli] No prebuilt binary for ${process.platform}-${process.arch}.`)
		console.log("[crab-cli] Set CRAB_CLI_BINARY to a verified crab binary, or build from source.")
		return
	}

	if (process.env.CRAB_CLI_BINARY) {
		console.log("[crab-cli] CRAB_CLI_BINARY set, skipping download.")
		return
	}

	const version = getPackageVersion()
	if (!version || version === "0.0.0" || version.includes("dev")) {
		console.log(`[crab-cli] Dev/internal version (${version}), skipping release download.`)
		return
	}

	try {
		await downloadAndVerify(version, target)
	} catch (err) {
		if (err instanceof IntegrityError) {
			console.error(`[crab-cli] postinstall integrity check failed: ${err.message}`)
			process.exit(1)
		}
		console.warn(`[crab-cli] postinstall download failed: ${err.message}`)
		console.warn("[crab-cli] Falling back to CRAB_CLI_BINARY or source build.")
	}
}

main().catch((err) => {
	console.error("[crab-cli] postinstall error:", err)
	process.exit(1)
})
