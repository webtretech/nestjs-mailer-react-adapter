import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, test, vi } from "vitest";

import { compileTemplate } from "./helpers";

interface RequireRecord {
  id: string;
  threw: boolean;
}

const requireCalls = vi.hoisted(() => ({ records: [] as RequireRecord[] }));

// createRequire is wrapped by a recording pass-through: the real require runs, only its calls and outcome are noted.
vi.mock("node:module", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:module")>();
  return {
    ...actual,
    createRequire: (...args: Parameters<typeof actual.createRequire>) => {
      const real = actual.createRequire(...args);
      return (id: string): unknown => {
        try {
          const result: unknown = real(id);
          requireCalls.records.push({ id, threw: false });
          return result;
        } catch (error) {
          requireCalls.records.push({ id, threw: true });
          throw error;
        }
      };
    },
  };
});

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures"
);

describe("TMPL-05: CommonJS templates load through require() alone (loader-level, D-21)", () => {
  beforeEach(() => {
    requireCalls.records.length = 0;
  });

  test.each([
    ["tsc-cjs", "tsc-cjs"],
    ["swc-cjs", "swc-cjs"],
  ])(
    "%s is required once by its absolute path, require() does not throw, and the template renders",
    async (template, id) => {
      const outcome = await compileTemplate(template, {
        template: { dir: FIXTURES },
      });
      expect(outcome.calls).toBe(1);
      expect(outcome.args).toEqual([]);
      expect(outcome.html).toContain(`<h1>${id}</h1>`);
      expect(requireCalls.records).toEqual([
        { id: path.join(FIXTURES, `${template}.js`), threw: false },
      ]);
    }
  );
});
