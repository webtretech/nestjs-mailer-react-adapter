import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { MailerOptions } from "@nestjs-modules/mailer";
import { describe, expect, test } from "vitest";

import { ReactAdapter } from "../src";

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

const DOCTYPE =
  '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">';

function html(id: string): string {
  return `${DOCTYPE}<!--$--><div><h1>${id}</h1><p>Body</p></div><!--/$-->`;
}

function pretty(id: string): string {
  return `${DOCTYPE}\n<!--$-->\n<div>\n  <h1>${id}</h1>\n  <p>Body</p>\n</div>\n<!--/$-->\n`;
}

function mailerOptions(dir: string): MailerOptions {
  return { template: { dir } };
}

interface Outcome {
  args: unknown[];
  calls: number;
  html: unknown;
}

// Resolves on the first callback, then waits so that a second callback would be counted.
function run(
  adapter: ReactAdapter,
  template: string,
  options: MailerOptions,
): Promise<Outcome> {
  const mail = {
    data: { template, context: { body: "Body" }, html: undefined as unknown },
  };
  return new Promise((resolve) => {
    let calls = 0;
    let first: unknown[] = [];
    adapter.compile(
      mail,
      (...args: unknown[]) => {
        calls += 1;
        if (calls === 1) {
          first = args;
          setTimeout(
            () => resolve({ args: first, calls, html: mail.data.html }),
            50,
          );
        }
      },
      options,
    );
  });
}

async function expectRender(
  template: string,
  id: string,
  options: MailerOptions = mailerOptions(FIXTURES),
  adapter: ReactAdapter = new ReactAdapter(),
  expected: string = html(id),
): Promise<void> {
  const outcome = await run(adapter, template, options);
  expect(outcome.calls).toBe(1);
  expect(outcome.args).toEqual([]);
  expect(outcome.html).toBe(expected);
}

describe("ReactAdapter against the 0.2.5 loading and rendering behavior", () => {
  test("characterization: tsc-compiled CJS template by relative name without extension", async () => {
    await expectRender("tsc-cjs", "tsc-cjs");
  });

  test("characterization: absolute path wins over template.dir", async () => {
    await expectRender(
      path.join(FIXTURES, "tsc-cjs.js"),
      "tsc-cjs",
      mailerOptions(os.tmpdir()),
    );
  });

  test("characterization: relative template.dir resolves against process.cwd()", async () => {
    await expectRender("tsc-cjs", "tsc-cjs", mailerOptions("test/fixtures"));
  });

  test("characterization: pretty option renders formatted HTML", async () => {
    await expectRender(
      "tsc-cjs",
      "tsc-cjs",
      mailerOptions(FIXTURES),
      new ReactAdapter({ pretty: true }),
      pretty("tsc-cjs"),
    );
  });

  test("characterization: missing template reports MODULE_NOT_FOUND once", async () => {
    const outcome = await run(
      new ReactAdapter(),
      "does-not-exist",
      mailerOptions(FIXTURES),
    );
    expect(outcome.calls).toBe(1);
    expect(outcome.args).toHaveLength(1);
    expect(outcome.args[0]).toBeInstanceOf(Error);
    expect((outcome.args[0] as NodeJS.ErrnoException).code).toBe(
      "MODULE_NOT_FOUND",
    );
    expect(outcome.html).toBeUndefined();
  });

  test("characterization: missing template.dir throws a TypeError synchronously", async () => {
    // 0.2.5 behavior; CORE-02 changes it in Phase 2 and this test shows that diff.
    let called = 0;
    const mail = { data: { template: "tsc-cjs", context: { body: "Body" } } };
    expect(() =>
      new ReactAdapter().compile(
        mail,
        () => {
          called += 1;
        },
        {},
      ),
    ).toThrow(TypeError);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(called).toBe(0);
  });
});
