import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test, vi } from "vitest";

import { ReactAdapter } from "../src";

// Node 20.19+ can require() synchronous ESM, so ERR_REQUIRE_ESM no longer occurs naturally.
// The loader's createRequire is stubbed to throw the code under test; everything else is real.
const stub = vi.hoisted(() => ({ code: "ERR_REQUIRE_ESM" }));

vi.mock("node:module", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:module")>();
  return {
    ...actual,
    createRequire: () => () => {
      throw Object.assign(new Error(`stubbed ${stub.code}`), {
        code: stub.code,
      });
    },
  };
});

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures"
);

interface Outcome {
  args: unknown[];
  calls: number;
  html: unknown;
}

function run(template: string): Promise<Outcome> {
  const mail = {
    data: { template, context: { body: "Body" }, html: undefined as unknown },
  };
  return new Promise((resolve) => {
    let calls = 0;
    let first: unknown[] = [];
    new ReactAdapter().compile(
      mail,
      (...args: unknown[]) => {
        calls += 1;
        if (calls === 1) {
          first = args;
          setTimeout(
            () => resolve({ args: first, calls, html: mail.data.html }),
            50
          );
        }
      },
      { template: { dir: FIXTURES } }
    );
  });
}

describe("loadTemplate import() fallback", () => {
  test("characterization: ERR_REQUIRE_ESM from require() falls back to import()", async () => {
    stub.code = "ERR_REQUIRE_ESM";
    const outcome = await run("esm.mjs");
    expect(outcome.calls).toBe(1);
    expect(outcome.args).toEqual([]);
    expect(outcome.html).toContain("<h1>esm-mjs</h1><p>Body</p>");
  });

  test("characterization: ERR_REQUIRE_ASYNC_MODULE from require() falls back to import()", async () => {
    stub.code = "ERR_REQUIRE_ASYNC_MODULE";
    const outcome = await run("esm.mjs");
    expect(outcome.calls).toBe(1);
    expect(outcome.args).toEqual([]);
    expect(outcome.html).toContain("<h1>esm-mjs</h1><p>Body</p>");
  });

  test("characterization: any other require() error is reported once and never falls back", async () => {
    stub.code = "EACCES";
    const outcome = await run("esm.mjs");
    expect(outcome.calls).toBe(1);
    expect(outcome.args).toHaveLength(1);
    expect((outcome.args[0] as NodeJS.ErrnoException).code).toBe("EACCES");
    expect(outcome.html).toBeUndefined();
  });
});
