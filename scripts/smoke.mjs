import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  CheckFailure,
  makeScratch,
  repoRoot,
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

// The same checks as RUNTIME_CHECKS, with types. `typeProbe` is never called: its
// `@ts-expect-error` only has to be needed at compile time, so an export typed `any` (a broken
// declarations map that resolves to nothing) makes the directive unused and fails the build.
const TS_CHECKS = `
function typeProbe(): void {
  // @ts-expect-error pretty is a boolean option, so a string must not type-check
  new ReactAdapter({ pretty: "yes" });
}
void typeProbe;

const templatesDir = process.env.SMOKE_TEMPLATES_DIR;
if (templatesDir === undefined) throw new Error("SMOKE_TEMPLATES_DIR is not set");

type Mail = {
  data: { template: string; context: Record<string, unknown>; html?: string; text?: string };
};

function compileOnce(options: ReactAdapterOptions, mail: Mail): Promise<unknown[]> {
  return new Promise<unknown[]>((resolve, reject) => {
    const calls: unknown[] = [];
    const giveUp = setTimeout(() => reject(new Error("compile callback was not called within 5000 ms")), 5000);
    new ReactAdapter(options).compile(
      mail,
      (error?: unknown) => {
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

async function main(): Promise<void> {
  const welcome: Mail = { data: { template: "welcome", context: { name: "Bo" } } };
  const rendered = await compileOnce({ text: true }, welcome);
  assert.equal(rendered.length, 1, "render: expected exactly one callback call, got " + rendered.length);
  assert.ok(rendered[0] === undefined || rendered[0] === null, "render: unexpected error " + String(rendered[0]));
  const html = welcome.data.html;
  assert.ok(typeof html === "string" && html.includes('<h1 id="greeting">Hello Bo</h1>'), "render: html was " + html);
  const text = welcome.data.text;
  assert.ok(typeof text === "string" && text.startsWith("HELLO BO"), "render: text was " + text);

  assert.equal(REACT_ADAPTER_ERROR_CODES.TEMPLATE_NOT_FOUND, "ERR_REACT_ADAPTER_TEMPLATE_NOT_FOUND");
  const missing: Mail = { data: { template: "nope", context: {} } };
  const failed = await compileOnce({}, missing);
  assert.equal(failed.length, 1, "missing template: expected exactly one callback call, got " + failed.length);
  const error = failed[0];
  if (!(error instanceof ReactAdapterError)) {
    throw new Error("missing template: error was not a ReactAdapterError: " + String(error));
  }
  assert.equal(error.code, REACT_ADAPTER_ERROR_CODES.TEMPLATE_NOT_FOUND);

  console.log("consumer " + consumerName + " ok");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
`;

function tsConsumer(name) {
  return `import { strict as assert } from "node:assert";
import { ReactAdapter, ReactAdapterError, REACT_ADAPTER_ERROR_CODES } from "${PACKAGE_NAME}";
import type { ReactAdapterOptions } from "${PACKAGE_NAME}";

const consumerName: string = "${name}";
${TS_CHECKS}`;
}

// skipLibCheck is on for every TypeScript consumer: mailer v4's own declarations import ESM-only
// Nest 12 and raise TS1479 under node16 CommonJS without it (RESEARCH Pattern 3). Nothing in those
// errors names this package; the adapter's declarations stay covered by attw, verify:types and
// the broken-types control (a tarball whose require.types points at the .d.mts fails here).
const NODE16_TSCONFIG = JSON.stringify({
  compilerOptions: {
    module: "node16",
    moduleResolution: "node16",
    target: "es2022",
    strict: true,
    skipLibCheck: true,
    outDir: "out",
  },
  include: ["src"],
});

const BUNDLER_TSCONFIG = JSON.stringify({
  compilerOptions: {
    module: "esnext",
    moduleResolution: "bundler",
    target: "es2022",
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  },
  include: ["src"],
});

// The consumer typescript and @types/node are the versions in the repository's package-lock.json
// (packages["node_modules/typescript"] and packages["node_modules/@types/node"]), never a floating
// range, so a new compiler release cannot change what this run proves.
function lockedVersion(name) {
  const lock = JSON.parse(
    readFileSync(path.join(repoRoot, "package-lock.json"), "utf8")
  );
  const version = lock.packages?.[`node_modules/${name}`]?.version;
  if (typeof version !== "string") {
    throw new CheckFailure(`package-lock.json has no version for ${name}`);
  }
  return version;
}

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

  const typescriptVersion = lockedVersion("typescript");
  const typesNodeVersion = lockedVersion("@types/node");

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
      `typescript@${typescriptVersion}`,
      `@types/node@${typesNodeVersion}`,
    ],
    { cwd: scratch }
  );

  const adapter = installedVersion(scratch, PACKAGE_NAME);
  const mailer = installedVersion(scratch, "@nestjs-modules/mailer");
  const react = installedVersion(scratch, "react");
  const typescript = installedVersion(scratch, "typescript");
  const typesNode = installedVersion(scratch, "@types/node");
  console.log(
    `smoke: resolved adapter ${adapter} mailer ${mailer} react ${react} typescript ${typescript} @types/node ${typesNode}`
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

  // Compile with the lockfile's tsc, run from the consumer directory so node16 resolution walks up
  // to the shared <scratch>/node_modules. The two node16 consumers are emitted and run (the CJS
  // one through require, the ESM one through import); the bundler consumer cannot be executed and
  // is only type-checked.
  const tsc = path.join(scratch, "node_modules", "typescript", "bin", "tsc");
  const tsConsumers = [
    {
      name: "ts-node16-cjs",
      packageJson: {},
      tsconfig: NODE16_TSCONFIG,
      execute: true,
    },
    {
      name: "ts-node16-esm",
      packageJson: { type: "module" },
      tsconfig: NODE16_TSCONFIG,
      execute: true,
    },
    {
      name: "ts-bundler",
      packageJson: { type: "module" },
      tsconfig: BUNDLER_TSCONFIG,
      execute: false,
    },
  ];
  for (const consumer of tsConsumers) {
    const dir = writeConsumer(scratch, consumer.name, {
      "package.json": JSON.stringify({
        name: consumer.name,
        private: true,
        ...consumer.packageJson,
      }),
      "tsconfig.json": consumer.tsconfig,
    });
    mkdirSync(path.join(dir, "src"));
    writeFileSync(path.join(dir, "src", "run.ts"), tsConsumer(consumer.name));
    run(process.execPath, [tsc, "-p", dir]);
    if (consumer.execute) {
      run(process.execPath, [path.join("out", "run.js")], { cwd: dir, env });
    } else {
      console.log(`consumer ${consumer.name} ok`);
    }
  }

  console.log(
    `smoke: ok node ${process.version} consumers cjs,esm,ts-node16-cjs,ts-node16-esm,ts-bundler`
  );
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
