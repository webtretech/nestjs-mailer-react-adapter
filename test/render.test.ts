import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { MailerOptions } from "@nestjs-modules/mailer";
import { describe, expect, test } from "vitest";

import { ReactAdapter, ReactAdapterError } from "../src";
import { compileTemplate, expectAdapterError } from "./helpers";

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures"
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
  options: MailerOptions
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
            50
          );
        }
      },
      options
    );
  });
}

async function expectRender(
  template: string,
  id: string,
  options: MailerOptions = mailerOptions(FIXTURES),
  adapter: ReactAdapter = new ReactAdapter(),
  expected: string = html(id)
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
      mailerOptions(os.tmpdir())
    );
  });

  test("characterization: relative template.dir resolves against process.cwd()", async () => {
    // Relative to wherever the suite was started from, so the test does not depend on the start directory.
    const relative = path.relative(process.cwd(), FIXTURES);
    expect(path.isAbsolute(relative)).toBe(false);
    await expectRender("tsc-cjs", "tsc-cjs", mailerOptions(relative));
  });

  test("characterization: pretty option renders formatted HTML", async () => {
    await expectRender(
      "tsc-cjs",
      "tsc-cjs",
      mailerOptions(FIXTURES),
      new ReactAdapter({ pretty: true }),
      pretty("tsc-cjs")
    );
  });

  test("missing template reports ERR_REACT_ADAPTER_TEMPLATE_NOT_FOUND once with every searched path (changed in 0.3.0)", async () => {
    const outcome = await run(
      new ReactAdapter(),
      "does-not-exist",
      mailerOptions(FIXTURES)
    );
    expect(outcome.calls).toBe(1);
    expect(outcome.args).toHaveLength(1);
    const error = outcome.args[0];
    expect(error).toBeInstanceOf(ReactAdapterError);
    const adapterError = error as ReactAdapterError;
    expect(adapterError.code).toBe("ERR_REACT_ADAPTER_TEMPLATE_NOT_FOUND");
    expect(adapterError.template).toBe("does-not-exist");
    expect(adapterError.searched).toEqual(
      [".js", ".cjs", ".mjs"].map((ext) =>
        path.join(FIXTURES, "does-not-exist" + ext)
      )
    );
    expect(outcome.html).toBeUndefined();
  });

  test("missing template.dir reports ERR_REACT_ADAPTER_TEMPLATE_DIR_MISSING through the callback and never throws (changed in 0.3.0, CORE-02)", async () => {
    // 0.2.5 threw a TypeError synchronously here.
    const received: unknown[][] = [];
    let returned = false;
    let calledBeforeReturn = false;
    const mail = { data: { template: "tsc-cjs", context: { body: "Body" } } };
    expect(() => {
      new ReactAdapter().compile(
        mail,
        (...args: unknown[]) => {
          if (!returned) {
            calledBeforeReturn = true;
          }
          received.push(args);
        },
        {}
      );
      returned = true;
    }).not.toThrow();
    expect(calledBeforeReturn).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(received).toHaveLength(1);
    expect(received[0]).toHaveLength(1);
    const error = received[0][0];
    expect(error).toBeInstanceOf(ReactAdapterError);
    const adapterError = error as ReactAdapterError;
    expect(adapterError.code).toBe("ERR_REACT_ADAPTER_TEMPLATE_DIR_MISSING");
    expect(adapterError.template).toBe("tsc-cjs");
    expect(adapterError.searched).toBeUndefined();
  });

  test("characterization: SWC-compiled CJS template with a default getter", async () => {
    await expectRender("swc-cjs", "swc-cjs");
  });

  test("characterization: CJS template assigned to module.exports", async () => {
    await expectRender("module-exports", "module-exports");
  });

  test("characterization: native ESM .mjs template with an explicit extension", async () => {
    await expectRender("esm.mjs", "esm-mjs");
  });

  test("characterization: .js template under a type module package, loaded from a subdirectory", async () => {
    await expectRender("esm-pkg/welcome", "esm-pkg-welcome");
  });

  test("CJS template with exports.default and no __esModule fails with ERR_REACT_ADAPTER_INVALID_EXPORT naming the shape (changed in 0.3.0, D-28)", async () => {
    const outcome = await compileTemplate(
      "exports-default-no-esmodule",
      mailerOptions(FIXTURES)
    );
    const error = expectAdapterError(
      outcome,
      "ERR_REACT_ADAPTER_INVALID_EXPORT"
    );
    expect(error.template).toBe("exports-default-no-esmodule");
    expect(error.path).toBe(
      path.join(FIXTURES, "exports-default-no-esmodule.js")
    );
    expect(error.message).toMatch(/exports\.default/);
    expect(error.message).toMatch(/__esModule/);
    expect(outcome.html).toBeUndefined();
  });

  test("ESM template with no default export fails with ERR_REACT_ADAPTER_INVALID_EXPORT listing its exports (changed in 0.3.0, CORE-05)", async () => {
    const outcome = await compileTemplate(
      "named-only.mjs",
      mailerOptions(FIXTURES)
    );
    const error = expectAdapterError(
      outcome,
      "ERR_REACT_ADAPTER_INVALID_EXPORT"
    );
    expect(error.template).toBe("named-only.mjs");
    expect(error.path).toBe(path.join(FIXTURES, "named-only.mjs"));
    expect(error.message).toMatch(/no default export/);
    expect(error.message).toMatch(/Welcome/);
    expect(outcome.html).toBeUndefined();
  });

  // Exercises loadTemplate's import() fallback: require() throws ERR_REQUIRE_ASYNC_MODULE for top-level await.
  // Under Vitest this import() runs through Vite, not natively; plan 01-04's verify-build covers the native run.
  test("characterization: top-level-await ESM template loads through the import() fallback", async () => {
    const file = path.join(FIXTURES, "tla-fallback.mjs");
    let code: unknown;
    try {
      createRequire(file)(file);
    } catch (error) {
      code = (error as NodeJS.ErrnoException).code;
    }
    // Precondition: on this Node, require() really rejects the fixture, so the render below went through the fallback.
    expect(code).toBe("ERR_REQUIRE_ASYNC_MODULE");
    await expectRender("tla-fallback.mjs", "tla-fallback");
  });

  // Pins the interim loader's dotted-name outcome, which may differ from 0.2.5 (D-20).
  test("characterization: dotted template name dotted.v2", async () => {
    await expectRender("dotted.v2", "dotted-v2");
  });

  // A throw from the mailer's callback on the success path must not route into the failure handler,
  // so the callback runs once and the throw surfaces as an unhandled rejection, captured here.
  test("a callback that throws on the success path is called once and its throw becomes an unhandled rejection", async () => {
    const thrown = new Error("callback failed");
    const mail = {
      data: {
        template: "tsc-cjs",
        context: { body: "Body" },
        html: undefined as unknown,
      },
    };
    // Vitest fails the run on an unhandled rejection, so detach its listeners while this test captures one.
    // rawListeners keeps once-wrappers intact, so restoring them with on() does not make a once-listener permanent.
    const saved = process.rawListeners(
      "unhandledRejection"
    ) as NodeJS.UnhandledRejectionListener[];
    process.removeAllListeners("unhandledRejection");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      let calls = 0;
      let onSecondCall: () => void = () => {};
      const secondCall = new Promise<"second call">((resolve) => {
        onSecondCall = () => resolve("second call");
      });
      const rejection = new Promise<unknown>((resolve) => {
        process.once("unhandledRejection", resolve);
      });
      // Bounds the wait, well under Vitest's 5s test timeout, so the body always reaches finally.
      const timeout = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), 2000);
      });
      new ReactAdapter().compile(
        mail,
        () => {
          calls += 1;
          if (calls === 1) {
            throw thrown;
          }
          onSecondCall();
        },
        mailerOptions(FIXTURES)
      );
      // The rejection settles this on the fixed chain; a second callback call settles it on the old one.
      const settled = await Promise.race([rejection, secondCall, timeout]);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(calls).toBe(1);
      expect(settled).toBe(thrown);
      // The throw came from the success-path callback, so the template loaded and rendered.
      expect(mail.data.html).toBe(html("tsc-cjs"));
    } finally {
      clearTimeout(timer);
      process.removeAllListeners("unhandledRejection");
      for (const listener of saved) {
        process.on("unhandledRejection", listener);
      }
    }
  });

  // Assigning html is part of the work before the final handler pair, so a failure there reaches callback(error) once.
  test("a failure assigning html is reported once as ERR_REACT_ADAPTER_INVALID_MAIL with the TypeError as cause (changed in 0.3.0)", async () => {
    const mail = {
      data: Object.freeze({
        template: "tsc-cjs",
        context: { body: "Body" },
        html: undefined,
      }),
    };
    const args: unknown[][] = [];
    await new Promise<void>((resolve) => {
      new ReactAdapter().compile(
        mail,
        (...received: unknown[]) => {
          args.push(received);
          setTimeout(resolve, 50);
        },
        mailerOptions(FIXTURES)
      );
    });
    expect(args).toHaveLength(1);
    expect(args[0]).toHaveLength(1);
    const [error] = args[0];
    expect(error).toBeInstanceOf(ReactAdapterError);
    if (!(error instanceof ReactAdapterError)) {
      throw new Error("expected a ReactAdapterError");
    }
    expect(error.code).toBe("ERR_REACT_ADAPTER_INVALID_MAIL");
    expect(error.cause).toBeInstanceOf(TypeError);
  });
});
