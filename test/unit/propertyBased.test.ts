import { describe, expect, it } from "bun:test";
import fc from "fast-check";
import { estimateTextTokens as estimateTokens } from "@/api";
import { sanitizeString, sanitizeHeaders } from "@/core/logging/debugLogger";
import { Cache } from "@/api";

describe("Property-based tests (fast-check)", () => {
  describe("estimateTokens", () => {
    it("always returns non-negative integer", () => {
      fc.assert(
        fc.property(fc.string(), (text) => {
          const result = estimateTokens(text);
          return Number.isInteger(result) && result >= 0;
        }),
      );
    });

    it("empty string returns 0", () => {
      fc.assert(fc.property(fc.constant(""), (text) => estimateTokens(text) === 0));
    });

    it("longer string returns >= shorter string (same charset)", () => {
      fc.assert(
        fc.property(fc.string({ maxLength: 100 }), (str) => {
          const a = estimateTokens(str);
          const b = estimateTokens(`${str}aaa`);
          return b >= a;
        }),
      );
    });

    it("is deterministic", () => {
      fc.assert(
        fc.property(fc.string(), (text) => {
          const a = estimateTokens(text);
          const b = estimateTokens(text);
          return a === b;
        }),
      );
    });
  });

  describe("sanitizeString", () => {
    it("output never contains raw API keys when redactSensitive=true", () => {
      const apiKeyArb = fc.string({ minLength: 20, maxLength: 50 }).map((s) => s.replace(/[^a-zA-Z0-9]/g, "a"));
      fc.assert(
        fc.property(fc.string(), apiKeyArb, (prefix, key) => {
          const input = `${prefix}sk-${key}${prefix}`;
          const output = sanitizeString(input, { redactSensitive: true });
          return !output.includes(key);
        }),
        { numRuns: 100 },
      );
    });

    it("output length is bounded by maxLength + overhead", () => {
      fc.assert(
        fc.property(fc.string(), fc.integer({ min: 10, max: 500 }), (text, max) => {
          const output = sanitizeString(text, { maxLength: max });
          return output.length <= max + 50;
        }),
        { numRuns: 100 },
      );
    });

    it("redactSensitive=false preserves input (within maxLength)", () => {
      fc.assert(
        fc.property(fc.string({ maxLength: 90 }), (text) => {
          const output = sanitizeString(text, { maxLength: 100, redactSensitive: false });
          return output === text;
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("sanitizeHeaders", () => {
    it("sensitive headers are always redacted", () => {
      fc.assert(
        fc.property(
          fc.constantFrom("authorization", "x-api-key", "cookie", "set-cookie"),
          fc.string(),
          (header, value) => {
            const headers = { [header]: value };
            const result = sanitizeHeaders(headers);
            return result[header] === "[REDACTED]";
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("Cache", () => {
    it("get after set returns the same value", () => {
      fc.assert(
        fc.property(fc.string(), fc.anything(), (key, value) => {
          const cache = new Cache();
          cache.set(key, value);
          return cache.get(key) === value;
        }),
        { numRuns: 100 },
      );
    });

    it("delete removes entry", () => {
      fc.assert(
        fc.property(fc.string(), fc.anything(), (key, value) => {
          const cache = new Cache();
          cache.set(key, value);
          cache.delete(key);
          return cache.get(key) === undefined;
        }),
        { numRuns: 100 },
      );
    });

    it("clear removes all entries", () => {
      fc.assert(
        fc.property(fc.array(fc.tuple(fc.string(), fc.anything())), (entries) => {
          const cache = new Cache({ capacity: 10000 });
          for (const [k, v] of entries) {
            cache.set(k, v);
          }
          cache.clear();
          return cache.size() === 0;
        }),
        { numRuns: 100 },
      );
    });

    it("capacity constraint is never violated", () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 10 }), fc.array(fc.tuple(fc.string(), fc.anything())), (cap, entries) => {
          const cache = new Cache({ capacity: cap });
          for (const [k, v] of entries) {
            cache.set(k, v);
          }
          return cache.getStats().size <= cap;
        }),
        { numRuns: 100 },
      );
    });

    it("has() is consistent with get()", () => {
      fc.assert(
        fc.property(fc.string(), fc.anything(), (key, value) => {
          const cache = new Cache();
          cache.set(key, value);
          return cache.has(key) === (cache.get(key) !== undefined);
        }),
        { numRuns: 100 },
      );
    });
  });
});
