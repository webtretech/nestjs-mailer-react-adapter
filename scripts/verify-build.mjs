import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const fixturesDir = path.join(root, "test", "fixtures");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

function fail(message) {
  console.error(`verify-build: FAIL ${message}`);
  process.exit(1);
}

// Thrown instead of calling fail() where a `finally` has to run first: process.exit() skips it.
class CheckFailure extends Error {}

function leaves(value) {
  if (typeof value === "string") return [value];
  return Object.values(value ?? {}).flatMap(leaves);
}

const targets = [
  ...new Set(
    [pkg.main, pkg.module, pkg.types, ...leaves(pkg.exports)].filter(
      (target) => typeof target === "string"
    )
  ),
];
const missing = targets.filter(
  (target) => !existsSync(path.join(root, target))
);
if (missing.length > 0) {
  fail(`missing build targets: ${missing.join(", ")}`);
}

const cjsTarget = pkg.exports?.["."]?.require?.default;
const esmTarget = pkg.exports?.["."]?.import?.default;
if (typeof cjsTarget !== "string" || typeof esmTarget !== "string") {
  fail('exports["."] lacks require.default or import.default');
}
const cjsEntry = path.join(root, cjsTarget);
const esmEntry = path.join(root, esmTarget);

if (!/\bimport\(/.test(readFileSync(cjsEntry, "utf8"))) {
  fail("dist CJS output lost its dynamic import()");
}

const entries = [
  { label: "cjs", module: createRequire(import.meta.url)(cjsEntry) },
  { label: "esm", module: await import(pathToFileURL(esmEntry).href) },
];

// `file` is an absolute path or a name relative to the fixtures directory (the template.dir the checks use).
const fixtures = [
  { id: "tsc-cjs", file: path.join(fixturesDir, "tsc-cjs.js") },
  { id: "esm-pkg-tla", file: path.join(fixturesDir, "esm-pkg", "tla.js") },
  { id: "swc-cjs", file: "swc-cjs" },
  { id: "module-exports", file: "module-exports" },
  { id: "cjs-only", file: "cjs-only" },
  { id: "esm-mjs", file: "esm" },
  { id: "esm-pkg-welcome", file: "esm-pkg/welcome" },
  { id: "dotted-v2", file: "dotted.v2" },
];

// Resolves 50 ms after the first callback so a second call is counted, or after 10 s if none arrives.
// settings.template is the mailer options' `template` key (default { dir: fixturesDir }; null sends {} as the
// mailer options); settings.adapterOptions is the ReactAdapter constructor argument.
function compileOnce(ReactAdapter, template, settings = {}) {
  const mailerTemplate =
    settings.template === undefined ? { dir: fixturesDir } : settings.template;
  const mailerOptions =
    mailerTemplate === null ? {} : { template: mailerTemplate };
  return new Promise((resolve) => {
    const calls = [];
    const mail = { data: { template, context: { body: "Body" } } };
    let timer = setTimeout(() => resolve({ calls, mail }), 10_000);
    const callback = (err) => {
      calls.push(err);
      if (calls.length === 1) {
        clearTimeout(timer);
        timer = setTimeout(() => resolve({ calls, mail }), 50);
      }
    };
    try {
      new ReactAdapter(settings.adapterOptions).compile(
        mail,
        callback,
        mailerOptions
      );
    } catch (error) {
      clearTimeout(timer);
      resolve({ calls: [error], mail });
    }
  });
}

function describe(error) {
  return error instanceof Error ? error.message : String(error);
}

for (const entry of entries) {
  const { ReactAdapter } = entry.module;
  if (typeof ReactAdapter !== "function") {
    fail(`${entry.label} entry does not export ReactAdapter`);
  }
  for (const fixture of fixtures) {
    const where = `${entry.label} ${fixture.id}`;
    const { calls, mail } = await compileOnce(ReactAdapter, fixture.file);
    if (calls.length !== 1) {
      fail(`${where}: callback was called ${calls.length} times, expected 1`);
    }
    if (calls[0] !== undefined) {
      fail(`${where}: callback received an error: ${describe(calls[0])}`);
    }
    const html = mail.data.html;
    if (
      typeof html !== "string" ||
      !html.includes(fixture.id) ||
      !html.includes("Body")
    ) {
      fail(`${where}: html lacks "${fixture.id}" or "Body"`);
    }
  }

  // A missing template is a typed error from this entry's own ReactAdapterError.
  {
    const where = `${entry.label} does-not-exist`;
    const { calls } = await compileOnce(ReactAdapter, "does-not-exist");
    if (calls.length !== 1) {
      fail(`${where}: callback was called ${calls.length} times, expected 1`);
    }
    const [error] = calls;
    if (
      !(error instanceof entry.module.ReactAdapterError) ||
      error.name !== "ReactAdapterError" ||
      error.code !== "ERR_REACT_ADAPTER_TEMPLATE_NOT_FOUND" ||
      !Array.isArray(error.searched) ||
      error.searched.length !== 3
    ) {
      fail(
        `${where}: expected TEMPLATE_NOT_FOUND with 3 searched paths, got ${describe(error)}`
      );
    }
  }

  // Invalid names and rootless absolute names are refused through the callback from this entry too (D-06, D-20).
  {
    const where = `${entry.label} confinement`;
    const { ReactAdapterError } = entry.module;
    const absolute = path.join(fixturesDir, "tsc-cjs.js");

    const invalid = await compileOnce(ReactAdapter, "tsc-cjs\0", {
      adapterOptions: { unsafeAllowOutsideTemplateDir: true },
    });
    if (invalid.calls.length !== 1) {
      fail(
        `${where}: invalid name called back ${invalid.calls.length} times, expected 1`
      );
    }
    const [invalidError] = invalid.calls;
    if (
      !(invalidError instanceof ReactAdapterError) ||
      invalidError.code !== "ERR_REACT_ADAPTER_INVALID_TEMPLATE_NAME"
    ) {
      fail(
        `${where}: a NUL-byte name expected INVALID_TEMPLATE_NAME even with the opt-out, got ${describe(invalidError)}`
      );
    }

    const refused = await compileOnce(ReactAdapter, absolute, {
      template: null,
    });
    if (refused.calls.length !== 1) {
      fail(
        `${where}: rootless absolute name called back ${refused.calls.length} times, expected 1`
      );
    }
    const [refusedError] = refused.calls;
    if (
      !(refusedError instanceof ReactAdapterError) ||
      refusedError.code !== "ERR_REACT_ADAPTER_TEMPLATE_OUTSIDE_ROOT" ||
      !Array.isArray(refusedError.roots) ||
      refusedError.roots.length !== 0
    ) {
      fail(
        `${where}: a rootless absolute name expected TEMPLATE_OUTSIDE_ROOT with empty roots, got ${describe(refusedError)}`
      );
    }

    const allowed = await compileOnce(ReactAdapter, absolute, {
      template: null,
      adapterOptions: { unsafeAllowOutsideTemplateDir: true },
    });
    if (allowed.calls.length !== 1) {
      fail(
        `${where}: opted-out absolute name called back ${allowed.calls.length} times, expected 1`
      );
    }
    if (allowed.calls[0] !== undefined) {
      fail(
        `${where}: opted-out absolute name received an error: ${describe(allowed.calls[0])}`
      );
    }
    const { html } = allowed.mail.data;
    if (typeof html !== "string" || !html.includes("<h1>tsc-cjs</h1>")) {
      fail(`${where}: opted-out absolute name did not render <h1>tsc-cjs</h1>`);
    }
  }

  // D-22: a native ESM template that fails to load stays failed; the adapter adds no retry.
  // Node caches a failed ESM evaluation per file URL, and both entries run in this one process, so each
  // entry gets its own copy in a fresh directory and therefore its own fresh failure.
  {
    const where = `${entry.label} esm-throws`;
    const evaluations = () =>
      globalThis.__reactAdapterEsmThrowsEvaluations ?? 0;
    const dir = mkdtempSync(
      path.join(os.tmpdir(), "react-adapter-esm-throws-")
    );
    let problem;
    try {
      // Inside this try a failed check throws, so the temp directory is removed before the process exits.
      const fail = (message) => {
        throw new CheckFailure(message);
      };
      const copy = path.join(dir, "esm-throws.mjs");
      copyFileSync(path.join(fixturesDir, "esm-throws.mjs"), copy);
      delete globalThis.__reactAdapterEsmThrows;
      const before = evaluations();

      const first = await compileOnce(ReactAdapter, copy, {
        template: { dir },
      });
      if (first.calls.length !== 1) {
        fail(
          `${where}: first send called back ${first.calls.length} times, expected 1`
        );
      }
      const [failure] = first.calls;
      if (
        !(failure instanceof entry.module.ReactAdapterError) ||
        failure.code !== "ERR_REACT_ADAPTER_TEMPLATE_LOAD_FAILED" ||
        !failure.message.includes("restart")
      ) {
        fail(
          `${where}: first send expected TEMPLATE_LOAD_FAILED mentioning "restart", got ${describe(failure)}`
        );
      }
      if (evaluations() !== before + 1) {
        fail(
          `${where}: this entry did not evaluate the module itself once (counter ${before} -> ${evaluations()})`
        );
      }

      globalThis.__reactAdapterEsmThrows = false;
      const afterFirst = evaluations();
      const second = await compileOnce(ReactAdapter, copy, {
        template: { dir },
      });
      if (second.calls.length !== 1) {
        fail(
          `${where}: second send called back ${second.calls.length} times, expected 1`
        );
      }
      const [again] = second.calls;
      if (
        !(again instanceof entry.module.ReactAdapterError) ||
        again.code !== "ERR_REACT_ADAPTER_TEMPLATE_LOAD_FAILED"
      ) {
        fail(
          `${where}: second send expected TEMPLATE_LOAD_FAILED again, got ${describe(again)}`
        );
      }
      if (evaluations() !== afterFirst) {
        fail(
          `${where}: the second send evaluated the module again (counter ${afterFirst} -> ${evaluations()})`
        );
      }
    } catch (error) {
      problem =
        error instanceof CheckFailure
          ? error.message
          : `${where}: unexpected error: ${describe(error)}`;
    } finally {
      delete globalThis.__reactAdapterEsmThrows;
      rmSync(dir, { recursive: true, force: true });
    }
    if (problem !== undefined) fail(problem);
  }
}

console.log(
  `verify-build: ok ${targets.length} export targets present, import() retained, CJS and ESM entries render ${fixtures.length} template shapes, report a missing template as a typed error and keep a failed ESM load failed, refuse invalid names and rootless absolute names unless opted out`
);
