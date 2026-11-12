import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  CheckFailure,
  makeScratch,
  resolveTarball,
  run,
  WELCOME_TEMPLATE_SOURCE,
} from "./lib/scratch.mjs";

// Smoke run for the packed adapter: install only the .tgz into a fresh scratch project and load it
// the way consumers do, on the Node that runs this script. The adapter is never loaded from the
// working tree (no link, no file: dependency, no repository node_modules). Consumer sources are
// generated from the strings below and never committed.

const USAGE =
  "usage: node scripts/smoke.mjs [--tarball file.tgz] [--expect-node 20.19.0|22|24]";

const PACKAGE_NAME = "@webtre/nestjs-mailer-react-adapter";

function parseSmokeArgs(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        tarball: { type: "string" },
        "expect-node": { type: "string" },
      },
    });
  } catch (error) {
    throw new CheckFailure(`usage: ${error.message}`);
  }
  return parsed.values;
}

// A guard against a CI leg that silently runs another Node than the one it asked for. Three parts
// must equal process.version exactly; one part must equal the running major. It runs before any
// install, so a wrong Node never gets as far as a result.
function checkExpectedNode(expected) {
  if (expected === undefined) return;
  const running = process.version;
  if (/^[0-9]+\.[0-9]+\.[0-9]+$/.test(expected)) {
    if (expected !== running.replace(/^v/, "")) {
      throw new CheckFailure(
        `expected Node ${expected} but running ${running}`
      );
    }
  } else if (/^[0-9]+$/.test(expected)) {
    if (
      Number.parseInt(expected, 10) !== Number.parseInt(running.slice(1), 10)
    ) {
      throw new CheckFailure(
        `expected Node ${expected} but running ${running}`
      );
    }
  } else {
    throw new CheckFailure(
      `usage: --expect-node must be a major (22) or x.y.z (20.19.0), got ${JSON.stringify(expected)}`
    );
  }
}

function installedVersion(scratch, name) {
  return JSON.parse(
    readFileSync(
      path.join(scratch, "node_modules", name, "package.json"),
      "utf8"
    )
  ).version;
}

// The render and missing-template checks the runtime consumers share. It expects `assert`,
// `ReactAdapter`, `ReactAdapterError`, `REACT_ADAPTER_ERROR_CODES` and `resolved` (the file the
// package name resolved to) to be declared above it. Callbacks are collected for 50 ms after the
// first one so a second call is counted rather than missed; a callback that never arrives is a
// failure instead of an empty event loop that would exit 0.
const RUNTIME_CHECKS = `
const templatesDir = process.env.SMOKE_TEMPLATES_DIR;
assert.ok(templatesDir, "SMOKE_TEMPLATES_DIR is not set");

function compileOnce(options, mail) {
  return new Promise((resolve, reject) => {
    const calls = [];
    const giveUp = setTimeout(() => reject(new Error("compile callback was not called within 5000 ms")), 5000);
    new ReactAdapter(options).compile(
      mail,
      (error) => {
        calls.push(error);
        if (calls.length === 1) {
          setTimeout(() => {
            clearTimeout(giveUp);
            resolve(calls);
          }, 50);
        }
      },
      { template: { dir: templatesDir } }
    );
  });
}

async function main() {
  const welcome = { data: { template: "welcome", context: { name: "Bo" } } };
  const rendered = await compileOnce({ text: true }, welcome);
  assert.equal(rendered.length, 1, "render: expected exactly one callback call, got " + rendered.length);
  assert.ok(rendered[0] === undefined || rendered[0] === null, "render: unexpected error " + rendered[0]);
  assert.ok(
    typeof welcome.data.html === "string" && welcome.data.html.includes('<h1 id="greeting">Hello Bo</h1>'),
    "render: html was " + welcome.data.html
  );
  assert.ok(
    typeof welcome.data.text === "string" && welcome.data.text.startsWith("HELLO BO"),
    "render: text was " + welcome.data.text
  );

  assert.equal(REACT_ADAPTER_ERROR_CODES.TEMPLATE_NOT_FOUND, "ERR_REACT_ADAPTER_TEMPLATE_NOT_FOUND");
  const missing = { data: { template: "nope", context: {} } };
  const failed = await compileOnce({}, missing);
  assert.equal(failed.length, 1, "missing template: expected exactly one callback call, got " + failed.length);
  assert.ok(failed[0] instanceof ReactAdapterError, "missing template: error was not a ReactAdapterError: " + failed[0]);
  assert.equal(failed[0].code, REACT_ADAPTER_ERROR_CODES.TEMPLATE_NOT_FOUND);

  console.log("consumer " + consumerName + " ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`;

const CJS_CONSUMER = `"use strict";
const assert = require("node:assert/strict");
const consumerName = "cjs";
const { ReactAdapter, ReactAdapterError, REACT_ADAPTER_ERROR_CODES } = require("${PACKAGE_NAME}");
const resolved = require.resolve("${PACKAGE_NAME}").split("\\\\").join("/");
assert.ok(resolved.endsWith("/dist/index.cjs"), "require resolved " + resolved);
${RUNTIME_CHECKS}`;

const ESM_CONSUMER = `import assert from "node:assert/strict";
import { ReactAdapter, ReactAdapterError, REACT_ADAPTER_ERROR_CODES } from "${PACKAGE_NAME}";
const consumerName = "esm";
const resolved = import.meta.resolve("${PACKAGE_NAME}");
assert.ok(resolved.endsWith("/dist/index.mjs"), "import resolved " + resolved);
${RUNTIME_CHECKS}`;

function writeConsumer(scratch, name, files) {
  const dir = path.join(scratch, name);
  mkdirSync(dir);
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(path.join(dir, file), content);
  }
  return dir;
}

let scratch;
let tarballCleanup = () => {};
try {
  const args = parseSmokeArgs(process.argv.slice(2));
  checkExpectedNode(args["expect-node"]);

  const { tarball, cleanup } = resolveTarball(args.tarball);
  tarballCleanup = cleanup;

  scratch = makeScratch("react-adapter-smoke-");
  writeFileSync(
    path.join(scratch, "package.json"),
    JSON.stringify({ name: "smoke-consumers", private: true, version: "0.0.0" })
  );

  // No mailer is named: npm installs the adapter's @nestjs-modules/mailer peer itself, which is
  // the empty-install case. npm strict engine checking is never turned on: on Node 20.19.0 the
  // mailer's @nestjs/common pulls file-type, which asks for Node 22 and warns EBADENGINE. The
  // warning is harmless (install, require, import and render all work on 20.19.0).
  run(
    "npm",
    [
      "install",
      "--save-exact",
      "--no-audit",
      "--no-fund",
      tarball,
      "react@19",
      "react-dom@19",
    ],
    { cwd: scratch }
  );

  const adapter = installedVersion(scratch, PACKAGE_NAME);
  const mailer = installedVersion(scratch, "@nestjs-modules/mailer");
  const react = installedVersion(scratch, "react");
  console.log(
    `smoke: resolved adapter ${adapter} mailer ${mailer} react ${react}`
  );

  const templates = path.join(scratch, "templates");
  mkdirSync(templates);
  writeFileSync(path.join(templates, "welcome.cjs"), WELCOME_TEMPLATE_SOURCE);
  const env = { ...process.env, SMOKE_TEMPLATES_DIR: templates };

  const cjsDir = writeConsumer(scratch, "cjs", {
    "package.json": JSON.stringify({ type: "commonjs" }),
    "run.cjs": CJS_CONSUMER,
  });
  run(process.execPath, ["run.cjs"], { cwd: cjsDir, env });

  const esmDir = writeConsumer(scratch, "esm", {
    "package.json": JSON.stringify({ type: "module" }),
    "run.mjs": ESM_CONSUMER,
  });
  run(process.execPath, ["run.mjs"], { cwd: esmDir, env });

  console.log(`smoke: ok node ${process.version} consumers cjs,esm`);
} catch (error) {
  if (error instanceof CheckFailure) {
    console.error(`smoke: FAIL ${error.message}`);
    if (error.message.startsWith("usage:")) console.error(USAGE);
  } else {
    console.error(
      `smoke: FAIL unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
    );
  }
  process.exitCode = 1;
} finally {
  if (scratch !== undefined) {
    rmSync(scratch, { recursive: true, force: true });
  }
  tarballCleanup();
}
