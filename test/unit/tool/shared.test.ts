import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

import { ensureDir, escapeHtml, parsePositiveInt } from "@/tool/shared";
import { createGlobalTmpTestDir } from "../../helpers/testPaths";

describe("@tool/shared public utilities", () => {
  const tmpDir = createGlobalTmpTestDir("crab-tool-shared-");

  afterEach(() => {
    rmSync(tmpDir, { force: true, recursive: true });
  });

  test("escapeHtml escapes text for browser-safe HTML output", () => {
    expect(escapeHtml(`<span data-x="1">Tom & 'Jerry'</span>`)).toBe(
      "&lt;span data-x=&quot;1&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/span&gt;",
    );
    expect(escapeHtml(undefined)).toBe("");
  });

  test("ensureDir creates nested directories recursively", () => {
    const nested = join(tmpDir, "a", "b", "c");

    ensureDir(nested);

    expect(existsSync(nested)).toBe(true);
  });

  test("parsePositiveInt supports optional and fallback modes", () => {
    expect(parsePositiveInt("12")).toBe(12);
    expect(parsePositiveInt(undefined)).toBeUndefined();
    expect(parsePositiveInt("0")).toBeUndefined();
    expect(parsePositiveInt("bad", 25)).toBe(25);
    expect(parsePositiveInt(null, 10)).toBe(10);
  });
});
