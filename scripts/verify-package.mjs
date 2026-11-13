import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  CheckFailure,
  exitDescription,
  repoRoot,
  resolveTarball,
  RUN_TIMEOUT_MS,
  spawnAsync,
  startFailure,
} from "./lib/scratch.mjs";

// Lints the packed tarball with publint and attw, the same way locally and in CI. Both tools are
// devDependencies pinned by package-lock.json and run from node_modules by the bin path in their own
// package.json, with the Node that runs this script. CI runs it once, in the pack job on the
// .nvmrc Node; no Node matrix runs the lint.
//
// publint runs with --strict, so warnings fail like errors. attw runs with its strict profile
// (node10, node16 from CJS, node16 from ESM and bundler). Neither run passes a rule-ignore option:
// no rule is ignored because no known false positive
// exists. publint's two current suggestions ("type" and "sideEffects") do not fail --strict and are
// left alone on purpose, since adopting them would change the published package metadata.

const USAGE = "usage: node scripts/verify-package.mjs [--tarball file.tgz]";

function parseVerifyArgs(argv) {
  try {
    return parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: { tarball: { type: "string" } },
    }).values;
  } catch (error) {
    throw new CheckFailure(`usage: ${error.message}`);
  }
}

// The script of a tool's bin entry, found through the tool's own package.json.
function binScript(packageDir, binName) {
  const manifest = path.join(packageDir, "package.json");
  if (!existsSync(manifest)) {
    throw new CheckFailure(
      "run npm ci first: publint or attw is not installed"
    );
  }
  const { bin } = JSON.parse(readFileSync(manifest, "utf8"));
  const relative = typeof bin === "string" ? bin : bin?.[binName];
  if (typeof relative !== "string") {
    throw new CheckFailure(`${binName} package.json has no ${binName} bin`);
  }
  return path.join(packageDir, relative);
}

// Resolves to null when the tool passed, else a message that says how it failed: it could not start,
// it timed out, it was killed by a signal, or it exited with a status.
async function runTool(label, script, args) {
  console.log(`verify-package: running ${label} ${args.join(" ")}`);
  const result = await spawnAsync(process.execPath, [script, ...args], {
    stdio: "inherit",
    timeout: RUN_TIMEOUT_MS,
  });
  if (result.error !== undefined) {
    return startFailure(label, result.error, RUN_TIMEOUT_MS).message;
  }
  return result.status === 0 ? null : `${label} ${exitDescription(result)}`;
}

let tarballCleanup = () => {};
try {
  const values = parseVerifyArgs(process.argv.slice(2));
  const publint = binScript(
    path.join(repoRoot, "node_modules", "publint"),
    "publint"
  );
  const attw = binScript(
    path.join(repoRoot, "node_modules", "@arethetypeswrong", "cli"),
    "attw"
  );

  const { tarball, cleanup } = await resolveTarball(values.tarball);
  tarballCleanup = cleanup;

  // Both always run, so one failing tool never hides the other's report.
  const failures = [
    await runTool("publint", publint, ["run", tarball, "--strict"]),
    await runTool("attw", attw, [tarball, "--profile", "strict"]),
  ].filter((failure) => failure !== null);

  if (failures.length === 0) {
    console.log("verify-package: ok publint attw");
  } else {
    throw new CheckFailure(failures.join(", "));
  }
} catch (error) {
  if (error instanceof CheckFailure) {
    console.error(`verify-package: FAIL ${error.message}`);
    if (error.message.startsWith("usage:")) console.error(USAGE);
  } else {
    console.error(
      `verify-package: FAIL unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
    );
  }
  process.exitCode = 1;
} finally {
  tarballCleanup();
}
