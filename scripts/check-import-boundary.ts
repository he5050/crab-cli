#!/usr/bin/env bun
/**
 * Import Boundary Checker
 *
 * Scans the codebase for import violations against the import boundary rules.
 * See docs/architecture/import-boundary.md for the full specification.
 *
 * Usage:
 *   bun run scripts/check-import-boundary.ts
 *   bun run scripts/check-import-boundary.ts --fix    # auto-fix where safe
 */

import { readdir, readFile, stat } from "fs/promises";
import { resolve, relative, dirname, basename } from "path";

// ─── Configuration ──────────────────────────────────────────────────────

const ROOT = resolve(import.meta.dir, "..");
const SRC_DIR = resolve(ROOT, "src");
const TEST_DIR = resolve(ROOT, "test");

/** First-level module aliases that are allowed (point to module entry) */
const ALLOWED_FIRST_LEVEL_ALIASES = new Set([
  "@core",
  "@agent",
  "@tool",
  "@server",
  "@session",
  "@config",
  "@bus",
  "@compress",
  "@conversation",
  "@hooks",
  "@lsp",
  "@mcp",
  "@monitor",
  "@permission",
  "@schema",
  "@security",
  "@ui",
  "@ide",
  "@db",
  "@api",
  "@cli",
  "@command",
  "@commandPalette",
  "@task",
  "@app",
  "@extension",
]);

/** Third-party package scopes that are allowed */
const ALLOWED_THIRD_PARTY_SCOPES = new Set([
  "@opentui",
  "@ai-sdk",
  "@agentclientprotocol",
  "@modelcontextprotocol",
  "@opentelemetry",
  "@release-it",
  "@bun-security-scanner",
  "@types",
]);

/** File extensions to scan */
const SCAN_EXTENSIONS = new Set([".ts", ".tsx"]);

// ─── Types ────────────────────────────────────────────────────────────────

interface Violation {
  file: string;
  line: number;
  column: number;
  type: "deep-alias" | "relative-src" | "unknown-alias";
  message: string;
  suggestion?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function isScanableFile(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf("."));
  return SCAN_EXTENSIONS.has(ext);
}

function getLineAndColumn(text: string, index: number): { line: number; column: number } {
  const lines = text.slice(0, index).split("\n");
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

/**
 * Extract all import/require sources from a file's content.
 * Returns array of { source, index } for each import.
 */
function extractImports(content: string): Array<{ source: string; index: number }> {
  const imports: Array<{ source: string; index: number }> = [];

  // import ... from "source"
  // import ... from 'source'
  const importRegex = /from\s+["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(content)) !== null) {
    imports.push({ source: match[1], index: match.index });
  }

  // import("source")
  const dynamicImportRegex = /import\(["']([^"']+)["']/g;
  while ((match = dynamicImportRegex.exec(content)) !== null) {
    imports.push({ source: match[1], index: match.index });
  }

  return imports;
}

function isThirdPartyPackage(source: string): boolean {
  // Absolute imports (no ./ or ../) that are not aliases
  if (source.startsWith(".") || source.startsWith("@/")) return false;
  if (source.startsWith("@")) {
    const scope = source.split("/")[0];
    return !ALLOWED_FIRST_LEVEL_ALIASES.has(scope);
  }
  return true;
}

function isAllowedThirdParty(source: string): boolean {
  if (!source.startsWith("@")) return true; // Regular npm packages are fine
  const scope = source.split("/")[0];
  return ALLOWED_THIRD_PARTY_SCOPES.has(scope) || !ALLOWED_FIRST_LEVEL_ALIASES.has(scope);
}

function checkImport(source: string, filePath: string): Violation | null {
  // Allow @/ deep paths
  if (source.startsWith("@/")) return null;

  // Allow relative imports (but not to src/)
  if (source.startsWith(".")) {
    // Check if it's a relative path to src/ (e.g., ../../src/...)
    const normalized = source.replace(/\\/g, "/");
    if (normalized.includes("/src/") || normalized.startsWith("src/")) {
      return {
        file: filePath,
        line: 0,
        column: 0,
        type: "relative-src",
        message: `Relative import to src/: "${source}"`,
        suggestion: `Use "@${source.split("/src/")[1]}" or "@/..." instead`,
      };
    }
    return null;
  }

  // Check first-level aliases (e.g., @core, @agent)
  if (source.startsWith("@")) {
    const parts = source.split("/");
    const firstLevel = parts[0];

    // Check if it's a known first-level alias
    if (ALLOWED_FIRST_LEVEL_ALIASES.has(firstLevel)) {
      // If it has more parts, it's a deep alias violation
      if (parts.length > 1) {
        return {
          file: filePath,
          line: 0,
          column: 0,
          type: "deep-alias",
          message: `Deep alias import: "${source}"`,
          suggestion: `Use "@/${source.slice(1)}" instead`,
        };
      }
      // Just the first level, e.g., "@core" - this is fine
      return null;
    }

    // Unknown alias - check if it's a third-party package
    if (isAllowedThirdParty(source)) {
      return null;
    }

    return {
      file: filePath,
      line: 0,
      column: 0,
      type: "unknown-alias",
      message: `Unknown alias import: "${source}"`,
    };
  }

  // Regular npm package
  return null;
}

// ─── File Scanner ─────────────────────────────────────────────────────────

async function scanFile(filePath: string): Promise<Violation[]> {
  const content = await readFile(filePath, "utf-8");
  const imports = extractImports(content);
  const violations: Violation[] = [];

  for (const { source, index } of imports) {
    const violation = checkImport(source, filePath);
    if (violation) {
      const { line, column } = getLineAndColumn(content, index);
      violations.push({ ...violation, line, column });
    }
  }

  return violations;
}

async function scanDirectory(dir: string): Promise<Violation[]> {
  const violations: Violation[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip node_modules and .omc
      if (entry.name === "node_modules" || entry.name === ".omc") continue;
      violations.push(...(await scanDirectory(fullPath)));
    } else if (entry.isFile() && isScanableFile(fullPath)) {
      violations.push(...(await scanFile(fullPath)));
    }
  }

  return violations;
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const shouldFix = args.includes("--fix");

  console.log("🔍 Scanning for import boundary violations...\n");

  const srcViolations = await scanDirectory(SRC_DIR);
  const testViolations = await scanDirectory(TEST_DIR);
  const allViolations = [...srcViolations, ...testViolations];

  if (allViolations.length === 0) {
    console.log("✅ No import boundary violations found!");
    process.exit(0);
  }

  // Group by type
  const byType = new Map<string, Violation[]>();
  for (const v of allViolations) {
    const existing = byType.get(v.type) || [];
    existing.push(v);
    byType.set(v.type, existing);
  }

  // Print summary
  console.log(`Found ${allViolations.length} violations:\n`);

  for (const [type, violations] of byType) {
    console.log(`\n## ${type} (${violations.length})\n`);
    for (const v of violations.slice(0, 10)) {
      const relPath = relative(ROOT, v.file);
      console.log(`  ${relPath}:${v.line}:${v.column}`);
      console.log(`    ${v.message}`);
      if (v.suggestion) {
        console.log(`    → ${v.suggestion}`);
      }
    }
    if (violations.length > 10) {
      console.log(`    ... and ${violations.length - 10} more`);
    }
  }

  console.log(`\n📊 Summary:`);
  for (const [type, violations] of byType) {
    console.log(`  ${type}: ${violations.length}`);
  }

  process.exit(1);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
