/**
 * MCP CLI 命令 — `crab mcp search` 和 `crab mcp install`。
 *
 * 职责:
 *   - search: 搜索 MCP 服务器目录
 *   - install: 安装 MCP 服务器到全局配置
 *   - list: 列出所有可用 MCP 服务器目录
 */

import { searchCatalog, getCatalogEntry, listCatalog, installCatalogEntry } from "@/mcp/catalog/mcpCatalog";

/** 搜索 MCP 目录 */
export async function mcpSearchCommand(keyword: string | undefined): Promise<void> {
  if (!keyword) {
    // 无关键词时列出全部
    const entries = listCatalog();
    console.log(`\nMCP 服务器目录 (共 ${entries.length} 个):\n`);
    for (const entry of entries) {
      console.log(`  ${entry.name.padEnd(22)} [${entry.category}] ${entry.description}`);
    }
    console.log(`\n使用 crab mcp install <name> 安装指定服务器`);
    return;
  }

  const results = searchCatalog(keyword);
  if (results.length === 0) {
    console.log(`未找到匹配 "${keyword}" 的 MCP 服务器`);
    return;
  }

  console.log(`\n搜索 "${keyword}" — 找到 ${results.length} 个结果:\n`);
  for (const entry of results) {
    console.log(`  ${entry.name.padEnd(22)} [${entry.category}] ${entry.description}`);
    console.log(`    安装: ${entry.installCommand} ${(entry.defaultArgs ?? []).join(" ")}`);
    console.log(`    官网: ${entry.officialUrl}`);
    console.log();
  }
}

/** 安装 MCP 服务器到全局配置 */
export async function mcpInstallCommand(name: string): Promise<void> {
  const entry = getCatalogEntry(name);
  if (!entry) {
    console.error(`错误: 目录中未找到 MCP 服务器 "${name}"`);
    console.log(`\n使用 crab mcp search 查看可用服务器列表`);
    process.exit(1);
  }

  console.log(`正在安装 MCP 服务器: ${name}`);
  console.log(`  描述: ${entry.description}`);
  console.log(`  命令: ${entry.installCommand} ${(entry.defaultArgs ?? []).join(" ")}`);

  const result = await installCatalogEntry(name);
  if (result.success) {
    console.log(`\n✓ ${result.message}`);
    console.log(`\n配置已写入: ${result.configPath}`);
    console.log(`重启 crab 后生效，或使用 crab --no-mcp 之外的正常模式启动`);
  } else {
    console.error(`\n✗ ${result.message}`);
    process.exit(1);
  }
}
