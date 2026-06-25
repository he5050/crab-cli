/**
 * 目录结构迁移 — 将旧版平铺文件迁移到新的子目录结构。
 *
 * 职责:
 *   - 检测旧版文件位置
 *   - 自动迁移到新目录（data/、auth/、logs/audit/）
 *   - 不阻塞启动，迁移失败仅 warn 日志
 *   - 幂等：已迁移的文件不重复处理
 *
 * 迁移映射:
 *   ~/.crab/crab.db               → ~/.crab/data/crab.db
 *   ~/.crab/crab-search.db        → ~/.crab/data/crab-search.db
 *   ~/.crab/ace-symbol-index.db   → ~/.crab/data/ace-symbol-index.db
 *   ~/.crab/schedules.json        → ~/.crab/data/schedules.json
 *   ~/.crab/task-runner.json      → ~/.crab/data/task-runner.json
 *   ~/.crab/command-usage.json    → ~/.crab/data/command-usage.json
 *   ~/.crab/memory.json           → ~/.crab/data/memory.json
 *   ~/.crab/remote-workspaces.json → ~/.crab/data/remote-workspaces.json
 *   ~/.crab/permission-bridge.json → ~/.crab/data/permission-bridge.json
 *   ~/.crab/acp.pid               → ~/.crab/data/acp.pid
 *   ~/.crab/acp.config.json       → ~/.crab/data/acp.config.json
 *   ~/.crab/sessions/             → ~/.crab/data/sessions/
 *   ~/.crab/tasks/                → ~/.crab/data/tasks/
 *   ~/.crab/teams/                → ~/.crab/data/teams/
 *   ~/.crab/snapshots/            → ~/.crab/data/snapshots/
 *   ~/.crab/shares/               → ~/.crab/data/shares/
 *   ~/.crab/backups/              → ~/.crab/data/backups/
 *   ~/.crab/api-auth.token        → ~/.crab/auth/api-auth.token
 *   ~/.crab/mcp-auth.json         → ~/.crab/auth/mcp-auth.json
 *   ~/.crab/auth/                 → ~/.crab/auth/（已在新位置）
 *   ~/.crab/audit/                → ~/.crab/logs/audit/
 */
import { existsSync, mkdirSync, renameSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { getGlobalCrabDir, getDataDir, getAuthDir, getAuditDir } from "@/config/paths/paths";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("config:migrate");

/** 旧位置 → 新位置 文件迁移映射 */
const FILE_MIGRATIONS: Array<{ from: string; to: string }> = [
  // 数据库文件
  { from: "crab.db", to: "data/crab.db" },
  { from: "crab-search.db", to: "data/crab-search.db" },
  { from: "ace-symbol-index.db", to: "data/ace-symbol-index.db" },
  // 运行时数据文件
  { from: "schedules.json", to: "data/schedules.json" },
  { from: "task-runner.json", to: "data/task-runner.json" },
  { from: "command-usage.json", to: "data/command-usage.json" },
  { from: "memory.json", to: "data/memory.json" },
  { from: "remote-workspaces.json", to: "data/remote-workspaces.json" },
  { from: "permission-bridge.json", to: "data/permission-bridge.json" },
  { from: "acp.pid", to: "data/acp.pid" },
  { from: "acp.config.json", to: "data/acp.config.json" },
  // 认证文件
  { from: "api-auth.token", to: "auth/api-auth.token" },
  { from: "mcp-auth.json", to: "auth/mcp-auth.json" },
];

/** 旧位置 → 新位置 目录迁移映射 */
const DIR_MIGRATIONS: Array<{ from: string; to: string }> = [
  { from: "sessions", to: "data/sessions" },
  { from: "tasks", to: "data/tasks" },
  { from: "teams", to: "data/teams" },
  { from: "snapshots", to: "data/snapshots" },
  { from: "shares", to: "data/shares" },
  { from: "backups", to: "data/backups" },
  { from: "audit", to: "logs/audit" },
];

/**
 * 执行目录结构迁移。
 * 在应用启动时调用，幂等执行。
 */
export function migrateDirectoryStructure(): void {
  const root = getGlobalCrabDir();
  const dataDir = getDataDir();
  const authDir = getAuthDir();
  const auditDir = getAuditDir();

  // 确保新目录存在
  for (const dir of [dataDir, authDir, auditDir]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  let migrated = 0;

  // 文件迁移
  for (const { from, to } of FILE_MIGRATIONS) {
    const fromPath = path.join(root, from);
    const toPath = path.join(root, to);
    if (existsSync(fromPath) && !existsSync(toPath)) {
      try {
        mkdirSync(path.dirname(toPath), { recursive: true });
        renameSync(fromPath, toPath);
        migrated++;
      } catch (err) {
        log.warn(`迁移文件失败: ${from} → ${to}`, { error: String(err) });
      }
    }
  }

  // 数据库 WAL/SHM 文件
  const dbFiles = [
    "crab.db-wal",
    "crab.db-shm",
    "crab-search.db-wal",
    "crab-search.db-shm",
    "ace-symbol-index.db-wal",
    "ace-symbol-index.db-shm",
  ];
  for (const dbFile of dbFiles) {
    const fromPath = path.join(root, dbFile);
    const toPath = path.join(dataDir, dbFile);
    if (existsSync(fromPath) && !existsSync(toPath)) {
      try {
        renameSync(fromPath, toPath);
        migrated++;
      } catch {
        // WAL/SHM 文件可能被锁定，忽略错误
      }
    }
  }

  // 目录迁移（逐文件合并，而非整个目录 rename）
  for (const { from, to } of DIR_MIGRATIONS) {
    const fromPath = path.join(root, from);
    const toPath = path.join(root, to);
    if (existsSync(fromPath)) {
      try {
        mkdirSync(toPath, { recursive: true });
        const entries = readdirSync(fromPath);
        for (const entry of entries) {
          const src = path.join(fromPath, entry);
          const dst = path.join(toPath, entry);
          if (!existsSync(dst)) {
            renameSync(src, dst);
            migrated++;
          }
        }
        // 清理空目录
        if (readdirSync(fromPath).length === 0) {
          rmSync(fromPath, { recursive: true });
        }
      } catch (err) {
        log.warn(`迁移目录失败: ${from} → ${to}`, { error: String(err) });
      }
    }
  }

  // 迁移旧 auth/ 目录下的 provider OAuth 文件（旧路径 ~/.crab/auth/ 已在新位置，无需迁移）
  // 但如果旧路径是 ~/.crab/data/auth/（P0-L1 引入的），需要迁移到 ~/.crab/auth/
  const oldAuthDir = path.join(dataDir, "auth");
  if (existsSync(oldAuthDir)) {
    try {
      const files = readdirSync(oldAuthDir);
      for (const file of files) {
        const fromPath = path.join(oldAuthDir, file);
        const toPath = path.join(authDir, file);
        if (!existsSync(toPath)) {
          renameSync(fromPath, toPath);
          migrated++;
        }
      }
      // 清理空目录
      if (readdirSync(oldAuthDir).length === 0) {
        rmSync(oldAuthDir, { recursive: true });
      }
    } catch (err) {
      log.warn(`迁移旧 auth 目录失败`, { error: String(err) });
    }
  }

  if (migrated > 0) {
    log.info(`目录结构迁移完成: ${migrated} 个文件/目录已迁移到新位置`);
  }
}
