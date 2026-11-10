import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const fixturesDir = path.join(root, "test", "fixtures");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

function fail(message) {
  console.error(`verify-build: FAIL ${message}`);
  process.exit(1);
}

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

const fixtures = [
  { id: "tsc-cjs", file: path.join(fixturesDir, "tsc-cjs.js") },
  { id: "esm-pkg-tla", file: path.join(fixturesDir, "esm-pkg", "tla.js") },
];

// Resolves 50 ms after the first callback so a second call is counted, or after 10 s if none arrives.
function compileOnce(ReactAdapter, template) {
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
      new ReactAdapter().compile(mail, callback, {
        template: { dir: fixturesDir },
      });
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
}

console.log(
  `verify-build: ok ${targets.length} export targets present, import() retained, CJS and ESM entries render tsc-cjs and esm-pkg/tla`
);
