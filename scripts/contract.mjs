import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  CheckFailure,
  exitDescription,
  INSTALL_FLAGS,
  installedVersion,
  makeScratch,
  repoRoot,
  resolveTarball,
  RUN_TIMEOUT_MS,
  runNpm,
  startFailure,
  WELCOME_TEMPLATE_SOURCE,
} from "./lib/scratch.mjs";

// One leg of the mailer compatibility contract: install the packed adapter next to one
// @nestjs-modules/mailer version in a fresh scratch project and run the contract tests there.
// The adapter is only ever loaded from the packed tarball, never from the working tree.

const USAGE =
  "usage: node scripts/contract.mjs <mailer-spec> [--nodemailer x.y.z] [--react 18|19] [--tarball file.tgz] [--keep]";

// The exact number of node:test tests each mailer major must report. A leg passes only on an exact
// match, so an empty, truncated or partly skipped test file cannot pass (node:test reports an empty
// file as one passing file-level test).
const EXPECTED_TESTS = Object.freeze({ 2: 7, 3: 7, 4: 10 });

function parseLeg(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: true,
      options: {
        nodemailer: { type: "string" },
        react: { type: "string", default: "19" },
        tarball: { type: "string" },
        keep: { type: "boolean", default: false },
      },
    });
  } catch (error) {
    throw new CheckFailure(`usage: ${error.message}`);
  }
  const { values, positionals } = parsed;
  if (positionals.length !== 1) {
    throw new CheckFailure("usage: expected exactly one mailer spec");
  }
  const spec = positionals[0];
  if (!/^[0-9]+(\.[0-9]+){0,2}$/.test(spec)) {
    throw new CheckFailure(
      `usage: mailer spec must be 1 to 3 dot-separated numbers, got ${JSON.stringify(spec)}`
    );
  }
  const claimedMajor = Number.parseInt(spec, 10);
  if (!Object.hasOwn(EXPECTED_TESTS, claimedMajor)) {
    throw new CheckFailure(
      `usage: mailer major must be 2, 3 or 4, got ${claimedMajor}`
    );
  }
  if (
    values.nodemailer !== undefined &&
    !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(values.nodemailer)
  ) {
    throw new CheckFailure(
      `usage: --nodemailer must be x.y.z, got ${JSON.stringify(values.nodemailer)}`
    );
  }
  if (values.react !== "18" && values.react !== "19") {
    throw new CheckFailure(
      `usage: --react must be 18 or 19, got ${JSON.stringify(values.react)}`
    );
  }
  return { spec, claimedMajor, ...values };
}

function tapCount(output, name) {
  const match = new RegExp(`^# ${name} (\\d+)\\r?$`, "m").exec(output);
  return match === null ? undefined : Number(match[1]);
}

let scratch;
let tarballCleanup = () => {};
let keep = false;
try {
  const leg = parseLeg(process.argv.slice(2));
  keep = leg.keep;

  const { tarball, cleanup } = resolveTarball(leg.tarball);
  tarballCleanup = cleanup;

  scratch = makeScratch("react-adapter-contract-");
  writeFileSync(
    path.join(scratch, "package.json"),
    JSON.stringify({
      name: "contract-consumer",
      private: true,
      version: "0.0.0",
    })
  );

  // A plain install: no legacy peer resolution, no force and no overrides (INSTALL_FLAGS pins those
  // against the caller's npm config), so that a peer range wider than what actually works fails
  // here with ERESOLVE. Floating legs name no nodemailer and take whatever their mailer peer
  // resolves to; Nest versions float to the newest that fit.
  runNpm(
    [
      "install",
      ...INSTALL_FLAGS,
      tarball,
      `@nestjs-modules/mailer@${leg.spec}`,
      ...(leg.nodemailer === undefined ? [] : [`nodemailer@${leg.nodemailer}`]),
      "@nestjs/common",
      "@nestjs/core",
      "reflect-metadata",
      "rxjs",
      `react@${leg.react}`,
      `react-dom@${leg.react}`,
    ],
    { cwd: scratch }
  );

  const mailer = installedVersion(scratch, "@nestjs-modules/mailer");
  const nodemailer = installedVersion(scratch, "nodemailer");
  const react = installedVersion(scratch, "react");
  const reactDom = installedVersion(scratch, "react-dom");
  const nestCore = installedVersion(scratch, "@nestjs/core");
  console.log(
    `contract: resolved mailer ${mailer} nodemailer ${nodemailer} react ${react} react-dom ${reactDom} @nestjs/core ${nestCore}`
  );

  const installedMajor = Number.parseInt(mailer, 10);
  if (installedMajor !== leg.claimedMajor) {
    throw new CheckFailure(
      `leg claims mailer ${leg.claimedMajor} but installed ${mailer}`
    );
  }

  const templates = path.join(scratch, "templates");
  mkdirSync(templates);
  writeFileSync(path.join(templates, "welcome.cjs"), WELCOME_TEMPLATE_SOURCE);
  copyFileSync(
    path.join(repoRoot, "scripts", "contract", "contract.test.mjs"),
    path.join(scratch, "contract.test.mjs")
  );

  const tests = spawnSync(
    process.execPath,
    ["--test", "--test-reporter=tap", "contract.test.mjs"],
    {
      cwd: scratch,
      shell: false,
      encoding: "utf8",
      stdio: ["inherit", "pipe", "inherit"],
      maxBuffer: 64 * 1024 * 1024,
      timeout: RUN_TIMEOUT_MS,
      env: {
        ...process.env,
        EXPECTED_MAILER_MAJOR: String(leg.claimedMajor),
        TEMPLATES_DIR: templates,
      },
    }
  );
  const output = tests.stdout ?? "";
  process.stdout.write(output);
  if (tests.error !== undefined) {
    throw startFailure("contract tests", tests.error, RUN_TIMEOUT_MS);
  }

  const counts = Object.fromEntries(
    ["tests", "pass", "fail", "cancelled", "skipped", "todo"].map((name) => [
      name,
      tapCount(output, name),
    ])
  );
  const expected = EXPECTED_TESTS[installedMajor];
  const summary = Object.entries(counts)
    .map(([name, count]) => `${name} ${count ?? "missing"}`)
    .join(", ");
  if (tests.status !== 0) {
    throw new CheckFailure(
      `contract tests ${exitDescription(tests)} (${summary}, expected ${expected} tests)`
    );
  }
  if (
    counts.tests !== expected ||
    counts.pass !== expected ||
    counts.fail !== 0 ||
    counts.cancelled !== 0 ||
    counts.skipped !== 0 ||
    counts.todo !== 0
  ) {
    throw new CheckFailure(
      `contract tests reported ${summary}, expected exactly ${expected} passing and nothing failed, cancelled, skipped or todo`
    );
  }

  console.log(
    `contract: ok mailer ${mailer} nodemailer ${nodemailer} react ${react} tests ${counts.tests}`
  );
} catch (error) {
  if (error instanceof CheckFailure) {
    console.error(`contract: FAIL ${error.message}`);
    if (error.message.startsWith("usage:")) console.error(USAGE);
  } else {
    console.error(
      `contract: FAIL unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
    );
  }
  process.exitCode = 1;
} finally {
  if (scratch !== undefined) {
    if (keep) {
      console.log(`contract: kept ${scratch}`);
    } else {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  tarballCleanup();
}
