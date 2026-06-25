#!/usr/bin/env bun
/**
 * 性能基准测试脚本
 *
 * 用途:
 *   - 定期运行性能测试
 *   - 记录基线数据
 *   - 生成性能报告
 *   - 对比历史数据
 *
 * 使用方法:
 *   bun run scripts/performance-benchmark.ts
 *   bun run scripts/performance-benchmark.ts --compare    # 与基线对比
 *   bun run scripts/performance-benchmark.ts --baseline   # 设置新基线
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.join(__dirname, "..")
const benchmarkDir = path.join(projectRoot, ".benchmark")
const baselineFile = path.join(benchmarkDir, "baseline.json")
const reportFile = path.join(benchmarkDir, `report-${new Date().toISOString().split("T")[0]}.json`)

// 确保目录存在
if (!fs.existsSync(benchmarkDir)) {
	fs.mkdirSync(benchmarkDir, { recursive: true })
}

interface BenchmarkResult {
	timestamp: string
	test: string
	duration: number
	memory: {
		start: number
		end: number
		peak: number
		delta: number
	}
	passed: boolean
	error?: string
}

interface BenchmarkReport {
	date: string
	results: BenchmarkResult[]
	summary: {
		totalTests: number
		passed: number
		failed: number
		avgDuration: number
		avgMemoryDelta: number
	}
}

/** 获取当前内存使用 */
function getMemoryUsage(): number {
	const usage = process.memoryUsage()
	return Math.round((usage.rss / 1024 / 1024) * 10) / 10
}

/** 运行单个测试 */
async function runTest(name: string, testFn: () => Promise<void>): Promise<BenchmarkResult> {
	const startMem = getMemoryUsage()
	const startTime = Date.now()

	try {
		await testFn()
		const duration = Date.now() - startTime
		const endMem = getMemoryUsage()

		return {
			timestamp: new Date().toISOString(),
			test: name,
			duration: Math.round(duration),
			memory: {
				start: startMem,
				end: endMem,
				peak: Math.max(startMem, endMem),
				delta: Math.round((endMem - startMem) * 10) / 10,
			},
			passed: true,
		}
	} catch (err) {
		return {
			timestamp: new Date().toISOString(),
			test: name,
			duration: Date.now() - startTime,
			memory: {
				start: startMem,
				end: getMemoryUsage(),
				peak: startMem,
				delta: 0,
			},
			passed: false,
			error: err instanceof Error ? err.message : String(err),
		}
	}
}

/** 性能测试用例 */
const tests: Record<string, () => Promise<void>> = {
	缓存基本操作: async () => {
		const { createCacheManager } = await import("../src/core/cacheManager")
		const cache = createCacheManager({ name: "benchmark", maxSize: 1000 })

		for (let i = 0; i < 1000; i++) {
			cache.set(`key-${i}`, `value-${i}`)
		}

		for (let i = 0; i < 1000; i++) {
			cache.get(`key-${i}`)
		}
	},

	"LRU 淘汰": async () => {
		const { createCacheManager } = await import("../src/core/cacheManager")
		const cache = createCacheManager({ name: "lru-benchmark", maxSize: 100 })

		for (let i = 0; i < 500; i++) {
			cache.set(`key-${i}`, `value-${i}`)
		}
	},

	令牌桶限流: async () => {
		const { TokenBucket } = await import("../src/core/backpressure")
		const bucket = new TokenBucket(100, 50)

		for (let i = 0; i < 100; i++) {
			bucket.tryAcquire()
		}
	},

	请求队列: async () => {
		const { RequestQueue } = await import("../src/core/backpressure")
		const queue = new RequestQueue(5)

		const promises = []
		for (let i = 0; i < 20; i++) {
			promises.push(
				queue.enqueue({
					id: `req-${i}`,
					type: "benchmark",
					execute: () => new Promise((resolve) => setTimeout(resolve, 10)),
				}),
			)
		}

		await Promise.all(promises)
	},

	资源监控: async () => {
		const { getMemoryUsageMB, getCpuUsagePercent, getMemoryStats } = await import("../src/core/resourceMonitor")

		getMemoryUsageMB()
		getCpuUsagePercent()
		getMemoryStats()
	},
}

/** 运行所有测试 */
async function runBenchmark(): Promise<BenchmarkReport> {
	console.log("🚀 开始性能基准测试...\n")

	const results: BenchmarkResult[] = []

	for (const [name, testFn] of Object.entries(tests)) {
		process.stdout.write(`  运行: ${name}... `)
		const result = await runTest(name, testFn)
		results.push(result)

		const status = result.passed ? "✅" : "❌"
		const duration = result.duration < 1000 ? `${result.duration}ms` : `${(result.duration / 1000).toFixed(1)}s`
		const memory = result.memory.delta > 0 ? `+${result.memory.delta}MB` : `${result.memory.delta}MB`

		console.log(`${status} ${duration} | 内存: ${memory}`)
	}

	const passed = results.filter((r) => r.passed).length
	const failed = results.filter((r) => !r.passed).length
	const avgDuration = Math.round(results.reduce((sum, r) => sum + r.duration, 0) / results.length)
	const avgMemoryDelta = Math.round((results.reduce((sum, r) => sum + r.memory.delta, 0) / results.length) * 10) / 10

	const report: BenchmarkReport = {
		date: new Date().toISOString(),
		results,
		summary: {
			totalTests: results.length,
			passed,
			failed,
			avgDuration,
			avgMemoryDelta,
		},
	}

	// 保存报告
	fs.writeFileSync(reportFile, JSON.stringify(report, null, 2))

	console.log(`\n📊 测试完成！`)
	console.log(`  总计: ${results.length} 个测试`)
	console.log(`  通过: ${passed} ✅`)
	console.log(`  失败: ${failed} ❌`)
	console.log(`  平均耗时: ${avgDuration}ms`)
	console.log(`  平均内存变化: ${avgMemoryDelta}MB`)
	console.log(`\n📝 报告已保存: ${reportFile}`)

	return report
}

/** 与基线对比 */
async function compareWithBaseline(): Promise<number> {
	if (!fs.existsSync(baselineFile)) {
		console.log("⚠️  未找到基线文件，先运行一次基准测试创建基线")
		const report = await runBenchmark()
		fs.writeFileSync(baselineFile, JSON.stringify(report, null, 2))
		console.log("✅ 基线已创建")
		return report.summary.failed > 0 ? 1 : 0
	}

	const baseline: BenchmarkReport = JSON.parse(fs.readFileSync(baselineFile, "utf-8"))
	const current = await runBenchmark()

	console.log("\n📈 与基线对比:")
	console.log(`  基线日期: ${new Date(baseline.date).toLocaleString()}`)
	console.log(`  当前日期: ${new Date(current.date).toLocaleString()}`)

	const durationChange = current.summary.avgDuration - baseline.summary.avgDuration
	const memoryChange = current.summary.avgMemoryDelta - baseline.summary.avgMemoryDelta

	const durationStatus = durationChange <= 0 ? "✅" : durationChange < 100 ? "⚠️" : "❌"
	const memoryStatus = memoryChange <= 0 ? "✅" : memoryChange < 10 ? "⚠️" : "❌"

	console.log(`  平均耗时: ${durationChange >= 0 ? "+" : ""}${durationChange}ms ${durationStatus}`)
	console.log(`  平均内存: ${memoryChange >= 0 ? "+" : ""}${memoryChange}MB ${memoryStatus}`)

	// 检查是否有性能回归
	if (durationChange > 200 || memoryChange > 20) {
		console.log("\n⚠️  检测到性能回归！")
	} else {
		console.log("\n✅ 性能表现良好")
	}

	return current.summary.failed > 0 ? 1 : 0
}

/** 主函数 */
async function main(): Promise<number> {
	const args = process.argv.slice(2)

	if (args.includes("--compare")) {
		return await compareWithBaseline()
	} else if (args.includes("--baseline")) {
		console.log("📝 创建新基线...")
		const report = await runBenchmark()
		fs.writeFileSync(baselineFile, JSON.stringify(report, null, 2))
		console.log("✅ 基线已更新")
		return report.summary.failed > 0 ? 1 : 0
	}

	const report = await runBenchmark()
	return report.summary.failed > 0 ? 1 : 0
}

// 运行
main()
	.then((exitCode) => {
		process.exit(exitCode)
	})
	.catch((err) => {
		console.error("❌ 基准测试失败:", err)
		process.exit(1)
	})
